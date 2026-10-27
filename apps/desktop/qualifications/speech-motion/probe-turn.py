"""Opt-in pinned SOMA heading/contact capability experiment, never production policy."""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

MOTION = Path(__file__).resolve().parents[2] / "motion"
sys.path.insert(0, str(MOTION))
from backend import ArdyBackend
from protocol import load_catalog


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    backend = ArdyBackend()
    import numpy as np
    import torch
    from ardy.constraints import Root2DConstraintSet

    profile = next(p for p in load_catalog()["profiles"] if p["id"] == "turn_in_place")
    backend.warmup(
        [
            {
                "id": "turn-probe-v1",
                "prompt": profile["conditioningRefs"]["prompt"],
                "stationary": False,
            }
        ]
    )
    cases = []
    for direction in (-1, 1):
        backend.reset(17)

        def constraint(history_length, frames, device="cuda", direction=direction):
            indices = torch.arange(history_length, frames)
            t = (torch.arange(60, device=device) + backend.frame) / 239
            heading = direction * 2 * math.pi * (t * t * t * (10 + t * (-15 + 6 * t)))
            return Root2DConstraintSet(
                backend.model.skeleton,
                indices,
                torch.zeros((60, 2), device=device),
                global_root_heading=heading,
            )

        backend.standing_constraint = constraint
        headings, positions, contacts, inference = [], [], [], []
        for _ in range(4):
            chunk = backend.generate(profile["conditioningRefs"]["prompt"], True)
            decoded = backend.model.motion_rep.inverse(
                backend.history[:, -60:], is_normalized=True
            )
            headings.extend(
                decoded["global_root_heading"][0].detach().cpu().numpy().tolist()
            )
            positions.extend(
                decoded["posed_joints"][0, :, backend.model.skeleton.foot_joint_idx]
                .detach()
                .cpu()
                .numpy()
                .tolist()
            )
            contacts.extend(decoded["foot_contacts"][0].detach().cpu().numpy().tolist())
            inference.append(chunk["inferenceMs"])
        angles = np.unwrap(
            np.arctan2(np.array(headings)[:, 1], np.array(headings)[:, 0])
        )
        feet = np.array(positions)
        planted = np.array(contacts, dtype=bool)
        displacement = np.linalg.norm(np.diff(feet, axis=0), axis=-1)
        mask = planted[1:] & planted[:-1]
        skating = displacement[mask]
        cases.append(
            {
                "direction": direction,
                "observedTurnRadians": float(angles[-1] - angles[0]),
                "maxPlantedFootStepM": float(skating.max()) if skating.size else None,
                "contactFraction": planted.mean(axis=0).tolist(),
                "inferenceMs": inference,
            }
        )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(
            {
                "seed": 17,
                "rootHeadingConstraintsSupported": True,
                "cases": cases,
                "visualAcceptance": "pending",
            },
            indent=2,
        )
    )
    print(json.dumps(cases))


if __name__ == "__main__":
    main()
