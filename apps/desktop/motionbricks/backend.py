"""Opt-in MotionBricks Adapter. No text, speech, face or Avatar ownership.

Stage-2 targets are deliberately conservative. This is not yet a qualified
semantic/prosodic target planner. Bundled evaluation poses stay research-only.
"""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
UPSTREAM = ROOT / ".cache/upstream"
SOURCE = "54fc563aeaaf819a753d72cc9fdc6713989cdd43"
MODEL = "6c9f78e23decbda8e1cfd1b0cc96980ea4b24b3ca2c808d03b058f48f82fc9ef"


class MotionBricksBackend:
    def __init__(self):
        os.environ["WARP_CACHE_PATH"] = str(ROOT / ".warp-cache")
        import numpy as np
        import warp as wp

        revision = subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=UPSTREAM, text=True
        ).strip()
        if revision != SOURCE:
            raise ValueError("Unqualified MotionBricks source")
        sys.path.insert(0, str(UPSTREAM))
        from conversion import world_poses
        from motionbricks.inference.builder import TensorRTBuildOptions
        from motionbricks.io.bvh import load_bvh
        from motionbricks.io.usd import load_skeleton_from_usd
        from motionbricks.io.utils import SOMA_SKELETON_PRIM_PATH, get_asset_file
        from motionbricks.model.soma.contract import (
            SOMA_N1_CONTRACT,
            SOMA_N1_FP16_ONNX_PATH,
        )
        from motionbricks.model.soma.engine import MotionBricksSOMAEngine
        from motionbricks.model.config import MotionBricksInferenceConfig

        with SOMA_N1_FP16_ONNX_PATH.open("rb") as stream:
            if hashlib.file_digest(stream, "sha256").hexdigest() != MODEL:
                raise ValueError("Unqualified MotionBricks ONNX")
        wp.config.kernel_cache_dir = str(ROOT / ".warp-cache")
        wp.init()
        wp.set_device("cuda:0")
        self.np, self.wp = np, wp
        self.inference_config = MotionBricksInferenceConfig
        self.rig = load_skeleton_from_usd(
            get_asset_file("human", "soma_base_skel_minimal_no_root.usd"),
            SOMA_SKELETON_PRIM_PATH,
        )
        self.parents = self.rig.parent_indices.numpy()
        self.reference = self.rig.reference_local_transforms.numpy()
        self.reference_world = world_poses(self.reference[None], self.parents)[0]
        self.indices = [
            self.rig.joint_index(name) for name in SOMA_N1_CONTRACT.joint_names
        ]
        self.engine = MotionBricksSOMAEngine(
            SOMA_N1_FP16_ONNX_PATH,
            build_options=TensorRTBuildOptions(enable_fp16=True),
            cache_dir=UPSTREAM / ".trt-cache",
        )
        with wp.ScopedStream(self.engine.stream):
            self.context, self.target = (
                self.engine.create_input(self.rig),
                self.engine.create_input(self.rig),
            )
            self.output = self.engine.create_output(self.rig)
            idle = load_bvh(
                str(
                    UPSTREAM
                    / "assets/motions/soma/locomotion/idle/idle_loop_001__A268.bvh"
                ),
                self.rig,
            )
            initial = wp.empty_like(self.rig.reference_local_transforms)
            idle.sample(0.0, initial, stream=self.engine.stream)
            self.engine.synchronize()
            self.initial = initial.numpy()
        self.history = {}
        self.seed = 0
        self.origin = self.initial[0, :3].copy()
        from targets import TargetPlanner

        workspaces = json.loads(
            (ROOT.parent / "motion/motion-profiles.json").read_text()
        )["handWorkspaces"]
        self.planner = TargetPlanner(
            self.rig.joint_names, self.parents, self.initial, workspaces
        )
        self.hand = None
        if os.environ.get("SHIO_MOTION_SOMA_HAND") == "1":
            from hand_prior import HandPrior

            self.hand = HandPrior(ROOT / ".cache/hand")

    def reset(self, seed):
        self.seed = seed
        self.history = {index: self.initial.copy() for index in range(-4, 0)}
        self.planner.reset()
        if self.hand:
            self.hand.reset()

    def generate(self, profile, phase, frame, seed, activity=None, plan=None):
        from conversion import canonical_rotations
        from targets import target_token_count

        np, wp, engine = self.np, self.wp, self.engine
        if any(index not in self.history for index in range(frame - 4, frame)):
            raise ValueError("Unavailable exact source history")
        self.seed = seed
        context_np = np.stack(
            [self.history[index] for index in range(frame - 4, frame)]
        )
        source, contacts = [], []
        count, sequence = 0, 0
        started = time.perf_counter()
        planning_ms, generation_ms = 0.0, 0.0
        tokens = target_token_count(profile, phase, activity)
        config = (
            self.inference_config(allowed_token_counts=(tokens,)) if tokens else None
        )
        with wp.ScopedStream(engine.stream):
            while count < 60:
                planning_at = time.perf_counter()
                goal = self.planner.goal(
                    context_np,
                    profile,
                    phase,
                    self.seed + (frame // 4 + sequence) * 101,
                    activity,
                    plan,
                )
                planning_ms += (time.perf_counter() - planning_at) * 1000
                generation_at = time.perf_counter()
                self.context.update_from_poses(
                    wp.array(context_np, dtype=wp.transform), stream=engine.stream
                )
                self.target.update_from_poses(
                    wp.array(goal[None], dtype=wp.transform), stream=engine.stream
                )
                engine.generate_animation(
                    self.context, self.target, self.output, config=config
                )
                poses = self.output.poses[: self.output.num_frames].numpy()
                feet = self.output.foot_contacts[: self.output.num_frames].numpy()
                generation_ms += (time.perf_counter() - generation_at) * 1000
                # Frame zero repeats the last context; do not stall at every join.
                take = min(60 - count, len(poses) - 1)
                source.append(poses[1 : take + 1])
                contacts.append(feet[1 : take + 1])
                context_np = np.concatenate((context_np, poses[1 : take + 1]))[-4:]
                count += take
                sequence += 1
            local = np.concatenate(source)
            conversion_at = time.perf_counter()
            world, rotations = canonical_rotations(
                local, self.parents, self.reference_world, self.indices
            )
            positions = world[:, 0, :3] - self.origin
            positions[:, 1] += 0.9887084839474641
            conversion_ms = (time.perf_counter() - conversion_at) * 1000
            for index, pose in enumerate(local):
                self.history[frame + index] = pose.copy()
            self.history = {
                index: pose
                for index, pose in self.history.items()
                if frame - 120 <= index < frame + 60
            }
            feet = np.clip(np.concatenate(contacts), 0, 1)
            if not np.isfinite(positions).all() or not np.isfinite(feet).all():
                raise ValueError("Non-finite source trajectory")
            result = {
                "startFrame": frame,
                "fps": 30,
                "skeleton": "soma30-standard-tpose-v1",
                "rotations": rotations.tolist(),
                "rootPositions": positions.tolist(),
                "footContacts": [
                    dict(
                        zip(
                            ("leftHeel", "leftToe", "rightHeel", "rightToe"),
                            row.tolist(),
                        )
                    )
                    for row in feet
                ],
                "inferenceMs": (time.perf_counter() - started) * 1000,
                "timings": {
                    "planningMs": planning_ms,
                    "generationMs": generation_ms,
                    "conversionMs": conversion_ms,
                    "handMs": 0.0,
                    "endpointFrames": tokens * 4 - 7 if tokens else 0,
                },
            }
            if self.hand:
                hand_at = time.perf_counter()
                result["handDeltas"] = self.hand.generate(
                    frame, profile, phase, plan, activity
                )
                result["timings"]["handMs"] = (time.perf_counter() - hand_at) * 1000
                result["inferenceMs"] = (time.perf_counter() - started) * 1000
            return result

    def close(self):
        self.history.clear()
        self.engine.close()
