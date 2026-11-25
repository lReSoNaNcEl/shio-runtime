import asyncio
import json
import unittest
from threading import Event
from unittest.mock import Mock, patch

import numpy as np
from fastapi import WebSocket

from app.asr.streaming import StreamingASRSession, StreamingVADConfig
from app.routes import ws


class FakeVadModel:
    def __init__(self, probabilities):
        self.probabilities = list(probabilities)

    def reset_states(self):
        pass

    def __call__(self, _frame, _sample_rate):
        probability = self.probabilities.pop(0) if self.probabilities else 0.0
        return FakeProbability(probability)


class FakeProbability:
    def __init__(self, value):
        self.value = value

    def item(self):
        return self.value


class FakeVad:
    def __init__(self, probabilities):
        self.model = FakeVadModel(probabilities)


class FakeWhisper:
    def __init__(self):
        self.calls = []

    def transcribe(self, audio, sr, language):
        self.calls.append((audio.copy(), sr, language))
        return {"text": "Шио, ты тут?"}


class StreamingASRSessionTests(unittest.TestCase):
    def test_playback_sentence_crosses_visual_samples_and_decodes_once_at_the_pause(self):
        whisper = FakeWhisper()
        voiced_frames = 235  # about 7.5 seconds, across two visual sampling windows
        session = StreamingASRSession(
            whisper,
            FakeVad([0.9] * voiced_frames + [0.0] * 21),
            session_id="playback",
            config=StreamingVADConfig(partial_results=False),
        )
        audio = np.full((voiced_frames + 21) * 512, 0.1, dtype=np.float32)
        jobs = []
        for chunk in np.array_split(audio, 8):
            _, new_jobs = session.process_pcm(chunk)
            jobs.extend(new_jobs)
        self.assertEqual([(job.kind, job.reason) for job in jobs], [("final", "vad_silence")])
        self.assertEqual(jobs[0].start_sample, 0)
        self.assertGreaterEqual(jobs[0].end_sample, voiced_frames * 512)
        session.transcribe(jobs[0])
        self.assertEqual(len(whisper.calls), 1)

    def test_natural_pause_emits_one_final_then_speech_ended(self):
        # Six 32 ms voiced frames satisfy min_speech=180 ms; 21 silent frames
        # satisfy min_silence=650 ms.
        whisper = FakeWhisper()
        session = StreamingASRSession(
            whisper,
            FakeVad([0.9] * 6 + [0.0] * 21),
            session_id="test-session",
            language="ru",
            config=StreamingVADConfig(),
        )
        events, jobs = session.process_pcm(np.ones(27 * 512, dtype=np.float32) * 0.1)

        self.assertEqual([event["type"] for event in events], ["speech_started"])
        self.assertEqual(len(jobs), 1)
        final_events = session.transcribe(jobs[0])
        self.assertEqual([event["type"] for event in final_events], ["final", "speech_ended"])
        self.assertEqual(final_events[0]["reason"], "vad_silence")
        self.assertEqual(final_events[0]["revision"], 1)
        self.assertEqual(final_events[0]["sessionId"], "test-session")
        self.assertEqual(final_events[0]["segmentId"], final_events[1]["segmentId"])
        self.assertEqual(len(whisper.calls), 1)

    def test_silence_never_invokes_whisper(self):
        whisper = FakeWhisper()
        session = StreamingASRSession(whisper, FakeVad([0.0] * 100), session_id="silence")
        events, jobs = session.process_pcm(np.zeros(100 * 512, dtype=np.float32))
        self.assertEqual(events, [])
        self.assertEqual(jobs, [])
        self.assertEqual(whisper.calls, [])

    def test_flush_finalizes_only_active_segment(self):
        whisper = FakeWhisper()
        session = StreamingASRSession(whisper, FakeVad([0.9] * 6), session_id="flush")
        session.process_pcm(np.ones(6 * 512, dtype=np.float32) * 0.1)
        job = session.flush()
        self.assertIsNotNone(job)
        final_events = session.transcribe(job)
        self.assertEqual(final_events[0]["reason"], "flush")
        self.assertIsNone(session.flush())

    def test_partial_snapshots_have_monotonic_revisions_before_final(self):
        whisper = FakeWhisper()
        session = StreamingASRSession(
            whisper,
            FakeVad([0.9] * 50 + [0.0] * 21),
            session_id="partials",
            config=StreamingVADConfig(partial_interval_ms=800),
        )
        all_jobs = []
        for _ in range(71):
            _, jobs = session.process_pcm(np.ones(512, dtype=np.float32) * 0.1)
            all_jobs.extend(jobs)
        partial_jobs = [job for job in all_jobs if job.kind == "partial"]
        final_jobs = [job for job in all_jobs if job.kind == "final"]
        self.assertGreaterEqual(len(partial_jobs), 1)
        partial = session.transcribe(partial_jobs[0])[0]
        final = session.transcribe(final_jobs[0])[0]
        self.assertEqual(partial["type"], "partial")
        self.assertEqual(final["type"], "final")
        self.assertGreater(final["revision"], partial["revision"])


