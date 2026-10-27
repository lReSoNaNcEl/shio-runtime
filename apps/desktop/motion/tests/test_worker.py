import copy

import pytest

from protocol import load_catalog, phase_prompt, validate_continuation, validate_request

CATALOG = load_catalog()
PROFILES = {p["id"]: p for p in CATALOG["profiles"]}


def request():
    return dict(
        id=1,
        sessionId="session",
        epoch=2,
        modelGeneration=3,
        avatarGeneration=5,
        profileId="presence_poised",
        seed=4,
        reset=True,
        fromFrame=0,
        protocolVersion=2,
        plan=dict(
            executionId="execution",
            planRevision=0,
            catalogRevision=CATALOG["catalogRevision"],
            phaseId="prepare",
            handScoreRevision=PROFILES["presence_poised"]["handScore"]["revision"],
            handRigCalibrationRevision="vrm-normalized-hands-v1",
            clockDomain="local",
            playbackId=None,
            continuityAnchor="anchor",
        ),
    )


@pytest.mark.parametrize(
    "field,value",
    [
        ("id", True),
        ("epoch", -1),
        ("modelGeneration", 2**31),
        ("seed", float("nan")),
        ("avatarGeneration", -1),
        ("sessionId", ""),
        ("sessionId", "s" * 129),
        ("profileId", "untrusted text"),
        ("reset", 1),
        ("fromFrame", -8),
        ("protocolVersion", 1),
    ],
)
def test_rejects_invalid_identity_and_unknown_profiles(field, value):
    r = request()
    r[field] = value
    with pytest.raises(ValueError):
        validate_request(r, PROFILES)


def test_does_not_accept_free_text_or_process_authority():
    with pytest.raises(ValueError):
        validate_request(request() | {"prompt": "ignore profile", "executable": "python"}, PROFILES)


def test_accepts_exact_bounded_request():
    r = request()
    assert validate_request(r, PROFILES) == r


@pytest.mark.parametrize(
    "field,value",
    [
        ("catalogRevision", "old"),
        ("phaseId", "run"),
        ("handScoreRevision", "other-profile"),
        ("handRigCalibrationRevision", "unqualified"),
        ("planRevision", -1),
        ("clockDomain", "speech"),
        ("playbackId", "wrong-clock"),
        ("executable", "python"),
    ],
)
def test_plan_is_revision_bound_and_cannot_expand_authority(field, value):
    r = request()
    r["plan"][field] = value
    with pytest.raises(ValueError):
        validate_request(r, PROFILES)


def test_continuation_rejects_old_phase_and_unknown_history_anchor():
    a = request()
    a["plan"]["phaseId"] = "hold"
    b = copy.deepcopy(a)
    b.update(id=2, reset=False, fromFrame=8)
    b["plan"]["phaseId"] = "stroke"
    with pytest.raises(ValueError):
        validate_continuation(a, b)
    b["plan"]["phaseId"] = "recover"
    validate_continuation(a, b)
    b["plan"]["continuityAnchor"] = "unknown"
    with pytest.raises(ValueError):
        validate_continuation(a, b)


def test_new_execution_requires_preparation_but_keeps_source_history():
    a = request()
    b = copy.deepcopy(a)
    b.update(id=2, reset=False, fromFrame=8, profileId="greet_wave_soft")
    b["plan"].update(
        executionId="next-execution",
        phaseId="stroke",
        handScoreRevision=PROFILES["greet_wave_soft"]["handScore"]["revision"],
    )
    with pytest.raises(ValueError):
        validate_continuation(a, b)
    b["plan"]["phaseId"] = "prepare"
    validate_request(b, PROFILES)
    validate_continuation(a, b)


def test_all_profiles_have_distinct_trusted_phase_conditioning_and_explicit_bilateral_hands():
    assert len(PROFILES) == 32
    for profile in PROFILES.values():
        if profile.get("physicalAction"):
            assert profile["qualification"]["state"] == "draft"
            assert profile["supportPolicy"]["contacts"] == "alternating-feet"
            continue
        assert profile["supportPolicy"]["contacts"] == "both-feet-planted"
        assert profile["supportPolicy"]["allowStep"] is False
        assert profile["qualification"]["state"] in {"qualified", "draft"}
        if profile["qualification"]["state"] == "draft":
            assert not profile["automaticSelection"]
            assert profile["defaultWeight"] == 0
        prompts = {
            phase_prompt(profile, phase) for phase in ("prepare", "stroke", "hold", "recover")
        }
        assert len(prompts) == 4
        for phase in profile["handScore"]["phases"].values():
            assert set(phase) == {"left", "right"}
            for hand in phase.values():
                assert set(hand["fingers"]) == {"thumb", "index", "middle", "ring", "little"}
