"""Versioned Fish Audio S2 Pro text-in/audio-out WebSocket protocol."""

from __future__ import annotations

import asyncio
import logging
import queue
import threading
from collections.abc import Callable, Iterator
from enum import Enum
from typing import Literal

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator
from starlette.websockets import WebSocketState

from app.config import settings
from app.tts.emotion import EmotionRegistry
from app.tts.fish import SpeechDeliveryIntent, SpeechTextChunk, validate_voice_style
from app.tts.runtime import get_engine
from app.tts.voices import default_voice_id, voice_registry

logger = logging.getLogger(__name__)
router = APIRouter(tags=["tts"])

PROTOCOL_VERSION = 1
MAX_COMMIT_CHARS = 220
MAX_SESSION_CHARS = 12_000
TERMINAL_CANCEL_GRACE_SECONDS = 0.1
# Uvicorn can otherwise put the close frame on the wire before Node/Electron has
# observed the immediately preceding terminal text frame on this local socket.
TERMINAL_FLUSH_GRACE_SECONDS = 0.05
_TEXT_END = object()
_AUDIO_END = object()
_session_gate = asyncio.Semaphore(settings.FISH_MAX_SESSIONS)
_active_sessions: set[str] = set()
_cancellations: dict[threading.Event, Callable[[], None]] = {}
SpeechEmotion = Enum(
    "SpeechEmotion",
    {key.upper(): key for key in EmotionRegistry(settings.EMOTION_MANIFEST_PATH).supported()},
    type=str,
)


class DeliveryIntentMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    emotion: SpeechEmotion = SpeechEmotion.NEUTRAL
    pace: Literal["slow", "normal", "fast"] = "normal"
    energy: Literal["low", "normal", "high"] = "normal"
    volume: Literal["soft", "normal", "loud"] = "normal"
    style: str | None = Field(default=None, min_length=1, max_length=120)

    @field_validator("style")
    @classmethod
    def bounded_voice_style(cls, value: str | None) -> str | None:
        return validate_voice_style(value) if value is not None else None


class StartMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["start"]
    protocolVersion: Literal[1]
    sessionId: str = Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9:._-]+$")
    turnId: str = Field(min_length=1, max_length=100)
    voiceId: str | None = Field(default=None, max_length=128)
    language: Literal["ru", "en"] = "ru"
    delivery: DeliveryIntentMessage = Field(default_factory=DeliveryIntentMessage)


class TextMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["text"]
    sequence: int = Field(ge=0, le=100_000)
    text: str = Field(min_length=1, max_length=MAX_COMMIT_CHARS)


class DeliveryMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["delivery"]
    sequence: int = Field(ge=0, le=100_000)
    delivery: DeliveryIntentMessage


class FinishInputMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["finish-input"]


class CancelMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["cancel"]
    reason: str = Field(default="cancelled", max_length=160)


class AudioAckMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: Literal["audio-ack"]
    sequence: int = Field(ge=0, le=100_000)


def cancel_active_sessions() -> None:
    for cancel in tuple(_cancellations.values()):
        cancel()


async def _send_error(websocket: WebSocket, code: str, message: str) -> None:
    await websocket.send_json({"type": "error", "code": code, "message": message})


def _voice_id(requested: str | None) -> str:
    selected = requested or default_voice_id()
    try:
        entry = voice_registry.get(selected)
    except KeyError as exc:
        raise ValueError(f"Unknown voiceId: {selected}") from exc
    if not entry.is_available():
        raise ValueError(f"Voice '{selected}' has no local reference assets")
    return selected


