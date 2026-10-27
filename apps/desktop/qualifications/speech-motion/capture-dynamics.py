"""Offline, opt-in real source capture. Artifacts never enter application storage."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
from pathlib import Path

MOTION = Path(__file__).resolve().parents[2] / "motion"
sys.path.insert(0, str(MOTION))

from backend import ArdyBackend
from protocol import load_catalog, phase_prompt
from research import load_pins


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument(
        "--profiles", default="presence_poised,explain_balance,surprise_small"
    )
    parser.add_argument("--seed", type=int, default=17)
    parser.add_argument(
        "--style",
        choices=("canonical", "natural", "expressive", "playful", "energetic"),
        default="canonical",
    )
    parser.add_argument("--profile-stages", action="store_true")
    args = parser.parse_args()
    catalog = load_catalog()
    profiles = {p["id"]: p for p in catalog["profiles"]}
    selected = args.profiles.split(",")
    if not 0 <= args.seed <= 2_147_483_647 or any(p not in profiles for p in selected):
        parser.error("Only catalog profiles and a bounded seed are accepted")
    backend = ArdyBackend()

    def prompt(profile, phase):
        if args.style == "canonical":
            return phase_prompt(profile, phase)
        instructions = {
            "prepare": "Prepare promptly from the current pose without repeating the accent.",
            "stroke": "Perform one clear accent with natural acceleration and deceleration.",
            "hold": "Briefly sustain the communicative pose without repeating the accent.",
            "recover": "Return naturally to stable standing with coordinated arms and hands.",
        }
        style = {
            "natural": "Use natural conversational timing.",
            "expressive": "Use expressive conversational timing with a readable emphasis.",
            "playful": "Use one playful, lively reaction with controlled balance.",
            "energetic": "Use one energetic, decisive reaction while maintaining balance.",
        }[args.style]
        return (
            profile["conditioningRefs"]["prompt"]
            + " "
            + style
            + " "
            + instructions[phase]
        )

    backend.warmup(
        [
            {"id": f"{p['id']}:{phase}", "prompt": prompt(p, phase), "stationary": True}
            for p in profiles.values()
            if not p.get("physicalAction")
            and (args.style == "canonical" or p["id"] in selected)
            for phase in ("prepare", "stroke", "hold", "recover")
        ]
    )
    measured = []
    if args.profile_stages:
        import torch

        def wrap(owner, name):
            original = getattr(owner, name)

            def call(*values, **kwargs):
                begin, end = (
                    torch.cuda.Event(enable_timing=True),
                    torch.cuda.Event(enable_timing=True),
                )
                begin.record()
                started = time.perf_counter()
                value = original(*values, **kwargs)
                submitted = (time.perf_counter() - started) * 1000
                end.record()
                measured.append((name, begin, end, submitted))
                return value

            setattr(owner, name, call)

        wrap(backend.model, "autoregressive_step")
        wrap(backend.model.motion_rep, "inverse")
        wrap(backend.model.motion_rep, "create_conditions_from_constraints_batched")
    result = {"seed": args.seed, "style": args.style, "pins": load_pins(), "cases": []}
    for name in selected:
        backend.reset(args.seed)
        chunks = []
        for phase in ("prepare", "stroke", "hold"):
            measured.clear()
            chunk = backend.generate(prompt(profiles[name], phase), True)
            if measured:
                measured[-1][2].synchronize()
                timings = [
                    {
                        "stage": stage,
                        "gpuMs": begin.elapsed_time(end),
                        "cpuSubmissionMs": cpu,
                    }
                    for stage, begin, end, cpu in measured
                ]
                serialized = time.perf_counter()
                payload = json.dumps(chunk, allow_nan=False)
                timings.append(
                    {
                        "stage": "json-serialization",
                        "cpuMs": (time.perf_counter() - serialized) * 1000,
                        "bytes": len(payload.encode()),
                    }
                )
                result.setdefault("profiling", []).append(
                    {
                        "profileId": name,
                        "phase": phase,
                        "timings": timings,
                        "generateTotalMs": chunk["inferenceMs"],
                    }
                )
            chunks.append({"phase": phase, **chunk})
            print(
                json.dumps(
                    {"profile": name, "phase": phase, "ms": chunk["inferenceMs"]}
                ),
                flush=True,
            )
        result["cases"].append({"profileId": name, "chunks": chunks})
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, allow_nan=False), encoding="utf-8")
    print(json.dumps({"sha256": hashlib.sha256(args.output.read_bytes()).hexdigest()}))


if __name__ == "__main__":
    main()
