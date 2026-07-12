import unittest

import numpy as np

from app.asr.streaming import StreamingASRSession, StreamingVADConfig


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


if __name__ == "__main__":
    unittest.main()
