import time
from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class AudioBoundaryMetrics:
    profile: str
    input_duration_ms: float
    output_duration_ms: float
    detected_leading_silence_ms: float
    detected_trailing_silence_ms: float
    trimmed_leading_ms: float
    trimmed_trailing_ms: float
    retained_leading_ms: float
    retained_trailing_ms: float
    fade_in_ms: float
    fade_out_ms: float
    postprocess_latency_ms: float
    bypass_reason: str | None


@dataclass(frozen=True)
class _BoundaryProfile:
    name: str
    absolute_floor: float
    noise_multiplier: float
    retained_leading_ms: float
    retained_trailing_ms: float
    minimum_removable_ms: float
    maximum_trim_ms: float
    stable_activity_ms: float
    fade_ms: float = 10.0


_NORMAL_PROFILE = _BoundaryProfile(
    name="normal-v1",
    absolute_floor=0.002,
    noise_multiplier=2.8,
    retained_leading_ms=35.0,
    retained_trailing_ms=55.0,
    minimum_removable_ms=80.0,
    maximum_trim_ms=1000.0,
    stable_activity_ms=30.0,
)
_NONVERBAL_PROFILE = _BoundaryProfile(
    name="nonverbal-v1",
    absolute_floor=0.0008,
    noise_multiplier=2.0,
    retained_leading_ms=65.0,
    retained_trailing_ms=110.0,
    minimum_removable_ms=130.0,
    maximum_trim_ms=700.0,
    stable_activity_ms=25.0,
)
_NONVERBAL_EMOTIONS = {"laugh", "chuckle", "sigh", "gasp", "groan", "crying", "whisper"}
_FRAME_MS = 10.0
_HOP_MS = 5.0
_NOISE_EDGE_WINDOW_MS = 200.0
_MAX_THRESHOLD_PEAK_RATIO = 0.5
_MINIMUM_CLIP_MS = 180.0
_MAXIMUM_TRIM_FRACTION = 0.45
_QUIET_ONSET_LOOKBACK_MS = 100.0
_QUIET_ONSET_MAX_GAP_MS = 15.0


