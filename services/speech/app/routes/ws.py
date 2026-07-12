import asyncio
import json
import logging
from typing import Optional

import numpy as np
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from app.asr import SileroVAD, StreamingASRSession, WhisperASR
from app.asr.streaming import StreamingVADConfig
from app.config import settings

logger = logging.getLogger(__name__)
router = APIRouter(tags=["asr"])

_whisper: Optional[WhisperASR] = None
_vad: Optional[SileroVAD] = None
_decode_lock = asyncio.Lock()


class AsrStreamProtocolInfo(BaseModel):
    protocolVersion: int
    websocketPaths: list[str]
    audioContract: dict
    clientControlMessages: dict
    serverEventTypes: list[str]
    finalReasons: list[str]
    vad: dict
    resourceSafety: dict
    invariants: list[str]


@router.get(
    "/asr/stream-protocol",
    response_model=AsrStreamProtocolInfo,
    summary="Streaming ASR WebSocket protocol",
    description="""
Документация versioned-протокола для Continuous Listening.

Сам WebSocket доступен по `/ws/asr`; `/ws` сохранён как compatibility alias.
OpenAPI не описывает WebSocket operations напрямую, поэтому этот HTTP endpoint
публикует точный transport/event contract в Swagger.
""",
)
async def asr_stream_protocol() -> AsrStreamProtocolInfo:
    return AsrStreamProtocolInfo(
        protocolVersion=1,
        websocketPaths=["/ws/asr", "/ws"],
        audioContract={
            "transport": "binary WebSocket frames",
            "format": "pcm_s16le",
            "sampleRate": 16_000,
            "channels": 1,
            "preferredFrameMs": "20-40",
            "wavHeaders": False,
        },
        clientControlMessages={
            "start": {
                "type": "start",
                "protocolVersion": 1,
                "sessionId": "client-generated-id",
                "sampleRate": 16_000,
                "channels": 1,
                "format": "pcm_s16le",
                "language": "ru",
            },
            "flush": {"type": "flush"},
            "stop": {"type": "stop"},
            "ping": {"type": "ping", "timestamp": 123456789},
        },
        serverEventTypes=[
            "ready", "speech_started", "partial", "final",
            "speech_ended", "warning", "error", "pong",
        ],
        finalReasons=["vad_silence", "flush", "max_duration", "disconnect"],
        vad={
            "threshold": settings.VAD_THRESHOLD,
            "minSpeechMs": settings.VAD_MIN_SPEECH_MS,
            "minSilenceMs": settings.VAD_MIN_SILENCE_MS,
            "preRollMs": settings.VAD_PRE_ROLL_MS,
            "postRollMs": settings.VAD_POST_ROLL_MS,
            "maxSegmentMs": settings.VAD_MAX_SEGMENT_MS,
            "partialIntervalMs": settings.ASR_PARTIAL_INTERVAL_MS,
        },
        resourceSafety={
            "audioQueueFrames": settings.ASR_AUDIO_QUEUE_FRAMES,
            "decodeConcurrencyPerSession": 1,
            "reconnectOwner": "Electron client",
        },
        invariants=[
            "Every session event carries the current sessionId",
            "Utterance events carry segmentId",
            "revision increases monotonically within a segment",
            "partial is a replaceable snapshot and never invokes LLM",
            "final is emitted at most once per segment",
            "no partial is emitted after final",
            "disconnect cancels pending sends and releases per-session buffers",
        ],
    )


def init_asr(whisper: WhisperASR, vad: SileroVAD):
    global _whisper, _vad
    _whisper = whisper
    _vad = vad


async def _send_json(websocket: WebSocket, send_lock: asyncio.Lock, payload: dict) -> None:
    async with send_lock:
        await websocket.send_json(payload)


async def _send_decode(websocket: WebSocket, send_lock: asyncio.Lock, session: StreamingASRSession, job) -> None:
    async with _decode_lock:
        events = await asyncio.to_thread(session.transcribe, job)
    if session.closed:
        return
    for event in events:
        await _send_json(websocket, send_lock, event)


async def _audio_worker(
    websocket: WebSocket,
    send_lock: asyncio.Lock,
    session: StreamingASRSession,
    audio_queue: asyncio.Queue[bytes],
) -> None:
    while not session.closed:
        audio_bytes = await audio_queue.get()
        try:
            audio = np.frombuffer(audio_bytes, dtype="<i2").astype(np.float32) / 32768.0
            events, jobs = session.process_pcm(audio)
            for event in events:
                await _send_json(websocket, send_lock, event)
            # This worker is the only decode producer for the session: partials
            # and finals can never overlap or build an inference-task backlog.
            for job in jobs:
                await _send_decode(websocket, send_lock, session, job)
        finally:
            audio_queue.task_done()


