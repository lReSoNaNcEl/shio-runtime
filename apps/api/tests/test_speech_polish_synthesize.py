import asyncio
import hashlib
import inspect
import io

import numpy as np
from scipy.io import wavfile

from app.routes import synthesize as route
from app.tts import SynthesisResult
from app.tts.f5_local import F5LocalEngine


class _SyntheticEngine:
    def __init__(self):
        self.calls = 0

    def is_available(self) -> bool:
        return True

    def synthesize(self, *, text, language, emotion, voice, speed):
        self.calls += 1
        sample_rate = 16_000
        audio = np.concatenate(
            [
                np.zeros(round(sample_rate * 0.22), dtype=np.float32),
                np.full(round(sample_rate * 0.5), 0.08, dtype=np.float32),
                np.zeros(round(sample_rate * 0.26), dtype=np.float32),
            ]
        )
        return SynthesisResult(
            audio=audio,
            sample_rate=sample_rate,
            duration_sec=len(audio) / sample_rate,
            language=language,
            emotion=emotion,
            engine="f5",
            latency_ms=12.5,
            rtf=0.1,
            text=text,
        )


def _install_engine(monkeypatch) -> _SyntheticEngine:
    engine = _SyntheticEngine()
    route._tts_cache.clear()
    monkeypatch.setattr(route, "_f5_engine", engine)
    monkeypatch.setattr(route, "_request_voice_id", lambda _request: "synthetic")
    return engine


def _run(request: route.SynthesizeRequest):
    return asyncio.run(route.synthesize(request))


def test_response_headers_duration_and_cache_hit_preserve_boundary_metrics(monkeypatch):
    engine = _install_engine(monkeypatch)
    request = route.SynthesizeRequest(
        text="Synthetic boundary response",
        language="en",
        emotion="neutral",
        voiceId="synthetic",
        utteranceKind="technical",
    )

    first = _run(request)
    second = _run(request)

    assert first.headers["X-Cache"] == "MISS"
    assert second.headers["X-Cache"] == "HIT"
    assert engine.calls == 1
    metric_headers = [
        "X-Audio-Boundary-Profile",
        "X-Audio-Leading-Silence-Ms",
        "X-Audio-Trailing-Silence-Ms",
        "X-Audio-Trimmed-Leading-Ms",
        "X-Audio-Trimmed-Trailing-Ms",
        "X-Audio-Fade-In-Ms",
        "X-Audio-Fade-Out-Ms",
        "X-Audio-Postprocess-Ms",
    ]
    for header in metric_headers:
        assert first.headers[header] == second.headers[header]

    sample_rate, samples = wavfile.read(io.BytesIO(first.body))
    assert sample_rate == 16_000
    assert abs(float(first.headers["X-Duration-Sec"]) - len(samples) / sample_rate) < 1e-6


def test_boundary_processing_runs_after_pitch_processing(monkeypatch):
    _install_engine(monkeypatch)
    trace: list[str] = []
    original_pitch = route._apply_pitch
    original_boundaries = route._apply_audio_boundaries

    def traced_pitch(result, semitones):
        trace.append("pitch")
        return original_pitch(result, 0.0)

    def traced_boundaries(result, request, emotion):
        trace.append("boundaries")
        return original_boundaries(result, request, emotion)

    monkeypatch.setattr(route, "_apply_pitch", traced_pitch)
    monkeypatch.setattr(route, "_apply_audio_boundaries", traced_boundaries)
    _run(
        route.SynthesizeRequest(
            text="Unique ordering check",
            language="en",
            emotion="neutral",
            pitch=2.0,
        )
    )

    assert trace == ["pitch", "boundaries"]


def test_cache_profile_version_and_utterance_kind_invalidate_old_entries(monkeypatch):
    request = route.SynthesizeRequest(text="cache key", language="en", utteranceKind="normal")
    current = route._cache_key(request, "cache key", "neutral")
    old_raw = "|".join(
        [
            "cache key",
            "en",
            "neutral",
            route.default_voice_id(),
            "1.0",
            "0.0",
            "f5",
            "normal",
            "f5-v2",
        ]
    )
    old = hashlib.sha256(old_raw.encode("utf-8")).hexdigest()
    nonverbal = route._cache_key(
        request.model_copy(update={"utteranceKind": "nonverbal"}), "cache key", "neutral"
    )

    assert route.TTS_CACHE_VERSION == "f5-v3-speech-polish"
    assert current != old
    assert current != nonverbal


def test_existing_f5_tail_validation_crossfade_loudness_and_lock_remain_active():
    infer_source = inspect.getsource(F5LocalEngine._infer_chunk)
    synthesis_source = inspect.getsource(F5LocalEngine._synthesize_internal)
    public_source = inspect.getsource(F5LocalEngine.synthesize)

    assert "_validate_and_trim_tail" in infer_source
    assert "_crossfade_concat" in synthesis_source
    assert "_safe_loudness_normalize" in synthesis_source
    assert "_inference_lock" in public_source
