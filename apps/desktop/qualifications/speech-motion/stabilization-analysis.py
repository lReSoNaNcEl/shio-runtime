"""Bounded, opt-in analysis of qualification stage series; never a Runtime."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np


def percentile(values, quantile=95):
    return float(np.percentile(values, quantile)) if len(values) else 0.0


def angular_series(times, rotations):
    q = np.array(rotations, dtype=float)
    t = np.array(times, dtype=float)
    valid = np.isfinite(q).all(axis=1)
    q, t = q[valid], t[valid]
    if len(q) < 4:
        return None
    q /= np.linalg.norm(q, axis=1)[:, None]
    a, b = q[1:], q[:-1].copy()
    b[:, :3] *= -1
    vector = a[:, 3:] * b[:, :3] + b[:, 3:] * a[:, :3] + np.cross(a[:, :3], b[:, :3])
    scalar = a[:, 3] * b[:, 3] - (a[:, :3] * b[:, :3]).sum(axis=1)
    sign = np.where(scalar < 0, -1, 1)
    vector *= sign[:, None]
    scalar *= sign
    length = np.linalg.norm(vector, axis=1)
    dt = np.diff(t)
    keep = (dt > 1e-7) & (dt < 0.2)
    rotation = vector * (2 * np.arctan2(length, scalar) / np.maximum(1e-12, length))[:, None]
    velocity = rotation[keep] / dt[keep, None]
    middle = ((t[1:] + t[:-1]) / 2)[keep]
    if len(velocity) < 4:
        return None
    delta = np.diff(middle)
    acceleration = np.diff(velocity, axis=0) / np.maximum(1e-7, delta[:, None])
    jerk = np.diff(acceleration, axis=0) / np.maximum(1e-7, delta[1:, None])
    speed = np.linalg.norm(velocity, axis=1)
    reverse = (
        ((velocity[1:] * velocity[:-1]).sum(axis=1) < 0)
        & (speed[1:] > 0.003)
        & (speed[:-1] > 0.003)
    )
    # Uniform interpolation is only a spectral-analysis grid, never video frames.
    step = float(np.median(delta))
    grid = np.arange(middle[0], middle[-1], step)
    uniform = np.stack([np.interp(grid, middle, velocity[:, axis]) for axis in range(3)], axis=1)
    spectrum = np.fft.rfft(uniform - uniform.mean(axis=0), axis=0)
    frequencies = np.fft.rfftfreq(len(uniform), step)
    power = (abs(spectrum) ** 2).sum(axis=1) * 2 / len(uniform) ** 2
    high = frequencies > 6
    return {
        "samples": len(q),
        "velocityP95RadS": percentile(speed),
        "accelerationP95RadS2": percentile(np.linalg.norm(acceleration, axis=1)),
        "jerkP95RadS3": percentile(np.linalg.norm(jerk, axis=1)),
        "reversalsPerSecond": float(reverse.sum() / (middle[-1] - middle[0])),
        "highBandVelocityPowerRadS2": float(power[high].sum()),
        "dominantHighHz": float(frequencies[high][np.argmax(power[high])]) if high.any() else None,
        "nearStoppedFraction": float(np.mean(speed < 1e-4)),
    }


def analyze(filename):
    data = json.loads(filename.read_text(encoding="utf-8"))
    frames = data["frames"]
    primary_path = filename.with_name(filename.name.replace("-overlay.json", "-primary.json"))
    dropped_after_primary_stop = 0
    if primary_path != filename and primary_path.exists():
        primary = json.loads(primary_path.read_text(encoding="utf-8"))
        end = primary["frames"][-1]["at"] + primary["timeOrigin"]
        kept = [f for f in frames if f["at"] + data["timeOrigin"] <= end]
        dropped_after_primary_stop = len(frames) - len(kept)
        frames = kept
    frames = [f for f in frames if f["at"] >= frames[0]["at"] + 5000]
    stages = sorted({stage for frame in frames for stage in frame["stages"]})
    result = {
        "source": str(filename),
        "frames": len(frames),
        "discardedWarmupMs": 5000,
        "droppedAfterPrimaryStop": dropped_after_primary_stop,
        "stages": {},
    }
    for stage in stages:
        selected = [frame for frame in frames if stage in frame["stages"]]
        result["stages"][stage] = {}
        for index, bone in enumerate(data["names"]):
            metric = angular_series(
                [f["at"] / 1000 for f in selected],
                [f["stages"][stage][index * 4 : index * 4 + 4] for f in selected],
            )
            if metric:
                result["stages"][stage][bone] = metric
    result["trackingRmsRad"] = {}
    for stage in ["retargeted", "artistic", "admissible", "temporal", "beforeVrm"]:
        selected = [f for f in frames if stage in f["stages"] and "finalVrm" in f["stages"]]
        for index, bone in enumerate(data["names"]):
            x = np.array(
                [f["stages"][stage][index * 4 : index * 4 + 4] for f in selected], dtype=float
            )
            y = np.array(
                [f["stages"]["finalVrm"][index * 4 : index * 4 + 4] for f in selected], dtype=float
            )
            if len(x) and np.isfinite(x).all() and np.isfinite(y).all():
                angle = 2 * np.arccos(np.clip(abs((x * y).sum(axis=1)), 0, 1))
                result["trackingRmsRad"][f"{stage}:{bone}"] = float(np.sqrt(np.mean(angle**2)))
    result["maxUnresolvedContacts"] = max(f["safety"]["unresolvedArmContacts"] for f in frames)
    result["armCorrectionFraction"] = float(
        np.mean([f["safety"]["armCorrections"] > 0 for f in frames])
    )
    result["compositionP95Ms"] = percentile([f["costMs"] for f in frames])
    result["renderDeltaP95Ms"] = percentile([f["delta"] * 1000 for f in frames])
    result["sampleCountIsNotArtisticAcceptance"] = True
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("inputs", nargs="+", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    report = [analyze(filename) for filename in args.inputs]
    args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({"output": str(args.output), "cases": len(report)}))


if __name__ == "__main__":
    main()
