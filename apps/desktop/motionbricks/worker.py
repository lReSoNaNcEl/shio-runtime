"""Opt-in Main-owned worker using the existing bounded motion protocol."""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.append(str(ROOT.parent / "motion"))
from protocol import load_catalog, validate_continuation, validate_request

WIRE = sys.stdout


def output(value):
    WIRE.write(json.dumps(value, allow_nan=False, separators=(",", ":")) + "\n")
    WIRE.flush()


def main():
    sys.stdout = sys.stderr
    from backend import MODEL, SOURCE, MotionBricksBackend

    catalog = load_catalog()
    profiles = {entry["id"]: entry for entry in catalog["profiles"]}
    output({"type": "state", "status": "warming"})
    backend = MotionBricksBackend()
    try:
        # Compile owned Warp kernels and capture inference before admitting
        # per-horizon work to the existing Main deadline.
        backend.reset(0)
        backend.generate(profiles["presence_poised"], "prepare", 0, 0)
        backend.reset(0)
        ready = {
            "type": "ready",
            "catalogRevision": catalog["catalogRevision"],
            "format": {
                **catalog["format"],
                "sourceRevision": SOURCE,
                "modelRevision": MODEL,
            },
        }
        if backend.hand:
            from hand_prior import MODEL as HAND_MODEL

            ready["handModelRevision"] = HAND_MODEL
        output(ready)
        session, previous = None, None
        while line := sys.stdin.readline(4097):
            if len(line) > 4096:
                raise ValueError("Oversized request")
            raw = json.loads(
                line,
                parse_constant=lambda _: (_ for _ in ()).throw(
                    ValueError("Non-finite JSON")
                ),
            )
            activity = raw.pop("activity", None) if isinstance(raw, dict) else None
            if activity is not None and (
                not isinstance(activity, dict)
                or set(activity) != {"energy", "playbackId", "speaking"}
                or type(activity["energy"]) not in (int, float)
                or not 0 <= activity["energy"] <= 1
                or type(activity["speaking"]) is not bool
                or (
                    activity["playbackId"] is not None
                    and (
                        not isinstance(activity["playbackId"], str)
                        or not 1 <= len(activity["playbackId"]) <= 128
                    )
                )
            ):
                raise ValueError("Invalid bounded acoustic activity")
            request = validate_request(raw, profiles)
            if (
                activity
                and request["plan"]["clockDomain"] == "speech"
                and activity["playbackId"] != request["plan"]["playbackId"]
            ):
                raise ValueError("Stale acoustic playback")
            identity = tuple(
                request[key]
                for key in ("sessionId", "epoch", "modelGeneration", "avatarGeneration")
            )
            if session != identity and not request["reset"]:
                raise ValueError("Stale session")
            validate_continuation(previous, request)
            if request["reset"]:
                backend.reset(request["seed"])
                session = identity
            chunk = backend.generate(
                profiles[request["profileId"]],
                request["plan"]["phaseId"],
                request["fromFrame"],
                request["seed"],
                activity,
            )
            previous = request
            output({"type": "motion", **request, **chunk})
    finally:
        backend.close()


if __name__ == "__main__":
    try:
        main()
    except Exception as error:  # noqa: BLE001 - contain all provider failures at the process boundary
        output({"type": "error", "code": type(error).__name__})
        raise SystemExit(1) from None
