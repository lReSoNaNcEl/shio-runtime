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
    "frames",
}
OPTIONAL_REQUEST_FIELDS = {"activity", "speech"}
CATALOG_REVISION = "expressive-v8-2026-10-30"
CALIBRATION_REVISION = "vrm-normalized-hands-v1"


def bounded_identity(value):
    return type(value) is int and 0 <= value <= 2_147_483_647


def bounded_text(value, maximum=128):
    return isinstance(value, str) and 1 <= len(value) <= maximum


def validate_request(value: object, profiles: dict) -> dict:
    if not isinstance(value, dict) or set(value) - OPTIONAL_REQUEST_FIELDS != REQUEST_FIELDS:
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
    dance = value["profileId"] == "dance_in_place"
    if not isinstance(p, dict) or set(p) != (
        PLAN_FIELDS | {"danceStyle"} if dance else PLAN_FIELDS
    ):
        raise ValueError("Invalid motion plan shape")
    if dance and p.get("danceStyle") not in ("smooth", "playful", "energetic"):
        raise ValueError("Invalid dance style")
    if not bounded_identity(p["planRevision"]) or any(
        not bounded_text(p[k]) for k in ("executionId", "continuityAnchor")
    ):
        raise ValueError("Invalid motion plan identity")
    profile = profiles[value["profileId"]]
    if profile.get("physicalAction") and (p["clockDomain"] != "local" or p["phaseId"] != "prepare"):
        raise ValueError("A physical action accepts only a local upper-body horizon")
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
    if value["frames"] != (120 if dance else 24 if profile["kind"] == "presence" else 60):
        raise ValueError("Invalid motion horizon")
    if "activity" in value and not isinstance(value["activity"], dict):
        raise ValueError("Invalid motion activity")
    if "speech" in value:
        speech = value["speech"]
        if (
            not isinstance(speech, dict)
            or set(speech)
            != {
                "playbackId",
                "startSample",
                "frames",
                "contextSamples",
                "followingSamples",
                "language",
                "text",
                "pcm",
            }
            or profile["kind"] != "presence"
            or p["clockDomain"] != "speech"
            or speech["playbackId"] != p["playbackId"]
            or not bounded_identity(speech["startSample"])
            or speech["startSample"] > 26_460_000
            or not isinstance(speech["text"], str)
            or len(speech["text"]) > 1200
            or not bounded_text(speech["pcm"], 440_000)
        ):
            raise ValueError("Invalid speech window identity")
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
            or q.get("danceStyle") != p.get("danceStyle")
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


def load_catalog():
    catalog = json.loads((ROOT / "motion-profiles.json").read_text(encoding="utf-8"))
    if (
        catalog["schemaVersion"] != 3
        or catalog["catalogRevision"] != CATALOG_REVISION
        or catalog["flashMotionFormat"]["protocolVersion"] != 1
    ):
        raise ValueError("Incompatible motion catalog")
    return catalog
