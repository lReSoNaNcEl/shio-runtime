import asyncio
import time
from collections.abc import Iterable
from unittest.mock import patch

import numpy as np
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect, WebSocketState

from app.routes import tts_stream
from app.tts.cosyvoice import CosyVoiceDeliveryAdapter, SpeechDeliveryIntent, SpeechTextChunk


class FakeStreamingEngine:
    sample_rate = 24000

    def stream(self, text_chunks: Iterable[SpeechTextChunk], **_kwargs):
        for chunk in text_chunks:
            yield np.full(len(chunk.text), 0.25, dtype=np.float32)


class FailingStreamingEngine:
    sample_rate = 24000

    def stream(self, text_chunks: Iterable[SpeechTextChunk], **_kwargs):
        next(iter(text_chunks))
        raise RuntimeError("synthetic worker failure")
        yield  # pragma: no cover - keeps this a generator without real audio


class TwoChunkStreamingEngine:
    sample_rate = 24000

    def stream(self, text_chunks: Iterable[SpeechTextChunk], **_kwargs):
        next(iter(text_chunks))
        yield np.full(8, 0.25, dtype=np.float32)
        time.sleep(0.2)
        yield np.full(8, 0.25, dtype=np.float32)


class TerminalFlushWebSocket:
    def __init__(self):
        self.client_state = WebSocketState.CONNECTED
        self.closed = asyncio.Event()
        self.receive_calls = 0
        self.sent_json: list[dict] = []
        self.actions: list[str] = []

    async def accept(self):
        return None

    async def receive_json(self):
        self.receive_calls += 1
        if self.receive_calls == 1:
            return start_message("turn:terminal-flush")
        if self.receive_calls == 2:
            return {"type": "text", "sequence": 0, "text": "Завершить поток."}
        if self.receive_calls == 3:
            return {"type": "finish-input"}
        await self.closed.wait()
        raise WebSocketDisconnect(code=1000)

    async def send_json(self, payload):
        self.sent_json.append(payload)
        if payload["type"] == "complete":
            self.actions.append("complete")

    async def send_bytes(self, _payload):
        return None

    async def close(self, code=1000):
        assert code == 1000
        self.actions.append("close")
        self.client_state = WebSocketState.DISCONNECTED
        self.closed.set()


def client() -> TestClient:
    app = FastAPI()
    app.include_router(tts_stream.router)
    return TestClient(app)


def start_message(session_id: str = "turn:test") -> dict:
    return {
        "type": "start",
        "protocolVersion": 1,
        "sessionId": session_id,
        "turnId": session_id,
        "voiceId": "voice",
        "language": "ru",
        "delivery": {
            "emotion": "warm",
            "pace": "normal",
            "energy": "normal",
            "volume": "normal",
        },
    }


def test_stream_emits_versioned_ready_and_ordered_float32_pcm():
    with (
        patch.object(tts_stream, "get_engine", return_value=FakeStreamingEngine()),
        patch.object(tts_stream, "_voice_id", return_value="voice"),
        client().websocket_connect("/tts/stream") as websocket,
    ):
        websocket.send_json(start_message())
        ready = websocket.receive_json()
        assert ready["type"] == "ready"
        assert ready["protocolVersion"] == 1
        assert ready["engine"] == "cosyvoice3"
        assert ready["sampleFormat"] == "float32-le"
        assert ready["sampleRate"] == 24000

        websocket.send_json({"type": "text", "sequence": 0, "text": "Привет."})
        websocket.send_json({"type": "finish-input"})
        audio = websocket.receive_json()
        payload = websocket.receive_bytes()
        complete = websocket.receive_json()

        assert audio == {"type": "audio", "sequence": 0, "samples": 7}
        assert np.frombuffer(payload, dtype="<f4").tolist() == [0.25] * 7
        assert complete["type"] == "complete"
        assert complete["sequence"] == 1


def test_stream_flushes_terminal_event_before_clean_close():
    websocket = TerminalFlushWebSocket()

    async def record_flush(delay):
        assert delay == tts_stream.TERMINAL_FLUSH_GRACE_SECONDS
        websocket.actions.append("flush")

    with (
        patch.object(tts_stream, "get_engine", return_value=FakeStreamingEngine()),
        patch.object(tts_stream, "_voice_id", return_value="voice"),
        patch.object(tts_stream.asyncio, "sleep", new=record_flush),
    ):
        asyncio.run(tts_stream.tts_stream(websocket))

    assert [event["type"] for event in websocket.sent_json] == [
        "ready",
        "audio",
        "complete",
    ]
    assert websocket.actions == ["complete", "flush", "close"]
    assert "turn:terminal-flush" not in tts_stream._active_sessions


def test_stream_rejects_out_of_order_commit():
    with (
        patch.object(tts_stream, "get_engine", return_value=FakeStreamingEngine()),
        patch.object(tts_stream, "_voice_id", return_value="voice"),
        client().websocket_connect("/tts/stream") as websocket,
    ):
        websocket.send_json(start_message("turn:out-of-order"))
        assert websocket.receive_json()["type"] == "ready"
        websocket.send_json({"type": "text", "sequence": 1, "text": "Ошибка."})
        error = websocket.receive_json()
        assert error["type"] == "error"
        assert error["code"] == "protocol_error"


