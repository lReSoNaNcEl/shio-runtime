import asyncio
import json
import unittest
from threading import Event
from unittest.mock import AsyncMock, Mock, patch

import numpy as np
import torch
from fastapi import WebSocket

from app.asr.streaming import StreamingASRSession, StreamingVADConfig
from app.asr.vad import SileroVAD
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
    def test_silero_recurrent_state_does_not_keep_an_autograd_graph(self):
        session = StreamingASRSession(FakeWhisper(), SileroVAD(), session_id="silero")
        self.addCleanup(session.close)

        with torch.enable_grad():
            session.process_pcm(np.zeros(8 * session.vad_frame_samples, dtype=np.float32))

        self.assertIsNone(session._vad_model._state.grad_fn)

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
        self.assertEqual([job.kind for job in jobs], ["endpoint", "final"])
        self.assertEqual(session.transcribe(jobs[0]), [])
        final_events = session.transcribe(jobs[1])
        self.assertEqual([event["type"] for event in final_events], ["final", "speech_ended"])
        self.assertEqual(final_events[0]["reason"], "vad_silence")
        self.assertEqual(final_events[0]["revision"], 1)
        self.assertEqual(final_events[0]["sessionId"], "test-session")
        self.assertEqual(final_events[0]["segmentId"], final_events[1]["segmentId"])
        self.assertEqual(len(whisper.calls), 1)

    def test_exact_endpoint_reused_only_at_confirmed_silence(self):
        whisper = FakeWhisper()
        voiced = 16
        session = StreamingASRSession(whisper, FakeVad([0.9] * voiced + [0.0] * 21), "test")
        timeline = []
        # Every frame differs so an offset/trim error cannot pass byte equality.
        for i in range(voiced + 21):
            _, jobs = session.process_pcm(np.full(512, i / 100, dtype=np.float32))
            for job in jobs:
                cached = session.finish_prepared(job)
                events = cached if cached is not None else session.transcribe(job)
                timeline.append((i + 1 - voiced, job, events))
        (at_prepare, candidate, silent), (at_commit, final, events) = timeline
        self.assertEqual((at_prepare, at_commit), (11, 21))
        self.assertEqual(silent, [])
        self.assertEqual([event["type"] for event in events], ["final", "speech_ended"])
        self.assertEqual(events[0]["text"], "Шио, ты тут?")
        self.assertEqual(len(whisper.calls), 1)
        np.testing.assert_array_equal(candidate.audio, final.audio)
        self.assertEqual(candidate.end_sample, final.end_sample)
        self.assertIsNone(session.finish_prepared(final))

    def test_resumed_speech_and_explicit_flush_do_not_use_a_pause_hypothesis(self):
        for pause_then_resume in (True, False):
            with self.subTest(resume=pause_then_resume):
                whisper = FakeWhisper()
                voiced = [0.9] * 15
                probabilities = voiced + [0.0] * 15
                if pause_then_resume:
                    probabilities += voiced + [0.0] * 21
                session = StreamingASRSession(whisper, FakeVad(probabilities), "test")
                prepared = []
                final = None
                for i in range(len(probabilities)):
                    _, jobs = session.process_pcm(np.full(512, i / 100, dtype=np.float32))
                    for job in jobs:
                        if job.kind == "endpoint":
                            prepared.append(job)
                            # The second pause may occur while the model is busy.
                            if len(prepared) == 1:
                                self.assertEqual(session.transcribe(job), [])
                        elif job.kind == "final":
                            final = job
                final = final or session.flush("flush")
                self.assertIsNotNone(final)
                self.assertGreater(final.end_sample, prepared[0].end_sample)
                self.assertIsNone(session.finish_prepared(final))
                self.assertEqual(session.transcribe(final)[0]["type"], "final")
                self.assertEqual(len(whisper.calls), 2)

    def test_multiple_pauses_in_one_chunk_skip_stale_audio_and_bound_work(self):
        whisper = FakeWhisper()
        probabilities = ([0.9] * 8 + [0.0] * 13) * 3 + [0.9] * 8 + [0.0] * 21
        session = StreamingASRSession(
            whisper,
            FakeVad(probabilities),
            "several-pauses",
            config=StreamingVADConfig(partial_interval_ms=5000),
        )
        # Two optional jobs are produced during natural pauses; at dispatch only
        # the last matches the latest voiced frame. Later pauses use normal finalization.
        _, candidates = session.process_pcm(np.ones((8 + 13) * 2 * 512, dtype=np.float32))
        self.assertEqual([job.kind for job in candidates], ["endpoint", "endpoint"])
        for job in candidates:
            self.assertEqual(session.transcribe(job), [])
        self.assertEqual(len(whisper.calls), 1)
        _, (final,) = session.process_pcm(np.ones((8 + 13 + 8 + 21) * 512, dtype=np.float32))
        self.assertEqual(final.kind, "final")
        self.assertIsNone(session.finish_prepared(final))
        self.assertEqual(session.transcribe(final)[0]["type"], "final")
        self.assertEqual(len(whisper.calls), 2)

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
    async def test_optional_decode_never_waits_behind_another_session(self):
        whisper = FakeWhisper()
        session = StreamingASRSession(whisper, FakeVad([0.9] * 6 + [0.0] * 21), "test")
        _, (candidate,) = session.process_pcm(np.ones((6 + 11) * 512, dtype=np.float32))
        slot = asyncio.BoundedSemaphore(1)
        socket = AsyncMock()
        with patch.object(ws, "_decode_slot", slot):
            async with slot:
                await asyncio.wait_for(
                    ws._send_decode(socket, asyncio.Lock(), session, candidate), 1
                )
                waiting = asyncio.create_task(slot.acquire())
                await asyncio.sleep(0)
            # The slot belongs to a waiting decode even before it resumes.
            try:
                async with asyncio.timeout(1):
                    await ws._send_decode(socket, asyncio.Lock(), session, candidate)
            finally:
                await waiting
                slot.release()
            self.assertEqual(len(whisper.calls), 0)
            socket.send_json.assert_not_called()
            _, (final,) = session.process_pcm(np.zeros(10 * 512, dtype=np.float32))
            await ws._send_decode(socket, asyncio.Lock(), session, final)
        self.assertEqual(len(whisper.calls), 1)
        self.assertEqual(socket.send_json.call_args_list[0].args[0]["type"], "final")

    async def test_disconnect_during_early_decode_holds_whisper_until_inference_returns(self):
        entered, release = Event(), Event()
        first = StreamingASRSession(Mock(), FakeVad([0.9] * 6 + [0.0] * 11), "first")
        _, (candidate,) = first.process_pcm(np.ones((6 + 11) * 512, dtype=np.float32))
        second = StreamingASRSession(Mock(), FakeVad([0.9] * 6 + [0.0] * 21), "second")
        _, (_, final) = second.process_pcm(np.ones((6 + 21) * 512, dtype=np.float32))

        def transcribe(*args, **kwargs):
            entered.set()
            if not release.wait(5):
                raise TimeoutError("test inference was not released")
            return {"text": "old"}

        first.whisper.transcribe.side_effect = transcribe
        second.whisper.transcribe.return_value = {"text": "current"}
        old_socket, fresh_socket = AsyncMock(), AsyncMock()
        with patch.object(ws, "_decode_slot", asyncio.BoundedSemaphore(1)):
            old = asyncio.create_task(ws._send_decode(old_socket, asyncio.Lock(), first, candidate))
            try:
                self.assertTrue(await asyncio.to_thread(entered.wait, 1))
                old.cancel()
                with self.assertRaises(asyncio.CancelledError):
                    await old
                first.close()
                self.assertTrue(ws._decode_slot.locked())
                fresh = asyncio.create_task(
                    ws._send_decode(fresh_socket, asyncio.Lock(), second, final)
                )
                await asyncio.sleep(0)
                second.whisper.transcribe.assert_not_called()
            finally:
                release.set()
            await asyncio.wait_for(fresh, 1)
            first.whisper.transcribe.assert_called_once()
            old_socket.send_json.assert_not_called()
            second.whisper.transcribe.assert_called_once()
            self.assertEqual(fresh_socket.send_json.call_args_list[0].args[0]["text"], "current")
            self.assertFalse(ws._decode_slot.locked())

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
