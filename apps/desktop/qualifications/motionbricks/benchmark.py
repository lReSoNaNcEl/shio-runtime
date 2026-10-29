"""Opt-in official SOMA feasibility benchmark; never loaded by Desktop.

Run with the pinned upstream environment from the repository root. Outputs are
research evidence, not a production clip library or an artistic PASS.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import os
import subprocess
import sys
import threading
import time
import traceback
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
REVISION = "54fc563aeaaf819a753d72cc9fdc6713989cdd43"
HASHES = {
    "fp32": "856419dc72aeb14e591eebf4dd0ea05734a2506ddb00bcd39dd6dac2ad60f4fb",
    "fp16": "6c9f78e23decbda8e1cfd1b0cc96980ea4b24b3ca2c808d03b058f48f82fc9ef",
}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--precision", choices=tuple(HASHES), required=True)
    parser.add_argument(
        "--upstream", type=Path, default=ROOT / "tmp/motionbricks-upstream"
    )
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--generations", type=int, default=1000)
    parser.add_argument("--force-rebuild", action="store_true")
    args = parser.parse_args()
    if not 20 <= args.generations <= 100000:
        parser.error("generations must be 20..100000")
    upstream = args.upstream.resolve()
    actual_revision = subprocess.check_output(
        ["git", "rev-parse", "HEAD"], cwd=upstream, text=True
    ).strip()
    if actual_revision != REVISION:
        raise ValueError("Unqualified upstream revision")
    output_dir = args.output.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    os.chdir(upstream)
    result = {
        "sourceRevision": REVISION,
        "precision": args.precision,
        "forceRebuild": args.force_rebuild,
        "status": "failed",
        "python": sys.version,
        "packages": {
            name: importlib.metadata.version(name)
            for name in (
                "motionbricks",
                "tensorrt-cu12",
                "warp-lang",
                "newton",
                "numpy",
                "scipy",
                "nvidia-cuda-runtime-cu12",
            )
        },
        "telemetryScope": "Whole GPU including other applications; not per-process VRAM",
        "artisticAcceptance": "PENDING",
    }
    telemetry = []
    stop = threading.Event()

    def monitor() -> None:
        while not stop.is_set():
            try:
                sample = subprocess.check_output(
                    [
                        "nvidia-smi",
                        (
                            "--query-gpu=timestamp,name,driver_version,memory.used,"
                            "utilization.gpu,utilization.memory,power.draw"
                        ),
                        "--format=csv,noheader,nounits",
                    ],
                    text=True,
                    timeout=5,
                    creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
                ).strip()
                telemetry.append({"at": time.time(), "sample": sample})
            except (OSError, subprocess.SubprocessError) as error:
                telemetry.append({"at": time.time(), "error": str(error)})
            stop.wait(0.2)

    thread = threading.Thread(target=monitor, daemon=True)
    thread.start()
    started = time.perf_counter()
    try:
        import numpy as np
        import warp as wp

        wp.config.kernel_cache_dir = str(upstream / ".warp-cache")
        wp.init()
        wp.set_device("cuda:0")
        from motionbricks.inference.builder import TensorRTBuildOptions
        from motionbricks.io.bvh import load_bvh
        from motionbricks.io.usd import load_skeleton_from_usd
        from motionbricks.io.utils import SOMA_SKELETON_PRIM_PATH, get_asset_file
        from motionbricks.model.soma.engine import MotionBricksSOMAEngine

        model = (
            upstream
            / f"motionbricks/assets/onnx/soma/mmm_v6_soma_{args.precision}.onnx"
        )
        with model.open("rb") as stream:
            digest = hashlib.file_digest(stream, "sha256").hexdigest()
        if digest != HASHES[args.precision]:
            raise ValueError("ONNX SHA-256 mismatch")
        result["onnxSha256"] = digest
        result["device"] = {"name": wp.get_device().name, "arch": wp.get_device().arch}
        skeleton = load_skeleton_from_usd(
            get_asset_file("human", "soma_base_skel_minimal_no_root.usd"),
            SOMA_SKELETON_PRIM_PATH,
        )
        clip = load_bvh(
            str(
                upstream / "assets/motions/soma/locomotion/"
                "bs_1d_linear/Neutral_walk_forward_002__A057.bvh"
            ),
            skeleton,
        )
        before_plans = {
            str(p): p.stat().st_mtime_ns
            for p in (upstream / ".trt-cache").glob("*.plan")
        }
        build_at = time.perf_counter()
        with (
            MotionBricksSOMAEngine(
                model,
                build_options=TensorRTBuildOptions(
                    enable_fp16=args.precision == "fp16"
                ),
                cache_dir=upstream / ".trt-cache",
                force_rebuild=args.force_rebuild,
            ) as engine,
            wp.ScopedStream(engine.stream),
        ):
            result["engineStartupMs"] = (time.perf_counter() - build_at) * 1000
            after_plans = {
                str(p): p.stat().st_mtime_ns
                for p in (upstream / ".trt-cache").glob("*.plan")
            }
            result["planCacheUnchanged"] = before_plans == after_plans
            context, target = (
                engine.create_input(skeleton),
                engine.create_input(skeleton),
            )
            output = engine.create_output(skeleton)
            context_poses = wp.empty_like(context.poses)
            target_poses = wp.empty_like(target.poses)
            for index in range(4):
                clip.sample(
                    0.9 + index / 30, context_poses[index], stream=engine.stream
                )
            rows, traces, joins = [], [], []
            previous = None
            cpu_at, wall_at = time.process_time(), time.perf_counter()
            for generation in range(args.generations):
                request_at = time.perf_counter()
                # Alternate nearby times; context always comes from the preceding
                # complete generated result. No per-generation neutral reset.
                for index in range(4):
                    clip.sample(
                        1.8 + (generation % 4) * 0.35 + index / 30,
                        target_poses[index],
                        stream=engine.stream,
                    )
                context.update_from_poses(context_poses, stream=engine.stream)
                target.update_from_poses(target_poses, stream=engine.stream)
                engine.generate_animation(context, target, output)
                native_ms = (time.perf_counter() - request_at) * 1000
                frames = output.num_frames
                pose = output.poses[:frames].numpy()
                contacts = output.foot_contacts[:frames].numpy()
                if (
                    not 18 <= frames <= 58
                    or not np.isfinite(pose).all()
                    or not np.isfinite(contacts).all()
                ):
                    raise ValueError("Invalid generated pose/contacts")
                norms = np.linalg.norm(pose[:, :, 3:7], axis=-1)
                if not np.allclose(norms, 1, atol=2e-3):
                    raise ValueError("Non-unit source quaternion")
                if previous is not None:
                    dots = np.clip(
                        np.abs(np.sum(previous[:, 3:7] * pose[0, :, 3:7], axis=-1)),
                        0,
                        1,
                    )
                    joins.append(
                        {
                            "maxAngleRad": float(np.max(2 * np.arccos(dots))),
                            "rootDeltaM": float(
                                np.linalg.norm(previous[0, :3] - pose[0, 0, :3])
                            ),
                        }
                    )
                previous = pose[-1].copy()
                context_poses = wp.clone(output.poses[frames - 4 : frames])
                engine.synchronize()
                row = {
                    "generation": generation,
                    "frames": frames,
                    **engine.timer.milliseconds,
                    "generationWallMs": native_ms,
                    "targetToHostPoseMs": (time.perf_counter() - request_at) * 1000,
                }
                rows.append(row)
                if generation < 10:
                    traces.append(pose)
                if generation == 0:
                    result["firstUsablePoseFromProcessMs"] = (
                        time.perf_counter() - started
                    ) * 1000
                    result["firstGeneration"] = row
            result["cpuCoreEquivalent"] = (time.process_time() - cpu_at) / (
                time.perf_counter() - wall_at
            )
            warm = rows[10:]
            result["warmSamples"] = len(warm)
            result["warmMs"] = {
                key: dict(
                    zip(
                        ("p50", "p95", "p99"),
                        map(float, np.percentile([r[key] for r in warm], [50, 95, 99])),
                    )
                )
                for key in (
                    "encode",
                    "inference",
                    "decode",
                    "post_process",
                    "generationWallMs",
                    "targetToHostPoseMs",
                )
            }
            result["joins"] = {key: max(row[key] for row in joins) for key in joins[0]}
            (output_dir / "samples.json").write_text(json.dumps(rows), encoding="utf-8")
            np.savez_compressed(
                output_dir / "source-traces.npz",
                **{f"segment_{i}": v for i, v in enumerate(traces)},
                joint_names=skeleton.joint_names,
                parent_indices=skeleton.parent_indices.numpy(),
                reference_local=skeleton.reference_local_transforms.numpy(),
            )
        result["status"] = "passed-source-validation"
    except BaseException as error:
        result["error"] = {
            "type": type(error).__name__,
            "message": str(error),
            "traceback": traceback.format_exc(),
        }
        raise
    finally:
        stop.set()
        thread.join(timeout=6)
        result["totalWallMs"] = (time.perf_counter() - started) * 1000
        (output_dir / "result.json").write_text(
            json.dumps(result, indent=2, allow_nan=False), encoding="utf-8"
        )
        (output_dir / "gpu.json").write_text(
            json.dumps(telemetry, indent=2), encoding="utf-8"
        )
        print(json.dumps(result, indent=2, allow_nan=False), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
