"""Pinned CosyVoice 3 text-in/audio-out streaming adapter."""

from __future__ import annotations

import logging
import sys
import threading
from collections.abc import Iterable, Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

import numpy as np

from app.tts.voices import condition_reference, default_voice_id

logger = logging.getLogger(__name__)


def _load_reference_wav(path: str, target_sample_rate: int, minimum_sample_rate: int = 16000):
    """Decode immutable references without TorchCodec or an external FFmpeg runtime."""
    import soundfile as sf
    import torch
    from torchaudio.functional import resample

    audio, sample_rate = sf.read(path, dtype="float32", always_2d=True)
    if sample_rate < minimum_sample_rate:
        raise ValueError(
            f"Reference sample rate {sample_rate} is below minimum {minimum_sample_rate}"
        )
    speech = torch.from_numpy(audio.T.copy()).mean(dim=0, keepdim=True)
    if sample_rate != target_sample_rate:
        speech = resample(speech, sample_rate, target_sample_rate)
    return speech


@dataclass(frozen=True)
class SpeechDeliveryIntent:
    """Provider-neutral delivery request. Provider syntax stays in this adapter."""

    emotion: str = "neutral"
    pace: Literal["slow", "normal", "fast"] = "normal"
    energy: Literal["low", "normal", "high"] = "normal"
    volume: Literal["soft", "normal", "loud"] = "normal"


@dataclass(frozen=True)
class SpeechTextChunk:
    text: str
    intent: SpeechDeliveryIntent | None = None


class CosyVoiceDeliveryAdapter:
    """Translate Shio delivery semantics into bounded CosyVoice controls."""

    _emotion_instructions = {
        "calm": "Speak calmly and gently",
        "warm": "Speak with a warm and caring tone",
        "happy": "Speak with a bright, happy tone",
        "laugh": "Include a short natural laugh",
        "chuckle": "Include a subtle natural chuckle",
        "sad": "Speak with a sad, subdued tone",
        "crying": "Speak tearfully, as if quietly crying",
        "angry": "Speak with controlled anger",
        "fear": "Speak with a fearful, tense tone",
        "surprised": "Speak with genuine surprise",
        "gasp": "Begin with a brief natural gasp",
        "sigh": "Begin with a brief natural sigh",
        "groan": "Include a brief restrained groan",
        "whisper": "Speak in a soft whisper",
    }
    _compatibility = {
        "neutral": "native",
        "calm": "native",
        "warm": "native",
        "happy": "native",
        "sad": "native",
        "angry": "native",
        "fear": "native",
        "surprised": "native",
        "whisper": "native",
        "laugh": "approximate",
        "chuckle": "approximate",
        "crying": "approximate",
        "gasp": "approximate",
        "sigh": "approximate",
        "groan": "approximate",
    }

    def instruction(self, intent: SpeechDeliveryIntent, language: str) -> str | None:
        clauses: list[str] = []
        emotion = self._emotion_instructions.get(intent.emotion)
        if emotion:
            clauses.append(emotion)
        if intent.pace != "normal":
            clauses.append(f"Speak at a {intent.pace} pace")
        if intent.energy != "normal":
            clauses.append(f"Use {intent.energy} vocal energy")
        if intent.volume != "normal":
            clauses.append(f"Use a {intent.volume} voice")
        if not clauses:
            return None
        language_instruction = " Speak in Russian." if language == "ru" else " Speak in English."
        return f"You are a helpful assistant. {'. '.join(clauses)}.{language_instruction}<|endofprompt|>"

    def speed(self, intent: SpeechDeliveryIntent) -> float:
        return {"slow": 0.9, "normal": 1.0, "fast": 1.1}[intent.pace]

    def compatibility(self, emotion: str) -> Literal["native", "approximate", "unsupported"]:
        return self._compatibility.get(emotion, "unsupported")


