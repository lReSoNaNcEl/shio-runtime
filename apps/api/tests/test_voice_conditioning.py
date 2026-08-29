import hashlib
import json
import threading
from pathlib import Path
from unittest.mock import patch

import numpy as np
import soundfile as sf

from app.tts.cosyvoice import (
    CosyVoiceDeliveryAdapter,
    CosyVoiceEngine,
    SpeechDeliveryIntent,
    SpeechTextChunk,
    _load_reference_wav,
)
from app.tts.voice_registry import VoiceRegistry


def _registry(tmp_path: Path) -> tuple[VoiceRegistry, Path, Path]:
    voice_root = tmp_path / "voices" / "dataset" / "voice"
    voice_root.mkdir(parents=True)
    audio = voice_root / "reference.wav"
    transcript = voice_root / "reference.txt"
    audio.write_bytes(b"RIFF-stable-reference")
    transcript.write_text("Stable transcript.\n", encoding="utf-8")
    manifest = tmp_path / "voice_manifest.json"
    manifest.write_text(
        json.dumps(
            {
                "defaultVoiceId": "animevox_makima",
                "datasets": [{"id": "animevox"}],
                "voices": [
                    {
                        "id": "animevox_makima",
                        "dataset": "animevox",
                        "referenceAudio": "voices/dataset/voice/reference.wav",
                        "referenceText": "voices/dataset/voice/reference.txt",
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    return VoiceRegistry(str(manifest)), audio, transcript


def test_conditioning_cache_identity_and_reference_immutability(tmp_path: Path):
    registry, audio, transcript = _registry(tmp_path)
    original_audio = audio.read_bytes()
    original_transcript = transcript.read_bytes()
    cache_root = tmp_path / "cache"

    first = registry.condition_reference(
        "animevox_makima", model_revision="model-a", cache_root=str(cache_root)
    )
    assert first is not None and first[3] is False
    assert Path(first[0]).read_bytes() == original_audio
    assert Path(first[0]).with_name("reference.txt").read_bytes() == original_transcript
    second = registry.condition_reference(
        "animevox_makima", model_revision="model-a", cache_root=str(cache_root)
    )
    assert second is not None and second[3] is True

    audio.write_bytes(original_audio + b"changed")
    audio_changed = registry.condition_reference(
        "animevox_makima", model_revision="model-a", cache_root=str(cache_root)
    )
    assert audio_changed is not None and audio_changed[3] is False
    audio.write_bytes(original_audio)

    transcript.write_text("Changed transcript.\n", encoding="utf-8")
    transcript_changed = registry.condition_reference(
        "animevox_makima", model_revision="model-a", cache_root=str(cache_root)
    )
    assert transcript_changed is not None and transcript_changed[3] is False
    model_changed = registry.condition_reference(
        "animevox_makima", model_revision="model-b", cache_root=str(cache_root)
    )
    assert model_changed is not None and model_changed[3] is False

    assert audio.read_bytes() == original_audio
    assert original_transcript.startswith(b"Stable transcript.")


def test_delivery_adapter_preserves_semantic_emotions():
    adapter = CosyVoiceDeliveryAdapter()
    for emotion in ("warm", "happy", "sad", "angry", "surprised", "whisper"):
        instruction = adapter.instruction(SpeechDeliveryIntent(emotion=emotion), "ru")
        assert instruction is not None
        assert instruction.endswith("<|endofprompt|>")
        assert adapter.compatibility(emotion) == "native"
    for vocalization in ("laugh", "chuckle", "crying", "gasp", "sigh", "groan"):
        assert adapter.instruction(SpeechDeliveryIntent(emotion=vocalization), "en") is not None
        assert adapter.compatibility(vocalization) == "approximate"
    assert adapter.instruction(SpeechDeliveryIntent(), "ru") is None
    assert adapter.compatibility("unknown") == "unsupported"


class _FakeSpeech:
    def detach(self):
        return self

    def cpu(self):
        return self

    def numpy(self):
        return np.array([[0.25]], dtype=np.float32)


class _RecordingModel:
    def __init__(self):
        self.calls: list[tuple[list[str], str | None, float]] = []

    def inference_zero_shot(self, *, tts_text, speed, **_kwargs):
        self.calls.append((list(tts_text), None, speed))
        yield {"tts_speech": _FakeSpeech()}

    def inference_instruct2(self, *, tts_text, instruct_text, speed, **_kwargs):
        self.calls.append((list(tts_text), instruct_text, speed))
        yield {"tts_speech": _FakeSpeech()}


def test_delivery_change_is_a_provider_transition_inside_one_engine_stream():
    model = _RecordingModel()
    engine = object.__new__(CosyVoiceEngine)
    engine.model = model
    engine.model_revision = "model-a"
    engine._inference_lock = threading.Lock()
    engine.delivery_adapter = CosyVoiceDeliveryAdapter()
    chunks = [
        SpeechTextChunk("Первая часть, ", SpeechDeliveryIntent(emotion="warm")),
        SpeechTextChunk("всё ещё тёплая. ", SpeechDeliveryIntent(emotion="warm")),
        SpeechTextChunk(
            "Теперь медленнее.",
            SpeechDeliveryIntent(emotion="sad", pace="slow"),
        ),
    ]

    with patch(
        "app.tts.cosyvoice.condition_reference",
        return_value=(
            "reference.wav",
            "reference text",
            type("Voice", (), {"id": "voice"})(),
            True,
        ),
    ):
        output = list(
            engine.stream(
                chunks,
                language="ru",
                voice="voice",
                intent=SpeechDeliveryIntent(),
                cancelled=threading.Event(),
            )
        )

    assert len(output) == 2
    assert len(model.calls) == 2
    assert model.calls[0][0] == ["Первая часть, ", "всё ещё тёплая. "]
    assert "warm and caring" in (model.calls[0][1] or "")
    assert model.calls[0][2] == 1.0
    assert model.calls[1][0] == ["Теперь медленнее."]
    assert "sad, subdued" in (model.calls[1][1] or "")
    assert model.calls[1][2] == 0.9


def test_reference_decoder_resamples_in_memory_without_mutating_wav(tmp_path: Path):
    path = tmp_path / "reference.wav"
    source = np.linspace(-0.25, 0.25, 16_000, dtype=np.float32)
    sf.write(path, source, 16_000, subtype="PCM_16")
    before = hashlib.sha256(path.read_bytes()).hexdigest()

    decoded = _load_reference_wav(str(path), 24_000)

    assert decoded.shape == (1, 24_000)
    assert hashlib.sha256(path.read_bytes()).hexdigest() == before
