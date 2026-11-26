"""Shio-owned, cancellable local Fish S2 Pro inference adapter."""

from __future__ import annotations

import logging
import multiprocessing as mp
import queue
import threading
import time
import unicodedata
from collections.abc import Generator, Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

import numpy as np

from app.tts.voices import condition_reference, default_voice_id

logger = logging.getLogger(__name__)
CANCELLATION_ACK_TIMEOUT_SECONDS = 1.0


@dataclass(frozen=True)
class SpeechDeliveryIntent:
    emotion: str = "neutral"
    pace: Literal["slow", "normal", "fast"] = "normal"
    energy: Literal["low", "normal", "high"] = "normal"
    volume: Literal["soft", "normal", "loud"] = "normal"
    style: str | None = None


def validate_voice_style(style: str) -> str:
    if (
        not style.strip()
        or style != style.strip()
        or len(style) > 120
        or any(c in "[]<>" or unicodedata.category(c).startswith("C") for c in style)
    ):
        raise ValueError("Invalid bounded voice style")
    return style


@dataclass(frozen=True)
class SpeechTextChunk:
    text: str
    intent: SpeechDeliveryIntent | None = None
    sequence: int = 0


class FishS2ProDeliveryAdapter:
    """Only validated Shio semantics become provider instructions."""

    def instruction(self, intent: SpeechDeliveryIntent, language: str) -> str | None:
        from app.config import settings
        from app.tts.emotion import EmotionRegistry

        entry = EmotionRegistry(settings.EMOTION_MANIFEST_PATH).get(intent.emotion)
        tags = list(entry.speech.get("fishTags", []))
        if intent.pace != "normal":
            tags.append("slow pace" if intent.pace == "slow" else "fast pace")
        if intent.energy != "normal":
            tags.append(f"{intent.energy} energy")
        if intent.volume != "normal":
            tags.append("low volume" if intent.volume == "soft" else "loud")
        if intent.style is not None:
            tags.append(validate_voice_style(intent.style))
        return "".join(f"[{tag}]" for tag in dict.fromkeys(tags)) or None

    def compatibility(self, emotion: str) -> Literal["native", "unsupported"]:
        from app.config import settings
        from app.tts.emotion import EmotionRegistry

        return (
            "native"
            if EmotionRegistry(settings.EMOTION_MANIFEST_PATH).is_supported(emotion)
            else "unsupported"
        )


