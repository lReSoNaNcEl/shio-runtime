"""Owned NDJSON worker. Main supplies only validated session/semantic identities."""

from __future__ import annotations

import json
import sys
from pathlib import Path

from protocol import load_catalog, phase_prompt, validate_continuation, validate_request

ROOT = Path(__file__).resolve().parent
WIRE = sys.stdout
MAX_LINE = 4096


def output(value: dict) -> None:
    WIRE.write(json.dumps(value, allow_nan=False, separators=(",", ":")) + "\n")
    WIRE.flush()


def main() -> int:
    sys.stdout = sys.stderr
    from backend import ArdyBackend
    from research import load_pins

    catalog = load_catalog()
    pins = load_pins()
    if (
        catalog["format"]["sourceRevision"] != pins["source"]["revision"]
        or catalog["format"]["modelRevision"] != pins["motion"]["revision"]
    ):
        raise ValueError("Incompatible pinned generator")
    profiles = {entry["id"]: entry for entry in catalog["profiles"]}
    backend = ArdyBackend()
    output({"type": "state", "status": "warming"})
    conditioning = [
        {"id": f"{p['id']}:{phase}", "prompt": phase_prompt(p, phase), "stationary": True}
        for p in profiles.values()
        for phase in ("prepare", "stroke", "hold", "recover")
    ]
    backend.warmup(conditioning)
    output(
        {
            "type": "ready",
            "catalogRevision": catalog["catalogRevision"],
            "format": catalog["format"],
        }
    )
    session = seed = previous = None
    while line := sys.stdin.readline(MAX_LINE + 1):
        if len(line) > MAX_LINE:
            output({"type": "error", "code": "oversized_request"})
            return 1
        try:
            request = validate_request(
                json.loads(
                    line,
                    parse_constant=lambda _: (_ for _ in ()).throw(ValueError("Non-finite JSON")),
                ),
                profiles,
            )
            identity = (
                request["sessionId"],
                request["epoch"],
                request["modelGeneration"],
                request["avatarGeneration"],
            )
            if session != identity and not request["reset"]:
                raise ValueError("Stale motion session")
            validate_continuation(previous, request)
            if request["reset"]:
                backend.reset(request["seed"])
                session = identity
            elif seed != request["seed"] or (
                previous and previous["plan"]["executionId"] != request["plan"]["executionId"]
            ):
                backend.reseed(request["seed"])
            seed = request["seed"]
            profile = profiles[request["profileId"]]
            chunk = backend.generate(
                phase_prompt(profile, request["plan"]["phaseId"]), True, request["fromFrame"]
            )
            previous = request
            output({"type": "motion", **request, **chunk})
        except Exception as error:
            output({"type": "error", "code": type(error).__name__})
            return 1
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        output({"type": "error", "code": type(error).__name__})
        raise SystemExit(1) from None