class CosyVoiceEngine:
    """Own one real CosyVoice 3 model and yield contiguous mono float32 PCM chunks."""

    def __init__(
        self,
        *,
        device: str,
        model_id: str,
        model_revision: str,
        source_revision: str,
        matcha_revision: str,
        model_root: str,
        source_path: str = "",
        model_path: str = "",
        sample_rate: int = 24000,
    ) -> None:
        self.engine_name = "cosyvoice3"
        self.device = device
        self.model_id = model_id
        self.model_revision = model_revision
        self.source_revision = source_revision
        self.matcha_revision = matcha_revision
        self.sample_rate = sample_rate
        self._inference_lock = threading.Lock()
        self.delivery_adapter = CosyVoiceDeliveryAdapter()
        self.model = None

        source, matcha, model = self._resolve_paths(
            model_root=model_root,
            source_path=source_path,
            model_path=model_path,
        )
        if not source.is_dir() or not matcha.is_dir() or not model.is_dir():
            raise RuntimeError(
                "Pinned CosyVoice assets are missing; run npm run api:prefetch or launcher repair"
            )
        sys.path.insert(0, str(matcha))
        sys.path.insert(0, str(source))

        try:
            from cosyvoice.cli import frontend as cosyvoice_frontend
            from cosyvoice.cli.cosyvoice import AutoModel
        except ImportError as exc:
            raise RuntimeError(
                "Pinned CosyVoice source or runtime dependencies are unavailable"
            ) from exc

        # Torchaudio 2.11 delegates file decoding to optional TorchCodec. Shio's
        # existing WAV references need neither video codecs nor an external
        # FFmpeg runtime, so keep decoding bounded and app-owned through libsndfile.
        cosyvoice_frontend.load_wav = _load_reference_wav

        logger.info(
            "Loading CosyVoice 3 model=%s revision=%s source=%s device=%s",
            model_id,
            model_revision,
            source_revision,
            device,
        )
        self.model = AutoModel(
            model_dir=str(model),
            load_trt=False,
            fp16=device.startswith("cuda"),
        )
        self.sample_rate = int(getattr(self.model, "sample_rate", sample_rate))
        logger.info("CosyVoice 3 ready sampleRate=%d", self.sample_rate)

    def _resolve_paths(
        self, *, model_root: str, source_path: str, model_path: str
    ) -> tuple[Path, Path, Path]:
        root = Path(model_root).resolve() if model_root else Path.cwd() / "models"
        source = (
            Path(source_path).resolve()
            if source_path
            else root / "cosyvoice" / "source" / self.source_revision
        )
        matcha = root / "cosyvoice" / "matcha" / self.matcha_revision
        model = (
            Path(model_path).resolve()
            if model_path
            else root / "cosyvoice" / "model" / self.model_revision
        )
        return source, matcha, model

    def is_available(self) -> bool:
        return self.model is not None

    def render_instruction(self, intent: SpeechDeliveryIntent, language: str) -> str | None:
        """Translate bounded delivery intent into CosyVoice-owned instruction text."""
        return self.delivery_adapter.instruction(intent, language)

    def stream(
        self,
        text_chunks: Iterable[str | SpeechTextChunk],
        *,
        language: str,
        voice: str | None,
        intent: SpeechDeliveryIntent,
        cancelled: threading.Event,
    ) -> Iterator[np.ndarray]:
        if self.model is None:
            raise RuntimeError("CosyVoice 3 engine is not ready")
        resolved = condition_reference(voice or default_voice_id(), self.model_revision)
        if resolved is None:
            raise RuntimeError("Selected voice reference is unavailable")
        prompt_wav, prompt_text, entry, cache_hit = resolved
        logger.info(
            "Voice conditioning voiceId=%s cacheHit=%s modelRevision=%s",
            entry.id,
            cache_hit,
            self.model_revision,
        )
        chunks = iter(text_chunks)
        first = next(chunks, None)
        if first is None:
            return
        current = first if isinstance(first, SpeechTextChunk) else SpeechTextChunk(str(first))

        logger.info("Waiting for CosyVoice inference lock")
        while not cancelled.is_set():
            if self._inference_lock.acquire(timeout=0.1):
                break
        else:
            logger.info("CosyVoice inference cancelled before lock acquisition")
            return
        logger.info("CosyVoice inference lock acquired")
        try:
            while current is not None and not cancelled.is_set():
                effective_intent = current.intent or intent
                instruction = self.render_instruction(effective_intent, language)
                next_segment: SpeechTextChunk | None = None
                segment_head = current
                segment_intent = effective_intent

                def provider_text(
                    head: SpeechTextChunk = segment_head,
                    delivery: SpeechDeliveryIntent = segment_intent,
                ) -> Iterator[str]:
                    nonlocal next_segment
                    yield head.text
                    for item in chunks:
                        chunk = (
                            item
                            if isinstance(item, SpeechTextChunk)
                            else SpeechTextChunk(str(item))
                        )
                        if (chunk.intent or intent) != delivery:
                            next_segment = chunk
                            return
                        yield chunk.text

                speed = self.delivery_adapter.speed(effective_intent)
                if instruction:
                    output = self.model.inference_instruct2(
                        tts_text=provider_text(),
                        instruct_text=instruction,
                        prompt_wav=prompt_wav,
                        stream=True,
                        speed=speed,
                    )
                else:
                    output = self.model.inference_zero_shot(
                        tts_text=provider_text(),
                        prompt_text=f"You are a helpful assistant.<|endofprompt|>{prompt_text}",
                        prompt_wav=prompt_wav,
                        stream=True,
                        speed=speed,
                    )
                for item in output:
                    if cancelled.is_set():
                        break
                    speech = item.get("tts_speech")
                    if speech is None:
                        continue
                    audio = speech.detach().cpu().numpy().reshape(-1).astype("<f4", copy=False)
                    if audio.size:
                        yield audio
                if cancelled.is_set():
                    break
                current = next_segment
        finally:
            self._inference_lock.release()
            logger.info("CosyVoice inference lock released")

    def warmup(self) -> None:
        cancelled = threading.Event()
        for _chunk in self.stream(
            ["Hello."],
            language="en",
            voice=default_voice_id(),
            intent=SpeechDeliveryIntent(),
            cancelled=cancelled,
        ):
            pass