@router.websocket("/ws/asr")
@router.websocket("/ws")
async def websocket_recognize(websocket: WebSocket):
    """Version 1 continuous PCM ASR protocol; `/ws` remains a compatibility alias."""
    await websocket.accept()
    if _whisper is None or _vad is None:
        await websocket.send_json({"type": "error", "code": "asr_unavailable", "message": "ASR not initialized", "recoverable": False})
        await websocket.close(code=1011)
        return

    session: Optional[StreamingASRSession] = None
    audio_queue: Optional[asyncio.Queue[bytes]] = None
    worker_task: Optional[asyncio.Task] = None
    send_lock = asyncio.Lock()
    queue_warning_sent = False
    try:
        while True:
            message = await websocket.receive()
            if message.get("type") == "websocket.disconnect":
                break
            if message.get("text") is not None:
                try:
                    control = json.loads(message["text"])
                except json.JSONDecodeError:
                    await websocket.send_json({"type": "error", "code": "invalid_json", "message": "Invalid JSON control message", "recoverable": True})
                    continue
                control_type = control.get("type")
                if control_type == "start":
                    if session is not None:
                        await websocket.send_json({"type": "error", "sessionId": session.session_id, "code": "already_started", "message": "Session already started", "recoverable": False})
                        continue
                    session_id = str(control.get("sessionId", "")).strip()
                    valid = (
                        control.get("protocolVersion") == 1
                        and session_id
                        and control.get("sampleRate") == 16_000
                        and control.get("channels") == 1
                        and control.get("format") == "pcm_s16le"
                    )
                    if not valid:
                        await websocket.send_json({"type": "error", "sessionId": session_id or None, "code": "unsupported_format", "message": "Expected protocol v1 mono 16kHz pcm_s16le", "recoverable": False})
                        await websocket.close(code=1003)
                        return
                    language = control.get("language")
                    session = StreamingASRSession(
                        _whisper,
                        _vad,
                        session_id=session_id,
                        language=None if language in (None, "", "auto") else str(language),
                        config=StreamingVADConfig(
                            threshold=settings.VAD_THRESHOLD,
                            negative_threshold=settings.VAD_NEGATIVE_THRESHOLD,
                            min_speech_ms=settings.VAD_MIN_SPEECH_MS,
                            min_silence_ms=settings.VAD_MIN_SILENCE_MS,
                            pre_roll_ms=settings.VAD_PRE_ROLL_MS,
                            post_roll_ms=settings.VAD_POST_ROLL_MS,
                            max_segment_ms=settings.VAD_MAX_SEGMENT_MS,
                            partial_interval_ms=settings.ASR_PARTIAL_INTERVAL_MS,
                        ),
                    )
                    audio_queue = asyncio.Queue(maxsize=settings.ASR_AUDIO_QUEUE_FRAMES)
                    worker_task = asyncio.create_task(_audio_worker(websocket, send_lock, session, audio_queue))
                    await websocket.send_json({"type": "ready", "protocolVersion": 1, "sessionId": session_id, "acceptedSampleRate": 16_000})
                    logger.info("ASR stream ready session=%s", session_id)
                elif control_type in ("flush", "stop") and session is not None:
                    if audio_queue is not None:
                        await audio_queue.join()
                    job = session.flush("flush")
                    if job is not None:
                        await _send_decode(websocket, send_lock, session, job)
                    if control_type == "stop":
                        await websocket.close(code=1000)
                        return
                elif control_type == "ping":
                    payload = {"type": "pong", "timestamp": control.get("timestamp")}
                    if session is not None:
                        payload["sessionId"] = session.session_id
                    await websocket.send_json(payload)
            elif message.get("bytes") is not None:
                if session is None:
                    await websocket.send_json({"type": "error", "code": "start_required", "message": "Send start before audio", "recoverable": True})
                    continue
                audio_bytes = message["bytes"]
                if len(audio_bytes) % 2:
                    await websocket.send_json({"type": "warning", "sessionId": session.session_id, "code": "odd_pcm_frame", "message": "Dropped odd trailing PCM byte"})
                    audio_bytes = audio_bytes[:-1]
                if audio_queue is None:
                    continue
                if audio_queue.qsize() >= audio_queue.maxsize - 1 and not queue_warning_sent:
                    queue_warning_sent = True
                    await _send_json(websocket, send_lock, {
                        "type": "warning",
                        "sessionId": session.session_id,
                        "code": "audio_backpressure",
                        "message": "ASR audio queue reached capacity; applying transport backpressure",
                    })
                await audio_queue.put(audio_bytes)
                if audio_queue.qsize() < audio_queue.maxsize // 2:
                    queue_warning_sent = False
    except WebSocketDisconnect:
        logger.info("ASR stream disconnected session=%s", session.session_id if session else None)
    except Exception as error:
        logger.exception("ASR WebSocket failure")
        if session is not None and not session.closed:
            try:
                await websocket.send_json({"type": "error", "sessionId": session.session_id, "code": "stream_failure", "message": str(error), "recoverable": False})
            except Exception:
                pass
    finally:
        if session is not None:
            session.close()
        if worker_task is not None:
            worker_task.cancel()
            await asyncio.gather(worker_task, return_exceptions=True)