class FishS2ProEngine:
    """One persistent process with token-level cancellation and a termination fallback."""

    def __init__(
        self,
        *,
        device: str,
        model_id: str,
        model_revision: str,
        source_revision: str,
        model_root: str,
        source_path: str = "",
        model_path: str = "",
        sample_rate: int = 44100,
        compile: bool = False,
        auto_start: bool = True,
    ) -> None:
        self.engine_name = "fish-s2-pro"
        self.model_id = model_id
        self.model_revision = model_revision
        self.source_revision = source_revision
        self.device = device
        self.sample_rate = sample_rate
        self.compile = compile
        root = Path(model_root).resolve()
        self.source = (
            Path(source_path) if source_path else root / "fish" / "source" / source_revision
        )
        self.model = Path(model_path) if model_path else root / "fish" / "model" / model_revision
        if not (self.source / "fish_speech").is_dir() or not (self.model / "codec.pth").is_file():
            raise RuntimeError("Pinned Fish S2 Pro assets are missing; run npm run api:prefetch")
        self.delivery_adapter = FishS2ProDeliveryAdapter()
        self._inference_lock = threading.Lock()
        self._lifecycle_lock = threading.RLock()
        self._process = None
        self._input = None
        self._output = None
        self._request_cancelled = None
        self._closed = False
        self._ready = False
        self._warmed = False
        self._error: str | None = None
        self._state = "loading"
        self._reload_thread: threading.Thread | None = None
        self._prepared_references: set[tuple[str, str]] = set()
        if auto_start:
            self.initialize()

    def initialize(self) -> None:
        try:
            self._ensure_worker()
        except Exception as error:
            self._state = "failed"
            self._error = type(error).__name__
            raise

    def status(self) -> dict:
        return {
            "status": "ready" if self.is_available() else self._state,
            "compile": self.compile,
            "warmup": "ready" if self._warmed else "pending",
            "error": self._error,
        }

    def voice_prepared(self, voice_id: str) -> bool:
        resolved = condition_reference(voice_id, self.model_revision)
        return (
            resolved is not None
            and (resolved[0], resolved[1]) in self._prepared_references
            and self.is_available()
        )

    def _ensure_worker(self) -> None:
        with self._lifecycle_lock:
            if self._closed:
                raise RuntimeError("Fish S2 Pro engine is closed")
            if self._ready and self._process is not None and self._process.is_alive():
                return
            self._stop_worker()
            self._state = "loading"
            self._error = None
            context = mp.get_context("spawn")
            self._input = context.Queue(maxsize=1)
            self._output = context.Queue(maxsize=4)
            self._request_cancelled = context.Event()
            from app.tts.fish_worker import run_worker

            self._process = context.Process(
                target=run_worker,
                args=(
                    str(self.source),
                    str(self.model),
                    self.device,
                    self.compile,
                    self._input,
                    self._output,
                    self._request_cancelled,
                ),
                daemon=True,
                name="shio-fish-s2-pro",
            )
            self._process.start()
            deadline = time.monotonic() + 240
            while time.monotonic() < deadline and not self._closed:
                try:
                    message = self._output.get(timeout=0.25)
                except queue.Empty:
                    if not self._process.is_alive():
                        break
                    continue
                if message[0] == "ready":
                    self.sample_rate = int(message[1])
                    self._ready = True
                    self._state = "warming" if self.compile else "ready"
                    return
                self._stop_worker()
                raise RuntimeError(f"Fish S2 Pro initialization failed: {message[1]}")
            self._stop_worker()
            raise RuntimeError("Fish S2 Pro worker did not become ready")

    def is_available(self) -> bool:
        return (
            self._ready
            and (not self.compile or self._warmed)
            and self._process is not None
            and self._process.is_alive()
        )

    def render_instruction(self, intent: SpeechDeliveryIntent, language: str) -> str | None:
        return self.delivery_adapter.instruction(intent, language)

    def stream(
        self,
        text_chunks: Iterable[str | SpeechTextChunk],
        *,
        language: str,
        voice: str | None,
        intent: SpeechDeliveryIntent,
        cancelled: threading.Event,
    ) -> Generator[np.ndarray, None, None]:
        if cancelled.is_set():
            return
        resolved = condition_reference(voice or default_voice_id(), self.model_revision)
        if resolved is None:
            raise RuntimeError("Selected voice reference is unavailable")
        audio_path, transcript, _entry, _cache_hit = resolved
        while not cancelled.is_set():
            if self._inference_lock.acquire(timeout=0.05):
                break
        else:
            return
        request_in_flight = False
        try:
            if cancelled.is_set():
                return
            self._ensure_worker()
            for raw in text_chunks:
                if cancelled.is_set():
                    break
                chunk = raw if isinstance(raw, SpeechTextChunk) else SpeechTextChunk(raw)
                tags = self.render_instruction(chunk.intent or intent, language) or ""
                text = chunk.text.replace("[", "(").replace("]", ")")
                if cancelled.is_set():
                    break
                # A submitted request stays in flight until the worker confirms completion.
                self._request_cancelled.clear()
                request_in_flight = True
                self._input.put((tags + text, audio_path, transcript), timeout=1)
                deadline = time.monotonic() + (600 if self.compile else 120)
                while not cancelled.is_set() and request_in_flight:
                    try:
                        message = self._output.get(timeout=0.05)
                    except queue.Empty:
                        if self._closed:
                            return
                        if not self._process.is_alive() or time.monotonic() > deadline:
                            raise RuntimeError(
                                "Fish S2 Pro inference worker stopped or timed out"
                            ) from None
                        continue
                    except (EOFError, OSError, ValueError):
                        if self._closed or cancelled.is_set():
                            return
                        raise RuntimeError("Fish S2 Pro worker channel closed") from None
                    if message[0] == "audio":
                        if cancelled.is_set():
                            break
                        self._prepared_references.add((audio_path, transcript))
                        yield message[1]
                    elif message[0] == "done":
                        self._warmed = True
                        request_in_flight = False
                    else:
                        request_in_flight = False
                        raise RuntimeError(f"Fish S2 Pro synthesis failed: {message[1]}")
        finally:
            restart_worker = False
            try:
                if request_in_flight and not self._closed and not self._settle_cancellation():
                    logger.warning("Fish worker did not settle the cancelled request; reloading")
                    self._stop_worker()
                    restart_worker = True
            finally:
                self._inference_lock.release()
            if restart_worker and not self._closed:

                def reload_worker() -> None:
                    try:
                        self.warmup()
                    except RuntimeError:
                        # Health remains unavailable; the next explicit warmup can recover.
                        self._state = "failed"
                        self._error = "FishReloadFailed"
                        return

                self._reload_thread = threading.Thread(
                    target=reload_worker, daemon=True, name="shio-fish-reload"
                )
                self._reload_thread.start()

    def _settle_cancellation(self) -> bool:
        """Drain only this request's PCM until the worker confirms it is done."""
        started_at = time.monotonic()
        deadline = started_at + CANCELLATION_ACK_TIMEOUT_SECONDS
        cancellation, output = self._request_cancelled, self._output
        if cancellation is None or output is None:
            return False
        cancellation.set()
        while not self._closed:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return False
            try:
                message = output.get(timeout=remaining)
            except (queue.Empty, EOFError, OSError, ValueError):
                return self._closed
            if message[0] == "done":
                logger.info(
                    "Fish cancelled with warm worker in %.0f ms",
                    (time.monotonic() - started_at) * 1000,
                )
                return True
            if message[0] != "audio":
                return False
        return True

    def _stop_worker(self) -> None:
        with self._lifecycle_lock:
            self._ready = False
            self._warmed = False
            self._state = "closed" if self._closed else "loading"
            self._prepared_references.clear()
            if self._process is not None:
                if self._process.is_alive():
                    self._process.terminate()
                self._process.join(timeout=3)
                if self._process.is_alive():
                    self._process.kill()
                    self._process.join(timeout=1)
                if self._process.is_alive():
                    self._state = "failed"
                    self._error = "FishTerminationFailed"
                    raise RuntimeError("Fish inference process did not terminate")
                self._process.close()
                self._process = None
            for channel in (self._input, self._output):
                if channel is not None:
                    channel.cancel_join_thread()
                    channel.close()
            self._input = self._output = self._request_cancelled = None

    def warmup(self) -> None:
        self._state = "warming"
        self._ensure_worker()
        for _chunk in self.stream(
            ["Hello."],
            language="en",
            voice=default_voice_id(),
            intent=SpeechDeliveryIntent(),
            cancelled=threading.Event(),
        ):
            pass
        if not self._closed:
            self._warmed = True
            self._state = "ready"

    def close(self) -> None:
        self._closed = True
        with self._lifecycle_lock:
            self._stop_worker()
        if (
            self._reload_thread is not None
            and self._reload_thread is not threading.current_thread()
        ):
            self._reload_thread.join(timeout=5)
        self._state = "closed"