def process_audio_boundaries(
    audio: np.ndarray,
    sample_rate: int,
    *,
    utterance_kind: str,
    emotion: str,
) -> tuple[np.ndarray, AudioBoundaryMetrics]:
    started = time.perf_counter()
    samples = _valid_audio(audio)
    profile = _select_profile(utterance_kind, emotion)
    input_duration_ms = _duration_ms(len(samples), sample_rate)

    if sample_rate <= 0 or samples.size == 0:
        return samples, _bypass_metrics(profile, input_duration_ms, "invalid-audio", started)
    if input_duration_ms < _MINIMUM_CLIP_MS:
        return samples, _bypass_metrics(profile, input_duration_ms, "short-clip", started)

    frame_samples = max(1, round(sample_rate * _FRAME_MS / 1000.0))
    hop_samples = max(1, round(sample_rate * _HOP_MS / 1000.0))
    rms = _frame_rms(samples, frame_samples, hop_samples)
    if rms.size == 0:
        return samples, _bypass_metrics(profile, input_duration_ms, "short-analysis", started)

    maximum_rms = float(np.max(rms))
    if maximum_rms < profile.absolute_floor * 1.25:
        return samples, _bypass_metrics(profile, input_duration_ms, "effectively-silent", started)

    noise_floor = _estimate_noise_floor(rms)
    adaptive_threshold = min(
        noise_floor * profile.noise_multiplier,
        maximum_rms * _MAX_THRESHOLD_PEAK_RATIO,
    )
    threshold = max(profile.absolute_floor, adaptive_threshold)
    active = rms >= threshold
    stable_frames = max(2, round(profile.stable_activity_ms / _HOP_MS))
    region = _stable_activity_region(active, stable_frames)
    if region is None:
        return samples, _bypass_metrics(profile, input_duration_ms, "no-stable-activity", started)

    first_active_frame, last_active_frame = region
    activity_start = first_active_frame * hop_samples
    activity_end = min(len(samples), last_active_frame * hop_samples + frame_samples)
    leading_ms = _duration_ms(activity_start, sample_rate)
    trailing_ms = _duration_ms(len(samples) - activity_end, sample_rate)

    if leading_ms < 20.0 and trailing_ms < 20.0:
        return samples, _bypass_metrics(
            profile,
            input_duration_ms,
            "activity-at-boundaries",
            started,
            leading_ms=leading_ms,
            trailing_ms=trailing_ms,
        )

    trim_leading_ms = _confirmed_trim(
        leading_ms,
        profile.retained_leading_ms,
        profile.minimum_removable_ms,
        profile.maximum_trim_ms,
    )
    trim_trailing_ms = _confirmed_trim(
        trailing_ms,
        profile.retained_trailing_ms,
        profile.minimum_removable_ms,
        profile.maximum_trim_ms,
    )
    if trim_leading_ms == 0.0 and trim_trailing_ms == 0.0:
        return samples, _bypass_metrics(
            profile,
            input_duration_ms,
            "no-confirmed-silence",
            started,
            leading_ms=leading_ms,
            trailing_ms=trailing_ms,
        )
    if (trim_leading_ms + trim_trailing_ms) / input_duration_ms > _MAXIMUM_TRIM_FRACTION:
        return samples, _bypass_metrics(
            profile,
            input_duration_ms,
            "excessive-trim",
            started,
            leading_ms=leading_ms,
            trailing_ms=trailing_ms,
        )

    start_sample = min(len(samples) - 1, max(0, round(trim_leading_ms * sample_rate / 1000.0)))
    end_sample = max(
        start_sample + 1,
        len(samples) - round(trim_trailing_ms * sample_rate / 1000.0),
    )
    processed = samples[start_sample:end_sample].copy()
    if processed.size == 0 or _duration_ms(len(processed), sample_rate) < _MINIMUM_CLIP_MS:
        return samples, _bypass_metrics(
            profile,
            input_duration_ms,
            "invalid-output",
            started,
            leading_ms=leading_ms,
            trailing_ms=trailing_ms,
        )

    maximum_fade_samples = min(
        round(profile.fade_ms * sample_rate / 1000.0),
        max(0, (len(processed) - 1) // 2),
    )
    fade_in_samples = maximum_fade_samples if trim_leading_ms > 0 else 0
    fade_out_samples = maximum_fade_samples if trim_trailing_ms > 0 else 0
    if fade_in_samples > 0:
        processed[:fade_in_samples] *= _half_cosine_ramp(fade_in_samples)
    if fade_out_samples > 0:
        processed[-fade_out_samples:] *= _half_cosine_ramp(fade_out_samples)[::-1]

    processed = np.clip(processed, -1.0, 1.0).astype(np.float32, copy=False)
    latency_ms = (time.perf_counter() - started) * 1000.0
    metrics = AudioBoundaryMetrics(
        profile=profile.name,
        input_duration_ms=input_duration_ms,
        output_duration_ms=_duration_ms(len(processed), sample_rate),
        detected_leading_silence_ms=leading_ms,
        detected_trailing_silence_ms=trailing_ms,
        trimmed_leading_ms=trim_leading_ms,
        trimmed_trailing_ms=trim_trailing_ms,
        retained_leading_ms=max(0.0, leading_ms - trim_leading_ms),
        retained_trailing_ms=max(0.0, trailing_ms - trim_trailing_ms),
        fade_in_ms=_duration_ms(fade_in_samples, sample_rate),
        fade_out_ms=_duration_ms(fade_out_samples, sample_rate),
        postprocess_latency_ms=latency_ms,
        bypass_reason=None,
    )
    return processed, metrics


def _valid_audio(audio: np.ndarray) -> np.ndarray:
    samples = np.asarray(audio, dtype=np.float32).reshape(-1)
    return np.clip(np.nan_to_num(samples, nan=0.0, posinf=1.0, neginf=-1.0), -1.0, 1.0).astype(
        np.float32, copy=False
    )


def _select_profile(utterance_kind: str, emotion: str) -> _BoundaryProfile:
    if utterance_kind in {"nonverbal", "short-interjection"}:
        return _NONVERBAL_PROFILE
    if emotion.strip().lower() in _NONVERBAL_EMOTIONS:
        return _NONVERBAL_PROFILE
    return _NORMAL_PROFILE


def _frame_rms(audio: np.ndarray, frame_samples: int, hop_samples: int) -> np.ndarray:
    if len(audio) < frame_samples:
        return np.array([], dtype=np.float32)
    values = [
        float(np.sqrt(np.mean(np.square(audio[start : start + frame_samples], dtype=np.float64))))
        for start in range(0, len(audio) - frame_samples + 1, hop_samples)
    ]
    return np.asarray(values, dtype=np.float32)


def _estimate_noise_floor(rms: np.ndarray) -> float:
    edge_frame_count = max(1, round(_NOISE_EDGE_WINDOW_MS / _HOP_MS))
    edge_rms = np.concatenate((rms[:edge_frame_count], rms[-edge_frame_count:]))
    return float(np.percentile(edge_rms, 20))


def _stable_activity_region(active: np.ndarray, stable_frames: int) -> tuple[int, int] | None:
    if len(active) < stable_frames:
        return None
    stable_starts = np.flatnonzero(
        np.convolve(active.astype(np.int16), np.ones(stable_frames, dtype=np.int16), mode="valid")
        == stable_frames
    )
    if stable_starts.size == 0:
        return None
    first = _backtrack_quiet_onset(
        active,
        int(stable_starts[0]),
        max_frames=round(_QUIET_ONSET_LOOKBACK_MS / _HOP_MS),
        max_gap_frames=round(_QUIET_ONSET_MAX_GAP_MS / _HOP_MS),
    )
    last = int(stable_starts[-1] + stable_frames - 1)

    active_indices = np.flatnonzero(active)
    later = active_indices[active_indices >= last]
    if later.size:
        last = int(later[-1])
    return first, last


def _backtrack_quiet_onset(
    active: np.ndarray, stable_start: int, *, max_frames: int, max_gap_frames: int
) -> int:
    first = stable_start
    gap = 0
    minimum = max(0, stable_start - max_frames)
    for index in range(stable_start - 1, minimum - 1, -1):
        if active[index]:
            first = index
            gap = 0
            continue
        gap += 1
        if gap > max_gap_frames:
            break
    return first


def _confirmed_trim(
    detected_ms: float,
    retained_ms: float,
    minimum_removable_ms: float,
    maximum_trim_ms: float,
) -> float:
    removable_ms = max(0.0, detected_ms - retained_ms)
    if removable_ms < minimum_removable_ms:
        return 0.0
    return min(removable_ms, maximum_trim_ms)


def _half_cosine_ramp(length: int) -> np.ndarray:
    phase = np.linspace(0.0, np.pi, length, dtype=np.float32)
    return ((1.0 - np.cos(phase)) * 0.5).astype(np.float32)


def _duration_ms(samples: int, sample_rate: int) -> float:
    if sample_rate <= 0:
        return 0.0
    return samples * 1000.0 / sample_rate


def _bypass_metrics(
    profile: _BoundaryProfile,
    duration_ms: float,
    reason: str,
    started: float,
    *,
    leading_ms: float = 0.0,
    trailing_ms: float = 0.0,
) -> AudioBoundaryMetrics:
    return AudioBoundaryMetrics(
        profile=profile.name,
        input_duration_ms=duration_ms,
        output_duration_ms=duration_ms,
        detected_leading_silence_ms=leading_ms,
        detected_trailing_silence_ms=trailing_ms,
        trimmed_leading_ms=0.0,
        trimmed_trailing_ms=0.0,
        retained_leading_ms=leading_ms,
        retained_trailing_ms=trailing_ms,
        fade_in_ms=0.0,
        fade_out_ms=0.0,
        postprocess_latency_ms=(time.perf_counter() - started) * 1000.0,
        bypass_reason=reason,
    )