@router.websocket("/tts/stream")
async def tts_stream(websocket: WebSocket) -> None:
    await websocket.accept()
    session_id: str | None = None
    owns_session = False
    cancelled = threading.Event()
    text_queue: queue.Queue[SpeechTextChunk | object] = queue.Queue(settings.FISH_TEXT_QUEUE_ITEMS)
    audio_queue: queue.Queue[tuple[bytes, str, int] | Exception | object] = queue.Queue(
        settings.FISH_AUDIO_QUEUE_ITEMS
    )
    stream_finished = asyncio.Event()
    audio_credit = asyncio.Semaphore(4)
    expected_audio_ack = 0
    highest_audio_sent = -1

    def cancel_text_input() -> None:
        cancelled.set()
        while True:
            try:
                text_queue.put_nowait(_TEXT_END)
                return
            except queue.Full:
                try:
                    text_queue.get_nowait()
                except queue.Empty:
                    continue

    _cancellations[cancelled] = cancel_text_input

    try:
        try:
            raw_start = await asyncio.wait_for(websocket.receive_json(), timeout=10)
            start = StartMessage.model_validate(raw_start)
            engine = get_engine()
            voice_id = _voice_id(start.voiceId)
        except (TimeoutError, ValidationError, ValueError, RuntimeError) as exc:
            await _send_error(websocket, "invalid_start", str(exc))
            await websocket.close(code=1008)
            return

        session_id = start.sessionId
        if session_id in _active_sessions:
            await _send_error(websocket, "duplicate_session", "Session id is already active")
            await websocket.close(code=1008)
            return
        if len(_active_sessions) >= settings.FISH_MAX_SESSIONS:
            await _send_error(websocket, "synthesis_busy", "Speech session capacity is occupied")
            await websocket.close(code=1013)
            return
        _active_sessions.add(session_id)
        owns_session = True
        intent = SpeechDeliveryIntent(**start.delivery.model_dump(mode="json"))

        await websocket.send_json(
            {
                "type": "ready",
                "protocolVersion": PROTOCOL_VERSION,
                "sessionId": session_id,
                "engine": "fish-s2-pro",
                "modelId": settings.FISH_MODEL_ID,
                "modelRevision": settings.FISH_MODEL_REVISION,
                "sourceRevision": settings.FISH_SOURCE_REVISION,
                "sampleRate": engine.sample_rate,
                "channels": 1,
                "sampleFormat": "float32-le",
            }
        )

        active_emotion = str(start.delivery.emotion.value)
        active_text_sequence = 0

        def text_chunks() -> Iterator[SpeechTextChunk]:
            nonlocal active_emotion, active_text_sequence
            while True:
                item = text_queue.get()
                if item is _TEXT_END:
                    return
                if not cancelled.is_set():
                    assert isinstance(item, SpeechTextChunk)
                    active_emotion = (item.intent or intent).emotion
                    active_text_sequence = item.sequence
                    yield item

        def produce() -> None:
            def put_audio(item: tuple[bytes, str, int] | Exception | object) -> bool:
                while True:
                    if cancelled.is_set() and item is not _AUDIO_END:
                        return False
                    try:
                        audio_queue.put(item, timeout=0.1)
                        return True
                    except queue.Full:
                        if cancelled.is_set():
                            try:
                                audio_queue.get_nowait()
                            except queue.Empty:
                                pass
                        continue

            try:
                for samples in engine.stream(
                    text_chunks(),
                    language=start.language,
                    voice=voice_id,
                    intent=intent,
                    cancelled=cancelled,
                ):
                    if not put_audio(
                        (
                            samples.astype("<f4", copy=False).tobytes(),
                            active_emotion,
                            active_text_sequence,
                        )
                    ):
                        return
            except Exception as exc:  # propagated through the bounded stream queue
                put_audio(exc)
            finally:
                put_audio(_AUDIO_END)

        async def receive_text() -> bool:
            nonlocal expected_audio_ack
            expected_sequence = 0
            total_chars = 0
            current_intent = intent
            input_finished = False
            try:
                while True:
                    if input_finished:
                        receive_task = asyncio.create_task(websocket.receive_json())
                        finished_task = asyncio.create_task(stream_finished.wait())
                        done, _pending = await asyncio.wait(
                            {receive_task, finished_task},
                            return_when=asyncio.FIRST_COMPLETED,
                        )
                        finished_task.cancel()
                        await asyncio.gather(finished_task, return_exceptions=True)
                        if receive_task not in done:
                            try:
                                raw = await asyncio.wait_for(
                                    receive_task,
                                    timeout=TERMINAL_CANCEL_GRACE_SECONDS,
                                )
                            except TimeoutError:
                                receive_task.cancel()
                                await asyncio.gather(receive_task, return_exceptions=True)
                                return True
                        else:
                            raw = receive_task.result()
                    else:
                        raw = await websocket.receive_json()
                    message_type = raw.get("type") if isinstance(raw, dict) else None
                    if message_type == "text":
                        if input_finished:
                            raise ValueError("Text is not allowed after finish-input")
                        text = TextMessage.model_validate(raw)
                        if text.sequence != expected_sequence:
                            raise ValueError(
                                f"Expected input sequence {expected_sequence}, got {text.sequence}"
                            )
                        total_chars += len(text.text)
                        if total_chars > MAX_SESSION_CHARS:
                            raise ValueError("Session text limit exceeded")
                        expected_sequence += 1
                        text_queue.put_nowait(
                            SpeechTextChunk(
                                text=text.text,
                                intent=current_intent,
                                sequence=text.sequence,
                            )
                        )
                    elif message_type == "delivery":
                        if input_finished:
                            raise ValueError("Delivery is not allowed after finish-input")
                        delivery = DeliveryMessage.model_validate(raw)
                        if delivery.sequence != expected_sequence:
                            raise ValueError(
                                f"Expected input sequence {expected_sequence}, got {delivery.sequence}"
                            )
                        expected_sequence += 1
                        current_intent = SpeechDeliveryIntent(
                            **delivery.delivery.model_dump(mode="json")
                        )
                    elif message_type == "finish-input":
                        if input_finished:
                            raise ValueError("finish-input was already received")
                        FinishInputMessage.model_validate(raw)
                        text_queue.put_nowait(_TEXT_END)
                        input_finished = True
                    elif message_type == "audio-ack":
                        acknowledgement = AudioAckMessage.model_validate(raw)
                        if (
                            acknowledgement.sequence != expected_audio_ack
                            or acknowledgement.sequence > highest_audio_sent
                        ):
                            raise ValueError("Invalid audio acknowledgement sequence")
                        expected_audio_ack += 1
                        audio_credit.release()
                    elif message_type == "cancel":
                        CancelMessage.model_validate(raw)
                        cancel_text_input()
                        await websocket.send_json({"type": "cancelled", "sessionId": session_id})
                        return False
                    else:
                        raise ValueError("Expected text, delivery, finish-input, or cancel")
            except (ValidationError, ValueError, queue.Full) as exc:
                cancel_text_input()
                await _send_error(websocket, "protocol_error", str(exc))
                return False
            except WebSocketDisconnect:
                cancel_text_input()
                return False

        async def send_audio() -> int:
            nonlocal highest_audio_sent
            sequence = 0
            try:
                while True:
                    item = await asyncio.to_thread(audio_queue.get)
                    if item is _AUDIO_END:
                        return sequence
                    if isinstance(item, Exception):
                        cancelled.set()
                        await _send_error(websocket, "synthesis_failed", str(item))
                        return sequence
                    if cancelled.is_set():
                        continue
                    await audio_credit.acquire()
                    pcm, emotion, text_sequence = item
                    samples = len(pcm) // 4
                    highest_audio_sent = sequence
                    await websocket.send_json(
                        {
                            "type": "audio",
                            "sequence": sequence,
                            "samples": samples,
                            "emotion": emotion,
                            "textSequence": text_sequence,
                        }
                    )
                    await websocket.send_bytes(pcm)
                    sequence += 1
            finally:
                stream_finished.set()

        async with _session_gate:
            producer = asyncio.create_task(asyncio.to_thread(produce))
            receiver = asyncio.create_task(receive_text())
            sender = asyncio.create_task(send_audio())
            try:
                completed_input = await asyncio.wait_for(
                    receiver, timeout=settings.FISH_MAX_SESSION_SECONDS
                )
            except TimeoutError:
                cancel_text_input()
                await _send_error(websocket, "session_timeout", "Speech session duration exceeded")
                completed_input = False
            if completed_input:
                _producer_result, sequence = await asyncio.gather(producer, sender)
                if not cancelled.is_set():
                    await websocket.send_json(
                        {"type": "complete", "sequence": sequence, "sessionId": session_id}
                    )
                    await asyncio.sleep(TERMINAL_FLUSH_GRACE_SECONDS)
            else:
                cancel_text_input()
                producer.cancel()
                sender.cancel()
                await asyncio.gather(producer, sender, return_exceptions=True)
        if websocket.client_state == WebSocketState.CONNECTED:
            await websocket.close(code=1000)
    except WebSocketDisconnect:
        cancelled.set()
    finally:
        cancel_text_input()
        _cancellations.pop(cancelled, None)
        if session_id is not None and owns_session:
            _active_sessions.discard(session_id)
