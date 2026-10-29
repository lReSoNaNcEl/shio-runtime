"""Strict bounded acoustic metadata. No PCM, words, or future audio."""

import math


def number(value, low, high, integer=False):
    return (
        type(value) in ((int,) if integer else (int, float))
        and math.isfinite(value)
        and low <= value <= high
    )


def validate_activity(activity):
    if activity is None:
        return None
    if (
        not isinstance(activity, dict)
        or not {"energy", "playbackId", "speaking"} <= set(activity)
        or set(activity) - {"energy", "playbackId", "speaking", "prosody"}
        or not number(activity["energy"], 0, 1)
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
    prosody = activity.get("prosody")
    if prosody is not None and (
        not isinstance(prosody, dict)
        or not {"throughSample", "sampleRate", "envelope", "phase", "accent", "leadMs"}
        <= set(prosody)
        or set(prosody)
        - {
            "throughSample",
            "sampleRate",
            "envelope",
            "phase",
            "accent",
            "leadMs",
            "available",
        }
        or not number(prosody["throughSample"], 0, 2**48, True)
        or not number(prosody["sampleRate"], 8000, 192000, True)
        or not isinstance(prosody["envelope"], list)
        or not 1 <= len(prosody["envelope"]) <= 12
        or not all(number(value, 0, 1) for value in prosody["envelope"])
        or prosody["phase"] not in ("onset", "speech", "pause")
        or not number(prosody["accent"], 0, 1)
        or not number(prosody["leadMs"], 0, 4000)
        or activity["playbackId"] is None
    ):
        raise ValueError("Invalid consumed speech context")
    available = (prosody or {}).get("available")
    if available is not None and (
        not isinstance(available, dict)
        or set(available) != {"startSample", "stepSamples", "energy", "finalSample"}
        or not number(available["startSample"], 0, 2**48, True)
        or not number(
            available["stepSamples"], 1, prosody["sampleRate"] * 0.05 + 1, True
        )
        or not isinstance(available["energy"], list)
        or not 1 <= len(available["energy"]) <= 30
        or not all(number(value, 0, 1) for value in available["energy"])
        or abs(available["startSample"] - prosody["throughSample"])
        > prosody["sampleRate"]
        or (
            available["finalSample"] is not None
            and not number(
                available["finalSample"], available["startSample"], 2**48, True
            )
        )
    ):
        raise ValueError("Invalid available PCM context")
    return activity


def accent_deadline_ms(activity, maximum):
    """Select only an already available sustained envelope maximum.

    No prediction beyond the submitted buffer; an accent earlier than the
    shortest native transition is discarded, never rescheduled late.
    """
    prosody = (activity or {}).get("prosody") or {}
    available = prosody.get("available")
    if not available or not activity["speaking"]:
        return None
    rate = prosody["sampleRate"]
    start = prosody["throughSample"] + prosody["leadMs"] * rate / 1000
    candidates = []
    energies = available["energy"]
    for i in range(1, len(energies) - 1):
        sample = available["startSample"] + (i + 0.5) * available["stepSamples"]
        if available["finalSample"] is not None and sample >= available["finalSample"]:
            continue
        milliseconds = (sample - start) * 1000 / rate
        if (
            580 <= milliseconds <= maximum
            and energies[i] >= max(0.08, energies[i - 1], energies[i + 1])
            and energies[i] > min(energies[i - 1], energies[i + 1]) * 1.15
        ):
            candidates.append(
                (
                    min(energies[i], (energies[i - 1] + energies[i + 1]) / 2),
                    milliseconds,
                )
            )
    return max(candidates)[1] if candidates else None
