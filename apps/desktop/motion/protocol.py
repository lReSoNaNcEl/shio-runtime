"""Strict bounded identities for the Main-owned motion Adapter."""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PHASES = ("prepare", "stroke", "hold", "recover")
PLAN_FIELDS = {
    "executionId",
    "planRevision",
    "catalogRevision",
    "phaseId",
    "handScoreRevision",
    "handRigCalibrationRevision",
    "clockDomain",
    "playbackId",
    "continuityAnchor",
}
REQUEST_FIELDS = {
    "id",
    "sessionId",
    "epoch",
    "modelGeneration",
    "avatarGeneration",
    "profileId",
    "seed",
    "reset",
    "fromFrame",
    "protocolVersion",
    "plan",
}
CATALOG_REVISION = "living-v3-2026-10-27"
CALIBRATION_REVISION = "vrm-normalized-hands-v1"


def bounded_identity(value):
    return type(value) is int and 0 <= value <= 2_147_483_647


def bounded_text(value, maximum=128):
    return isinstance(value, str) and 1 <= len(value) <= maximum


def validate_request(value: object, profiles: dict) -> dict:
    if not isinstance(value, dict) or set(value) != REQUEST_FIELDS:
        raise ValueError("Invalid motion request shape")
    if any(
        not bounded_identity(value[k])
        for k in ("id", "epoch", "modelGeneration", "avatarGeneration", "seed", "fromFrame")
    ):
        raise ValueError("Invalid motion request identity")
    if not bounded_text(value["sessionId"]) or value["protocolVersion"] != 2:
        raise ValueError("Incompatible motion protocol")
    if value["profileId"] not in profiles or type(value["reset"]) is not bool:
        raise ValueError("Invalid motion profile/reset")
    if value["fromFrame"] % 4 or value["reset"] != (value["fromFrame"] == 0):
        raise ValueError("Invalid continuous frame boundary")
    p = value["plan"]
    if not isinstance(p, dict) or set(p) != PLAN_FIELDS:
        raise ValueError("Invalid motion plan shape")
    if not bounded_identity(p["planRevision"]) or any(
        not bounded_text(p[k]) for k in ("executionId", "continuityAnchor")
    ):
        raise ValueError("Invalid motion plan identity")
    profile = profiles[value["profileId"]]
    if profile.get("physicalAction"):
        raise ValueError("Procedural actions do not accept neural horizons")
    if (
        p["catalogRevision"] != CATALOG_REVISION
        or p["phaseId"] not in PHASES
        or p["handRigCalibrationRevision"] != CALIBRATION_REVISION
        or p["handScoreRevision"] != profile["handScore"]["revision"]
    ):
        raise ValueError("Incompatible phase/hand score")
    if p["clockDomain"] not in ("local", "speech") or (
        (p["clockDomain"] == "speech") != bounded_text(p["playbackId"])
    ):
        raise ValueError("Incompatible playback identity")
    if p["clockDomain"] == "local" and p["playbackId"] is not None:
        raise ValueError("Local clock cannot retain playback authority")
    return value


def validate_continuation(previous: dict | None, request: dict):
    if previous is None or request["reset"]:
        return
    if request["id"] <= previous["id"]:
        raise ValueError("Stale request sequence")
    p, q = previous["plan"], request["plan"]
    if p["continuityAnchor"] != q["continuityAnchor"]:
        raise ValueError("Unknown continuity anchor")
    if p["executionId"] == q["executionId"]:
        if (
            q["planRevision"] < p["planRevision"]
            or PHASES.index(q["phaseId"]) < PHASES.index(p["phaseId"])
            or previous["profileId"] != request["profileId"]
            or (
                q["planRevision"] == p["planRevision"]
                and (q["clockDomain"] != p["clockDomain"] or q["playbackId"] != p["playbackId"])
            )
        ):
            raise ValueError("Stale phase plan")
    elif q["phaseId"] != "prepare":
        raise ValueError("New execution must prepare")


def phase_prompt(profile: dict, phase: str) -> str:
    instructions = {
        "prepare": (
            "Prepare slowly from the current pose; do not repeat the expressive accent yet."
        ),
        "stroke": "Perform one readable expressive accent from the prepared pose.",
        "hold": "Hold the target softly without repeating the gesture or resetting arms.",
        "recover": (
            "Release and lower both arms smoothly to relaxed standing, "
            "wrists and fingers relaxing together."
        ),
    }
    return profile["conditioningRefs"]["prompt"] + " " + instructions[phase]


def load_catalog():
    catalog = json.loads((ROOT / "motion-profiles.json").read_text(encoding="utf-8"))
    if (
        catalog["schemaVersion"] != 3
        or catalog["catalogRevision"] != CATALOG_REVISION
        or catalog["format"]["protocolVersion"] != 2
    ):
        raise ValueError("Incompatible motion catalog")
    return catalog
