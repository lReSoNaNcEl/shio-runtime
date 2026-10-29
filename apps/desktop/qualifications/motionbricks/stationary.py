"""Research-only bounded stationary targets and SOMA world-delta conversion.

This tests model suitability before connecting semantic planning to live Chat.
Targets are research controls, not LLM-selected gestures or co-speech evidence.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import time
from pathlib import Path

import numpy as np
import warp as wp
from motionbricks.inference.builder import TensorRTBuildOptions
from motionbricks.io.bvh import load_bvh
from motionbricks.io.usd import load_skeleton_from_usd
from motionbricks.io.utils import SOMA_SKELETON_PRIM_PATH, get_asset_file
from motionbricks.model.soma.contract import SOMA_N1_CONTRACT, SOMA_N1_FP16_ONNX_PATH
from motionbricks.model.soma.engine import MotionBricksSOMAEngine
from scipy.spatial.transform import Rotation


def world_poses(local: np.ndarray, parents: np.ndarray) -> np.ndarray:
    world = local.copy().astype(np.float64)
    for joint, parent in enumerate(parents):
        if parent >= 0:
            rotation = Rotation.from_quat(world[:, parent, 3:])
            world[:, joint, :3] = world[:, parent, :3] + rotation.apply(
                local[:, joint, :3]
            )
            world[:, joint, 3:] = (
                rotation * Rotation.from_quat(local[:, joint, 3:])
            ).as_quat()
    return world


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--segments", type=int, default=120)
    args = parser.parse_args()
    if not 12 <= args.segments <= 1000:
        parser.error("segments must be 12..1000")
    with SOMA_N1_FP16_ONNX_PATH.open("rb") as stream:
        if (
            hashlib.file_digest(stream, "sha256").hexdigest()
            != "6c9f78e23decbda8e1cfd1b0cc96980ea4b24b3ca2c808d03b058f48f82fc9ef"
        ):
            raise ValueError("Unqualified model hash")
    args.output.mkdir(parents=True, exist_ok=True)
    wp.config.kernel_cache_dir = str(Path.cwd() / ".warp-cache")
    wp.init()
    wp.set_device("cuda:0")
    rig = load_skeleton_from_usd(
        get_asset_file("human", "soma_base_skel_minimal_no_root.usd"),
        SOMA_SKELETON_PRIM_PATH,
    )
    parents = rig.parent_indices.numpy()
    reference = rig.reference_local_transforms.numpy()
    rest_world = world_poses(reference[None], parents)[0]
    indices = [rig.joint_index(name) for name in SOMA_N1_CONTRACT.joint_names]
    idle = load_bvh(
        str(Path.cwd() / "assets/motions/soma/locomotion/idle/idle_loop_001__A268.bvh"),
        rig,
    )
    with (
        MotionBricksSOMAEngine(
            SOMA_N1_FP16_ONNX_PATH, build_options=TensorRTBuildOptions(enable_fp16=True)
        ) as engine,
        wp.ScopedStream(engine.stream),
    ):
        context, target, output = (
            engine.create_input(rig),
            engine.create_input(rig),
            engine.create_output(rig),
        )
        initial = wp.empty_like(rig.reference_local_transforms)
        idle.sample(0.0, initial, stream=engine.stream)
        engine.synchronize()
        initial_np = initial.numpy()
        # One held standing pose seeds four contexts. Future histories are the
        # last four actual generated poses; no reset between targets.
        context_poses = wp.array(
            np.repeat(initial_np[None], 4, axis=0), dtype=wp.transform
        )
        anchor_world = world_poses(initial_np[None], parents)[0]
        trace, contacts, timings, joins = [], [], [], []
        previous, target_rotations = None, {}
        for segment in range(args.segments):
            current = context_poses.numpy()[-1]
            goal = current.copy()
            # Preserve the standing support goal; subtle shoulder/arm variants
            # test low-amplitude target following, with natural held intervals.
            goal[0] = initial_np[0]
            for name in (
                "LeftLeg",
                "LeftShin",
                "LeftFoot",
                "LeftToeBase",
                "RightLeg",
                "RightShin",
                "RightFoot",
                "RightToeBase",
            ):
                j = rig.joint_index(name)
                goal[j] = initial_np[j]
            for name in ("LeftArm", "RightArm", "LeftForeArm", "RightForeArm"):
                j = rig.joint_index(name)
                if segment % 3 == 0:
                    # Bounded deterministic variation, no independent joint noise.
                    amount = 0.10 * np.sin(
                        segment * 1.73 + (0.8 if name.startswith("Left") else 0.0)
                    )
                    axis = (
                        np.array([0.6, 0.0, 0.8])
                        if "Fore" in name
                        else np.array([0.0, 0.0, 1.0])
                    )
                    target_rotations[name] = (
                        Rotation.from_quat(initial_np[j, 3:])
                        * Rotation.from_rotvec(axis * amount)
                    ).as_quat()
                goal[j, 3:] = target_rotations[name]
            context.update_from_poses(context_poses, stream=engine.stream)
            target.update_from_poses(
                wp.array(goal[None], dtype=wp.transform), stream=engine.stream
            )
            started = time.perf_counter()
            engine.generate_animation(context, target, output)
            timings.append((time.perf_counter() - started) * 1000)
            poses = output.poses[: output.num_frames].numpy()
            if not np.isfinite(poses).all():
                raise ValueError("Non-finite generated output")
            if previous is not None:
                joins.append(float(np.max(np.abs(poses[0] - previous))))
            previous = poses[-1]
            trace.append(poses if segment == 0 else poses[1:])
            contacts.append(
                output.foot_contacts[: output.num_frames].numpy()[
                    0 if segment == 0 else 1 :
                ]
            )
            context_poses = wp.clone(
                output.poses[output.num_frames - 4 : output.num_frames]
            )
        source = np.concatenate(trace)
        world = world_poses(source, parents)
        deltas = np.empty((len(source), 30, 4), dtype=np.float64)
        for index, j in enumerate(indices):
            deltas[:, index] = (
                Rotation.from_quat(world[:, j, 3:])
                * Rotation.from_quat(rest_world[j, 3:]).inv()
            ).as_quat()
        root = world[:, 0, :3].copy()
        # Canonical stage origin and height required by the existing Avatar owner.
        # No source rotation attenuation, workspace fitting or ARDY correction.
        root -= root[0]
        root[:, 1] += 0.9887084839474641
        chunks = []
        contact_array = np.clip(np.concatenate(contacts), 0, 1)
        for offset in range(0, len(source) - 59, 60):
            chunks.append(
                {
                    "startFrame": offset,
                    "fps": 30,
                    "skeleton": "soma30-standard-tpose-v1",
                    "rotations": deltas[offset : offset + 60].tolist(),
                    "rootPositions": root[offset : offset + 60].tolist(),
                    "footContacts": [
                        dict(
                            zip(
                                ("leftHeel", "leftToe", "rightHeel", "rightToe"),
                                row.tolist(),
                            )
                        )
                        for row in contact_array[offset : offset + 60]
                    ],
                }
            )
        np.savez_compressed(
            args.output / "source.npz",
            local=source,
            world=world,
            reference=reference,
            joint_names=rig.joint_names,
            parents=parents,
            foot_contacts=contact_array,
        )
        (args.output / "canonical-chunks.json").write_text(
            json.dumps(chunks), encoding="utf-8"
        )
        feet = [
            rig.joint_index(n)
            for n in ("LeftFoot", "LeftToeBase", "RightFoot", "RightToeBase")
        ]
        wrist = [rig.joint_index(n) for n in ("LeftHand", "RightHand")]
        report = {
            "segments": args.segments,
            "frames": len(source),
            "durationSeconds": len(source) / 30,
            "sourceJointCount": rig.num_joints,
            "canonicalJointCount": len(indices),
            "generationMsP50P95P99": np.percentile(timings[10:], [50, 95, 99]).tolist(),
            "maxBoundaryComponentDelta": max(joins),
            "rootExcursionM": np.max(
                np.linalg.norm(world[:, 0, :3] - world[0, 0, :3], axis=-1)
            ).item(),
            "feetExcursionM": [
                np.max(
                    np.linalg.norm(world[:, j, :3] - anchor_world[j, :3], axis=-1)
                ).item()
                for j in feet
            ],
            "wristExcursionM": [
                np.max(
                    np.linalg.norm(world[:, j, :3] - anchor_world[j, :3], axis=-1)
                ).item()
                for j in wrist
            ],
            "scope": "Source-space research targets; no Character/Fish, no live VRM or artistic acceptance",
        }
        (args.output / "result.json").write_text(
            json.dumps(report, indent=2), encoding="utf-8"
        )
        print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
