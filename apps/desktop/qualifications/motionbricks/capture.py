"""Opt-in real MotionBricks source for identical-input retargeting qualification."""

import argparse
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "motionbricks"))


def main():
    from backend import MODEL, SOURCE, MotionBricksBackend
    from conversion import world_poses

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--seed", type=int, default=17)
    parser.add_argument("--phase-budgets", action="store_true")
    args = parser.parse_args()
    catalog = json.loads((ROOT / "motion/motion-profiles.json").read_text())
    profiles = {p["id"]: p for p in catalog["profiles"]}
    result = {
        "seed": args.seed,
        "pins": {"source": SOURCE, "model": MODEL},
        "cases": [],
        "codeSha256": {
            name: hashlib.sha256(
                (ROOT / "motionbricks" / name).read_bytes()
            ).hexdigest()
            for name in ("backend.py", "targets.py", "activity.py", "hand_prior.py")
        },
    }
    backend = MotionBricksBackend()
    try:
        for name in ("explain_point_close", "explain_one_palm"):
            backend.reset(args.seed)
            chunks, metrics = [], []
            frame = 0
            for index, phase in enumerate(("prepare", "stroke", "hold")):
                chunk = backend.generate(profiles[name], phase, frame, args.seed)
                budget = next(
                    p["minMs"] for p in profiles[name]["phases"] if p["id"] == phase
                )
                consumed = (
                    max(4, round(budget * 30 / 4000) * 4) if args.phase_budgets else 60
                )
                world = world_poses(
                    backend.np.stack(
                        [backend.history[i] for i in range(frame, frame + 60)]
                    ),
                    backend.parents,
                )
                paths = {}
                for side in ("Left", "Right"):
                    p = world[:, backend.rig.joint_index(side + "Hand"), :3]
                    paths[side] = {
                        "excursionM": float(
                            backend.np.linalg.norm(p - p[0], axis=1).max()
                        ),
                        "travelM": float(
                            backend.np.linalg.norm(
                                backend.np.diff(p, axis=0), axis=1
                            ).sum()
                        ),
                    }
                metrics.append(
                    {"phase": phase, "wrists": paths, "ms": chunk["inferenceMs"]}
                )
                chunks.append(
                    {
                        "phase": phase,
                        "consumedFrames": consumed,
                        "sourceProvider": "motionbricks",
                        **chunk,
                    }
                )
                frame += consumed
            result["cases"].append(
                {"profileId": name, "chunks": chunks, "native": metrics}
            )
            print(json.dumps({"profile": name, "native": metrics}), flush=True)
    finally:
        backend.close()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, allow_nan=False), encoding="utf-8")
    print(json.dumps({"sha256": hashlib.sha256(args.output.read_bytes()).hexdigest()}))


if __name__ == "__main__":
    main()
