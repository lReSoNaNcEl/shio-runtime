"""Offline, bounded summaries of real Chat qualification; no artistic verdict."""

import argparse
import json
from pathlib import Path

import numpy as np


def distribution(values):
    x = np.array([v for v in values if v is not None and np.isfinite(v)], dtype=float)
    if not len(x):
        return {"count": 0, "p50": None, "p95": None, "p99": None, "max": None}
    return {
        "count": len(x),
        "mean": float(x.mean()),
        **{f"p{q}": float(np.percentile(x, q)) for q in (50, 95, 99)},
        "max": float(x.max()),
    }


def read_trace(filename):
    if not filename.exists():
        return None
    return json.loads(filename.read_text(encoding="utf-8"))


def angular(points):
    if not points:
        return None
    q = np.array(points, dtype=float)
    valid = np.isfinite(q).all(axis=1)
    q = q[valid]
    if len(q) < 2:
        return None
    q /= np.linalg.norm(q, axis=1)[:, None]
    return {
        "samples": len(q),
        "excursionRad": float((2 * np.arccos(np.clip(abs(q @ q[0]), 0, 1))).max()),
        "travelRad": float(
            (2 * np.arccos(np.clip(abs((q[1:] * q[:-1]).sum(axis=1)), 0, 1))).sum()
        ),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    report = json.loads((args.directory / "report.json").read_text(encoding="utf-8"))
    conversation = report.get("conversation", {})
    audio = conversation.get("audio", {})
    start = audio.get("startedAt", 0)
    end = start + audio.get("fileDurationMs", 0)
    resources = [r for r in report["resources"] if start <= r["at"] <= end]
    device = []
    for sample in resources:
        try:
            memory, utilization = map(float, sample["gpu"].split(","))
            device.append((memory, utilization))
        except (ValueError, KeyError):
            pass
    result = {
        "directory": str(args.directory),
        "head": report["git"]["head"],
        "vrm": report["modelFixture"],
        "provider": report["motionProvider"],
        "nativeHand": report["nativeSomaHand"],
        "build": report["build"],
        "recordedAudioSeconds": audio.get("fileDurationMs", 0) / 1000,
        "video": conversation.get("video"),
        "gpu": {
            "samples": len(device),
            "memoryMiB": distribution([v[0] for v in device]),
            "utilizationPercent": distribution([v[1] for v in device]),
            "scope": "Whole-device samples while Chat was recorded, includes Fish and renderer. Sampled maximum, not an instantaneous peak. WDDM per-process GPU attribution unavailable.",
        },
        "latency": report.get("latency"),
        "fishMeasurementLimit": "Main TTS milestones include transport/queue and streaming duration. Native Fish CUDA kernel inference was not instrumented; no API/Fish changes.",
        "camera": conversation.get("camera"),
        "cases": [],
        "qualificationPassed": report.get("passed", False),
        "failures": report["failures"],
        "artisticAcceptance": "pending user review",
    }
    primary = read_trace(args.directory / "conversation-primary.json")
    overlay = read_trace(args.directory / "conversation-overlay.json")
    if primary:
        frames = primary["frames"]
        unique = {(h["sessionId"], h["epoch"], h["id"]): h for h in primary["horizons"]}
        chunks = list(unique.values())
        result["motion"] = {
            "generationWallMs": distribution([h["inferenceMs"] for h in chunks]),
            "note": "Synchronized worker wall time; native inference includes GPU transfer, not a CUDA-kernel-only claim.",
            **{
                name: distribution([h.get("timings", {}).get(name) for h in chunks])
                for name in ("planningMs", "generationMs", "conversionMs", "handMs")
            },
        }
        result["primary"] = {
            "frames": len(frames),
            "frameStride": primary.get("frameStride", 1),
            "overflow": primary["overflow"],
            "compositionMs": distribution([f["costMs"] for f in frames]),
            "compositionIntervalMs": distribution(np.diff([f["at"] for f in frames])),
            "nativeHandRetargetMs": distribution(
                [f.get("timings", {}).get("sample") for f in frames]
            ),
            "retargetIncludingHandMs": distribution(
                [f.get("timings", {}).get("apply") for f in frames]
            ),
            "safetyAndIntegrationMs": distribution(
                [f.get("timings", {}).get("validateFinalComposition") for f in frames]
            ),
            "workspaceIkMs": distribution(
                [f.get("timings", {}).get("projectHandWorkspaces") for f in frames]
            ),
            "maxUnresolvedContacts": max(
                (f["safety"]["unresolvedArmContacts"] for f in frames), default=0
            ),
            "consumedPresentationLagMs": distribution(
                [
                    (f["pcm"]["sourceSampleOffset"] - f["sampledPcm"])
                    * 1000
                    / f["pcm"]["sourceSampleRate"]
                    for f in frames
                    if (f.get("pcm") or {}).get("state") == "playing"
                    and f.get("sampledPcm") is not None
                ]
            ),
        }
        for case in conversation.get("cases", []):
            measured = {
                "id": case["id"],
                "intent": case["intent"],
                "technicalPassed": case["technicalPassed"],
                "readabilityPassed": case["readabilityPassed"],
                "executions": [],
            }
            for execution in case["executions"]:
                selected = [
                    f
                    for f in frames
                    if f["executionId"] == execution["id"]
                    and f["phase"] == "stroke"
                    and (f.get("pcm") or {}).get("turnId") == case.get("turnId")
                ]
                stages = {}
                for stage in (
                    "retargeted",
                    "artistic",
                    "admissible",
                    "temporal",
                    "finalVrm",
                ):
                    stages[stage] = {
                        bone: angular(
                            [
                                f["stages"][stage][i * 4 : i * 4 + 4]
                                for f in selected
                                if stage in f["stages"]
                            ]
                        )
                        for i, bone in enumerate(primary["names"])
                        if "Arm" in bone or "Shoulder" in bone
                    }
                measured["executions"].append(
                    {
                        "profile": execution["profileId"],
                        "phases": execution["phases"],
                        "evidence": execution["evidence"],
                        "stageAngles": stages,
                        "note": "Final travel can include residual preparation; compare admissible motion separately.",
                    }
                )
            result["cases"].append(measured)
    if overlay and primary:
        result["overlay"] = {
            "frames": len(overlay["frames"]),
            "overflow": overlay["overflow"],
            "projectionAgeMs": distribution(
                [
                    overlay["timeOrigin"]
                    + f["at"]
                    - primary["timeOrigin"]
                    - f["mirror"]["composedAt"]
                    for f in overlay["frames"]
                    if (f.get("mirror") or {}).get("composedAt") is not None
                ]
            ),
        }
    args.output.write_text(
        json.dumps(result, indent=2, allow_nan=False), encoding="utf-8"
    )
    print(
        json.dumps(
            {
                "output": str(args.output),
                "recordedSeconds": result["recordedAudioSeconds"],
                "gpuSamples": len(device),
                "artisticAcceptance": result["artisticAcceptance"],
            }
        )
    )


if __name__ == "__main__":
    main()