def test_stream_rejects_oversized_input_and_releases_session():
    with (
        patch.object(tts_stream, "get_engine", return_value=FakeStreamingEngine()),
        patch.object(tts_stream, "_voice_id", return_value="voice"),
        client().websocket_connect("/tts/stream") as websocket,
    ):
        websocket.send_json(start_message("turn:oversized"))
        assert websocket.receive_json()["type"] == "ready"
        websocket.send_json({"type": "text", "sequence": 0, "text": "x" * 221})
        error = websocket.receive_json()
        assert error["type"] == "error"
        assert error["code"] == "protocol_error"

    assert "turn:oversized" not in tts_stream._active_sessions


def test_stream_propagates_worker_failure_without_fallback():
    with (
        patch.object(tts_stream, "get_engine", return_value=FailingStreamingEngine()),
        patch.object(tts_stream, "_voice_id", return_value="voice"),
        client().websocket_connect("/tts/stream") as websocket,
    ):
        websocket.send_json(start_message("turn:worker-failure"))
        assert websocket.receive_json()["type"] == "ready"
        websocket.send_json({"type": "text", "sequence": 0, "text": "Ошибка движка."})
        websocket.send_json({"type": "finish-input"})
        error = websocket.receive_json()
        assert error == {
            "type": "error",
            "code": "synthesis_failed",
            "message": "synthetic worker failure",
        }

    assert "turn:worker-failure" not in tts_stream._active_sessions


def test_cancel_after_finish_input_wins_over_stream_completion():
    with (
        patch.object(tts_stream, "get_engine", return_value=TwoChunkStreamingEngine()),
        patch.object(tts_stream, "_voice_id", return_value="voice"),
        client().websocket_connect("/tts/stream") as websocket,
    ):
        websocket.send_json(start_message("turn:cancel-after-finish"))
        assert websocket.receive_json()["type"] == "ready"
        websocket.send_json({"type": "text", "sequence": 0, "text": "Отменить."})
        websocket.send_json({"type": "finish-input"})
        assert websocket.receive_json()["type"] == "audio"
        websocket.receive_bytes()
        websocket.send_json({"type": "cancel", "reason": "barge-in"})
        assert websocket.receive_json() == {
            "type": "cancelled",
            "sessionId": "turn:cancel-after-finish",
        }

    assert "turn:cancel-after-finish" not in tts_stream._active_sessions


def test_stream_rejects_duplicate_active_session():
    with (
        patch.object(tts_stream, "get_engine", return_value=FakeStreamingEngine()),
        patch.object(tts_stream, "_voice_id", return_value="voice"),
        client() as api,
        api.websocket_connect("/tts/stream") as first,
    ):
        first.send_json(start_message("turn:duplicate"))
        assert first.receive_json()["type"] == "ready"
        with api.websocket_connect("/tts/stream") as duplicate:
            duplicate.send_json(start_message("turn:duplicate"))
            error = duplicate.receive_json()
            assert error["type"] == "error"
            assert error["code"] == "duplicate_session"
        first.send_json({"type": "cancel", "reason": "test-complete"})
        assert first.receive_json()["type"] == "cancelled"

    assert "turn:duplicate" not in tts_stream._active_sessions


def test_twenty_synthetic_cancel_cycles_leave_no_active_sessions():
    with (
        patch.object(tts_stream, "get_engine", return_value=FakeStreamingEngine()),
        patch.object(tts_stream, "_voice_id", return_value="voice"),
        client() as api,
    ):
        for index in range(20):
            session_id = f"turn:lifecycle:{index}"
            with api.websocket_connect("/tts/stream") as websocket:
                websocket.send_json(start_message(session_id))
                assert websocket.receive_json()["type"] == "ready"
                websocket.send_json({"type": "cancel", "reason": "synthetic-cycle"})
                assert websocket.receive_json()["type"] == "cancelled"

    assert tts_stream._active_sessions == set()


@pytest.mark.parametrize(
    ("emotion", "expected", "compatibility"),
    [
        ("warm", "warm and caring", "native"),
        ("happy", "bright, happy", "native"),
        ("laugh", "natural laugh", "approximate"),
        ("sad", "sad, subdued", "native"),
        ("angry", "controlled anger", "native"),
        ("surprised", "genuine surprise", "native"),
        ("sigh", "natural sigh", "approximate"),
        ("gasp", "natural gasp", "approximate"),
        ("whisper", "soft whisper", "native"),
    ],
)
def test_delivery_adapter_maps_provider_neutral_emotions(
    emotion: str, expected: str, compatibility: str
):
    adapter = CosyVoiceDeliveryAdapter()
    instruction = adapter.instruction(SpeechDeliveryIntent(emotion=emotion), "ru")

    assert instruction is not None
    assert expected in instruction
    assert "Speak in Russian" in instruction
    assert instruction.endswith("<|endofprompt|>")
    assert adapter.compatibility(emotion) == compatibility


def test_unknown_delivery_emotion_is_explicitly_unsupported():
    adapter = CosyVoiceDeliveryAdapter()
    assert adapter.compatibility("unknown") == "unsupported"
