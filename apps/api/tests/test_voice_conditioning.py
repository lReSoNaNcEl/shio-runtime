import json
import queue
import threading
from pathlib import Path
from unittest.mock import patch

import numpy as np

from app.config import settings
from app.tts.emotion import EmotionRegistry
from app.tts.fish import (
    FishS2ProDeliveryAdapter,
    FishS2ProEngine,
    SpeechDeliveryIntent,
    SpeechTextChunk,
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
    adapter = FishS2ProDeliveryAdapter()
    registry = EmotionRegistry(settings.EMOTION_MANIFEST_PATH)
    for emotion in registry.supported():
        instruction = adapter.instruction(SpeechDeliveryIntent(emotion=emotion), "ru") or ""
        for tag in registry.get(emotion).speech.get("fishTags", []):
            assert f"[{tag}]" in instruction
        assert adapter.compatibility(emotion) == "native"
    assert adapter.compatibility("unknown") == "unsupported"


class Input:
    def __init__(self, output):
        self.calls = []
        self.output = output

    def put(self, item, **kwargs):
        self.calls.append(item)
        self.output.put(("audio", np.array([0.25], dtype=np.float32)))
        self.output.put(("done", None))


def engine_fixture():
    engine = object.__new__(FishS2ProEngine)
    engine.model_revision = "model-a"
    engine.compile = False
    engine.delivery_adapter = FishS2ProDeliveryAdapter()
    engine._inference_lock = threading.Lock()
    engine._output = queue.Queue()
    engine._input = Input(engine._output)
    engine._ensure_worker = lambda: None
    engine._closed = True
    engine._prepared_references = set()
    engine._stop_worker = lambda: None
    return engine


def test_delivery_transition_and_tag_injection_containment():
    engine = engine_fixture()
    chunks = [
        SpeechTextChunk("Привет [angry].", SpeechDeliveryIntent(emotion="warm")),
        SpeechTextChunk("До встречи.", SpeechDeliveryIntent(emotion="sad", pace="slow")),
    ]
    with patch(
        "app.tts.fish.condition_reference",
        return_value=("reference.wav", "reference text", None, True),
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
    assert engine._input.calls[0][0].endswith("Привет (angry).")
    assert "[sad]" in engine._input.calls[1][0]
    assert "[slow pace]" in engine._input.calls[1][0]
    assert not engine._inference_lock.locked()


def test_cancel_does_not_submit_more_gpu_work():
    engine = engine_fixture()
    cancelled = threading.Event()
    with patch(
        "app.tts.fish.condition_reference",
        return_value=("reference.wav", "reference text", None, True),
    ):
        stream = engine.stream(
            ["first", "second"],
            language="en",
            voice="voice",
            intent=SpeechDeliveryIntent(),
            cancelled=cancelled,
        )
        next(stream)
        cancelled.set()
        assert list(stream) == []
    assert len(engine._input.calls) == 1
    assert not engine._inference_lock.locked()


def test_compiled_readiness_requires_completed_warmup():
    engine = engine_fixture()
    engine.compile = True
    engine._ready = True
    engine._warmed = False
    engine._process = type("Process", (), {"is_alive": lambda self: True})()
    assert not engine.is_available()
    engine._warmed = True
    assert engine.is_available()
