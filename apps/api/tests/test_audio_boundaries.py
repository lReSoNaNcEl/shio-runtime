import numpy as np

from app.tts.audio_boundaries import process_audio_boundaries

SAMPLE_RATE = 16_000


def _samples(duration_ms: float, amplitude: float = 0.0) -> np.ndarray:
    return np.full(round(SAMPLE_RATE * duration_ms / 1000.0), amplitude, dtype=np.float32)


def _speech_clip(
    *,
    leading_ms: float = 220.0,
    speech_ms: float = 500.0,
    trailing_ms: float = 260.0,
    amplitude: float = 0.08,
) -> np.ndarray:
    return np.concatenate(
        [
            _samples(leading_ms),
            _samples(speech_ms, amplitude),
            _samples(trailing_ms),
        ]
    )


def test_known_silence_is_measured_and_only_confirmed_silence_is_trimmed():
    audio = _speech_clip()

    output, metrics = process_audio_boundaries(
        audio, SAMPLE_RATE, utterance_kind="normal", emotion="neutral"
    )

    assert abs(metrics.detected_leading_silence_ms - 220.0) <= 15.0
    assert abs(metrics.detected_trailing_silence_ms - 260.0) <= 15.0
    assert metrics.trimmed_leading_ms > 80.0
    assert metrics.trimmed_trailing_ms > 80.0
    assert metrics.retained_leading_ms >= 25.0
    assert metrics.retained_trailing_ms >= 40.0
    assert len(output) < len(audio)
    assert metrics.bypass_reason is None


def test_very_short_silent_and_ambiguous_low_level_clips_are_bypassed():
    cases = [
        (_samples(120.0, 0.1), "short-clip"),
        (_samples(500.0), "effectively-silent"),
        (_samples(500.0, 0.001), "effectively-silent"),
    ]

    for audio, reason in cases:
        output, metrics = process_audio_boundaries(
            audio, SAMPLE_RATE, utterance_kind="normal", emotion="neutral"
        )
        assert np.array_equal(output, audio)
        assert metrics.bypass_reason == reason
        assert metrics.trimmed_leading_ms == 0.0
        assert metrics.trimmed_trailing_ms == 0.0


def test_quiet_onset_and_quiet_final_consonant_are_preserved():
    audio = np.concatenate(
        [
            _samples(220.0),
            _samples(40.0, 0.004),
            _samples(400.0, 0.08),
            _samples(40.0, 0.004),
            _samples(260.0),
        ]
    )

    output, metrics = process_audio_boundaries(
        audio, SAMPLE_RATE, utterance_kind="normal", emotion="neutral"
    )

    assert abs(metrics.detected_leading_silence_ms - 220.0) <= 15.0
    assert abs(metrics.detected_trailing_silence_ms - 260.0) <= 15.0
    retained_onset = round(metrics.retained_leading_ms * SAMPLE_RATE / 1000.0)
    retained_tail = round(metrics.retained_trailing_ms * SAMPLE_RATE / 1000.0)
    assert np.max(np.abs(output[retained_onset : retained_onset + _samples(40.0).size])) > 0
    assert np.max(np.abs(output[-retained_tail - _samples(40.0).size : -retained_tail])) > 0


def test_nonverbal_profile_preserves_breath_like_tail_more_conservatively():
    audio = np.concatenate(
        [
            _samples(220.0),
            _samples(700.0, 0.08),
            _samples(100.0, 0.0012),
            _samples(300.0),
        ]
    )

    normal_output, normal = process_audio_boundaries(
        audio, SAMPLE_RATE, utterance_kind="normal", emotion="neutral"
    )
    nonverbal_output, nonverbal = process_audio_boundaries(
        audio, SAMPLE_RATE, utterance_kind="nonverbal", emotion="sigh"
    )

    assert normal.profile == "normal-v1"
    assert nonverbal.profile == "nonverbal-v1"
    assert nonverbal.trimmed_trailing_ms < normal.trimmed_trailing_ms
    assert len(nonverbal_output) > len(normal_output)
    assert nonverbal.retained_trailing_ms >= 100.0


def test_fades_reduce_endpoint_discontinuities_and_output_is_valid_float32():
    audio = _speech_clip(leading_ms=220.0, trailing_ms=260.0)

    output, metrics = process_audio_boundaries(
        audio, SAMPLE_RATE, utterance_kind="technical", emotion="neutral"
    )

    assert 8.0 <= metrics.fade_in_ms <= 15.0
    assert 8.0 <= metrics.fade_out_ms <= 15.0
    assert output[0] == 0.0
    assert output[-1] == 0.0
    assert output.dtype == np.float32
    assert np.all(np.isfinite(output))
    assert float(np.max(np.abs(output))) <= 1.0
    assert metrics.fade_in_ms * SAMPLE_RATE / 1000.0 <= len(output) / 2
    assert abs(metrics.output_duration_ms - len(output) * 1000.0 / SAMPLE_RATE) < 0.001


def test_fades_are_applied_only_to_trimmed_boundaries():
    leading_only = _speech_clip(leading_ms=220.0, trailing_ms=0.0)
    leading_output, leading_metrics = process_audio_boundaries(
        leading_only, SAMPLE_RATE, utterance_kind="normal", emotion="neutral"
    )
    assert leading_metrics.trimmed_leading_ms > 0
    assert leading_metrics.trimmed_trailing_ms == 0
    assert leading_metrics.fade_in_ms == 10.0
    assert leading_metrics.fade_out_ms == 0.0
    assert leading_output[0] == 0.0
    assert np.isclose(leading_output[-1], 0.08)

    trailing_only = _speech_clip(leading_ms=0.0, trailing_ms=260.0)
    trailing_output, trailing_metrics = process_audio_boundaries(
        trailing_only, SAMPLE_RATE, utterance_kind="normal", emotion="neutral"
    )
    assert trailing_metrics.trimmed_leading_ms == 0
    assert trailing_metrics.trimmed_trailing_ms > 0
    assert trailing_metrics.fade_in_ms == 0.0
    assert trailing_metrics.fade_out_ms == 10.0
    assert np.isclose(trailing_output[0], 0.08)
    assert trailing_output[-1] == 0.0


def test_intermittent_quiet_onset_is_backtracked_without_using_distant_noise():
    intermittent_onset = np.concatenate(
        [_samples(5.0, 0.004) if index % 2 == 0 else _samples(5.0) for index in range(14)]
    )
    audio = np.concatenate(
        [
            _samples(80.0),
            _samples(5.0, 0.004),
            _samples(115.0),
            intermittent_onset,
            _samples(400.0, 0.08),
            _samples(250.0),
        ]
    )

    output, metrics = process_audio_boundaries(
        audio, SAMPLE_RATE, utterance_kind="normal", emotion="neutral"
    )

    assert 190.0 <= metrics.detected_leading_silence_ms <= 210.0
    retained_onset = round(metrics.retained_leading_ms * SAMPLE_RATE / 1000.0)
    assert np.max(np.abs(output[retained_onset : retained_onset + len(intermittent_onset)])) > 0


def test_invalid_values_are_sanitized_without_invalid_output():
    audio = _speech_clip()
    audio[0] = np.nan
    audio[1] = np.inf
    audio[2] = -np.inf
    audio[3] = 4.0

    output, _metrics = process_audio_boundaries(
        audio, SAMPLE_RATE, utterance_kind="normal", emotion="neutral"
    )

    assert output.dtype == np.float32
    assert np.all(np.isfinite(output))
    assert float(np.max(output)) <= 1.0
    assert float(np.min(output)) >= -1.0