class StreamingWorkerFailureTests(unittest.IsolatedAsyncioTestCase):
    async def test_disconnect_holds_whisper_lock_until_inference_returns(self):
        entered, release = Event(), Event()
        first = Mock(closed=False)
        second = Mock(closed=False)

        def transcribe(_job):
            entered.set()
            if not release.wait(5):
                raise TimeoutError("test inference was not released")
            return []

        first.transcribe.side_effect = transcribe
        second.transcribe.return_value = []
        with patch.object(ws, "_decode_lock", asyncio.Lock()):
            old = asyncio.create_task(ws._send_decode(Mock(), asyncio.Lock(), first, object()))
            try:
                self.assertTrue(await asyncio.to_thread(entered.wait, 1))
                old.cancel()
                with self.assertRaises(asyncio.CancelledError):
                    await old
                self.assertTrue(ws._decode_lock.locked())
                fresh = asyncio.create_task(
                    ws._send_decode(Mock(), asyncio.Lock(), second, object())
                )
                await asyncio.sleep(0)
                second.transcribe.assert_not_called()
            finally:
                release.set()
            await asyncio.wait_for(fresh, 1)
            second.transcribe.assert_called_once()
            self.assertFalse(ws._decode_lock.locked())

    async def test_worker_failure_releases_blocked_input_and_requests_reconnect(self):
        incoming, outgoing = asyncio.Queue(), asyncio.Queue()
        socket = WebSocket({"type": "websocket"}, incoming.get, outgoing.put)
        incoming.put_nowait({"type": "websocket.connect"})
        incoming.put_nowait(
            {
                "type": "websocket.receive",
                "text": json.dumps(
                    {
                        "type": "start",
                        "protocolVersion": 1,
                        "sessionId": "failed-worker",
                        "sampleRate": 16000,
                        "channels": 1,
                        "format": "pcm_s16le",
                    }
                ),
            }
        )
        for _ in range(ws.settings.ASR_AUDIO_QUEUE_FRAMES + 2):
            incoming.put_nowait({"type": "websocket.receive", "bytes": bytes(1024)})
        recognizer = Mock(session_id="failed-worker", closed=False)
        recognizer.process_pcm.side_effect = RuntimeError("synthetic VAD failure")
        with (
            patch.object(ws, "_vad", object()),
            patch.object(ws, "_whisper", object()),
            patch.object(ws, "StreamingASRSession", return_value=recognizer),
        ):
            await asyncio.wait_for(ws.websocket_recognize(socket), timeout=1)
        events = []
        while not outgoing.empty():
            item = outgoing.get_nowait()
            if item["type"] == "websocket.send":
                events.append(json.loads(item["text"]))
            elif item["type"] == "websocket.close":
                self.assertEqual(item["code"], 1011)
        self.assertEqual(socket.application_state.name, "DISCONNECTED")
        self.assertEqual(events[0]["type"], "ready")
        self.assertEqual(events[-1]["type"], "error")
        self.assertEqual(events[-1]["sessionId"], "failed-worker")
        self.assertEqual(events[-1]["code"], "stream_failure")
        self.assertIs(events[-1]["recoverable"], True)
        recognizer.close.assert_called_once()


if __name__ == "__main__":
    unittest.main()
