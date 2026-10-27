import asyncio
import time
from collections.abc import Iterable
from unittest.mock import patch

import numpy as np
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError
from starlette.websockets import WebSocketDisconnect, WebSocketState

from app.routes import tts_stream
from app.tts.fish import FishS2ProDeliveryAdapter, SpeechDeliveryIntent, SpeechTextChunk


class FakeStreamingEngine:
    sample_rate = 24000

    def is_available(self):
        return True

    def stream(self, text_chunks: Iterable[SpeechTextChunk], **_kwargs):
        for chunk in text_chunks:
            yield np.full(len(chunk.text), 0.25, dtype=np.float32)


class FailingStreamingEngine:
    sample_rate = 24000

    def is_available(self):
        return True

    def stream(self, text_chunks: Iterable[SpeechTextChunk], **_kwargs):
        next(iter(text_chunks))
        raise RuntimeError("synthetic worker failure")
        yield  # pragma: no cover - keeps this a generator without real audio


class TwoChunkStreamingEngine:
    sample_rate = 24000

    def is_available(self):
        return True

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


def test_loading_engine_is_rejected_without_reserving_a_session():
    engine = FakeStreamingEngine()
    engine.is_available = lambda: False
    with (
        patch.object(tts_stream, "get_engine", return_value=engine),
        patch.object(tts_stream, "_voice_id", return_value="voice"),
        client().websocket_connect("/tts/stream") as websocket,
    ):
        websocket.send_json(start_message("turn:not-ready"))
        assert websocket.receive_json()["code"] == "synthesis_not_ready"
    assert "turn:not-ready" not in tts_stream._active_sessions


def start_message(session_id: str = "turn:test") -> dict:
    return {
        "type": "start",
        "protocolVersion": 2,
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


@pytest.mark.parametrize(
    "style", ["", " x", "x ", "x" * 121, "[angry]", "<tool>", "bad\nstyle", "bad\u200bstyle"]
)
def test_voice_style_rejects_unbounded_or_nested_control(style):
    with pytest.raises(ValidationError):
        tts_stream.DeliveryIntentMessage(style=style)
    with pytest.raises(ValueError):
        FishS2ProDeliveryAdapter().instruction(SpeechDeliveryIntent(style=style), "ru")


def test_voice_style_reaches_engine_and_keeps_canonical_audio_cue():
    chunks = []

    class RecordingEngine(FakeStreamingEngine):
        def stream(self, text_chunks, **kwargs):
            for chunk in text_chunks:
                chunks.append(chunk)
                yield from super().stream([chunk], **kwargs)

    with (
        patch.object(tts_stream, "get_engine", return_value=RecordingEngine()),
        patch.object(tts_stream, "_voice_id", return_value="voice"),
        client().websocket_connect("/tts/stream") as websocket,
    ):
        start = start_message("turn:style")
        start["delivery"]["style"] = "soft reassuring tone"
        websocket.send_json(start)
        assert websocket.receive_json()["type"] == "ready"
        websocket.send_json({"type": "text", "sequence": 0, "text": "Я рядом."})
        websocket.send_json(
            {
                "type": "delivery",
                "sequence": 1,
                "delivery": {"emotion": "whisper", "style": "whisper in small voice"},
            }
        )
        websocket.send_json({"type": "text", "sequence": 2, "text": "Тихий секрет."})
        websocket.send_json({"type": "finish-input"})
        for emotion, sequence in [("warm", 0), ("whisper", 2)]:
            audio = websocket.receive_json()
            assert audio["emotion"] == emotion
            assert audio["textSequence"] == sequence
            assert len(websocket.receive_bytes()) == audio["samples"] * 4
        assert websocket.receive_json()["type"] == "complete"
    assert [chunk.intent.style for chunk in chunks] == [
        "soft reassuring tone",
        "whisper in small voice",
    ]
    instruction = FishS2ProDeliveryAdapter().instruction(chunks[1].intent, "ru")
    assert "[whisper in small voice]" in instruction


def test_stream_emits_versioned_ready_and_ordered_float32_pcm():
    with (
        patch.object(tts_stream, "get_engine", return_value=FakeStreamingEngine()),
        patch.object(tts_stream, "_voice_id", return_value="voice"),
        client().websocket_connect("/tts/stream") as websocket,
    ):
        websocket.send_json(start_message())
        ready = websocket.receive_json()
        assert ready["type"] == "ready"
        assert ready["protocolVersion"] == 2
        assert ready["engine"] == "fish-s2-pro"
        assert ready["sampleFormat"] == "float32-le"
        assert ready["sampleRate"] == 24000

        websocket.send_json({"type": "text", "sequence": 0, "text": "Привет."})
        websocket.send_json({"type": "finish-input"})
        audio = websocket.receive_json()
        payload = websocket.receive_bytes()
        complete = websocket.receive_json()

        assert audio == {
            "type": "audio",
            "sessionId": "turn:test",
            "turnId": "turn:test",
            "sequence": 0,
            "samples": 7,
            "sampleOffset": 0,
            "emotion": "warm",
            "textSequence": 0,
        }
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
        assert "turn:duplicate" in tts_stream._active_sessions
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
    "emotion",
    [
        "warm",
        "happy",
        "laugh",
        "sad",
        "angry",
        "surprised",
        "sigh",
        "gasp",
        "whisper",
        "proud",
        "shy",
        "dazed",
    ],
)
def test_delivery_adapter_maps_provider_neutral_emotions(emotion):
    adapter = FishS2ProDeliveryAdapter()
    instruction = adapter.instruction(SpeechDeliveryIntent(emotion=emotion), "ru")
    assert instruction and instruction.startswith("[") and instruction.endswith("]")
    assert adapter.compatibility(emotion) == "native"


def test_unknown_delivery_emotion_is_explicitly_unsupported():
    adapter = FishS2ProDeliveryAdapter()
    assert adapter.compatibility("unknown") == "unsupported"


def test_busy_session_is_rejected_without_reserving_or_delaying_cancellation():
    with (
        patch.object(tts_stream, "get_engine", return_value=FakeStreamingEngine()),
        patch.object(tts_stream, "_voice_id", return_value="voice"),
        client() as api,
        api.websocket_connect("/tts/stream") as first,
    ):
        first.send_json(start_message("turn:capacity:first"))
        assert first.receive_json()["type"] == "ready"
        with api.websocket_connect("/tts/stream") as second:
            second.send_json(start_message("turn:capacity:second"))
            assert second.receive_json()["code"] == "synthesis_busy"
        assert "turn:capacity:second" not in tts_stream._active_sessions
        first.send_json({"type": "cancel", "reason": "test"})
        assert first.receive_json()["type"] == "cancelled"


def test_receiver_cancellation_observes_both_finish_input_race_tasks():
    async def scenario():
        socket = TerminalFlushWebSocket()
        with (
            patch.object(tts_stream, "get_engine", return_value=FakeStreamingEngine()),
            patch.object(tts_stream, "_voice_id", return_value="voice"),
        ):
            handler = asyncio.create_task(tts_stream.tts_stream(socket))
            for _ in range(100):
                if socket.receive_calls >= 4:
                    break
                await asyncio.sleep(0.005)
            assert socket.receive_calls >= 4
            handler.cancel()
            await asyncio.gather(handler, return_exceptions=True)
            socket.closed.set()
            await asyncio.sleep(0)
            leaked = [
                task
                for task in asyncio.all_tasks()
                if task is not asyncio.current_task() and not task.done()
            ]
            assert not leaked, [task.get_coro().__qualname__ for task in leaked]
            assert not tts_stream._active_sessions

    asyncio.run(scenario())
