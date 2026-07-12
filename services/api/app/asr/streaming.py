import copy
import logging
import math
import time
import uuid
from collections import deque
from dataclasses import dataclass

import numpy as np
import torch

from .vad import SileroVAD
from .whisper import WhisperASR

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class StreamingVADConfig:
    threshold: float = 0.5
    negative_threshold: float = 0.35
    min_speech_ms: int = 180
    min_silence_ms: int = 650
    pre_roll_ms: int = 250
    post_roll_ms: int = 200
    max_segment_ms: int = 20_000
    partial_interval_ms: int = 800


@dataclass(frozen=True)
class DecodeJob:
    kind: str
    audio: np.ndarray
    segment_id: str
    reason: str | None
    start_sample: int
    end_sample: int


class StreamingASRSession:
    """Per-WebSocket continuous PCM/VAD state.

    Silero's recurrent state is mutable, so every socket gets a private model
    copy. Whisper remains the shared read-only adapter and is invoked only when
    a segment is finalized.
    """

    sample_rate = 16_000
    vad_frame_samples = 512

    def __init__(
        self,
        whisper: WhisperASR,
        vad: SileroVAD,
        session_id: str,
        language: str | None = None,
        config: StreamingVADConfig = StreamingVADConfig(),  # noqa: B008 - frozen dataclass, safe shared default
    ):
        self.whisper = whisper
        self.language = language
        self.session_id = session_id
        self.config = config
        self._vad_model = copy.deepcopy(vad.model)
        self._vad_model.reset_states()
        self._pending = np.empty(0, dtype=np.float32)
        self._pre_roll = deque(
            maxlen=max(
                1, math.ceil(config.pre_roll_ms * self.sample_rate / 1000 / self.vad_frame_samples)
            )
        )
        self._speech_frames: list[np.ndarray] = []
        self._segment_id: str | None = None
        self._segment_start_sample: int | None = None
        self._voiced_run_samples = 0
        self._silence_samples = 0
        self._total_samples = 0
        self._revision = 0
        self._next_partial_samples = round(config.partial_interval_ms * self.sample_rate / 1000)
        self._last_partial_text = ""
        self.closed = False

    @property
    def speech_active(self) -> bool:
        return self._segment_id is not None

    def process_pcm(self, chunk: np.ndarray) -> tuple[list[dict], list[DecodeJob]]:
        """Consume PCM and return immediate events plus finalized decode jobs."""
        if self.closed or chunk.size == 0:
            return [], []
        chunk = np.asarray(chunk, dtype=np.float32).reshape(-1)
        self._pending = np.concatenate((self._pending, chunk))
        events: list[dict] = []
        decode_jobs: list[DecodeJob] = []
        while self._pending.size >= self.vad_frame_samples:
            frame = self._pending[: self.vad_frame_samples]
            self._pending = self._pending[self.vad_frame_samples :]
            frame_events, job = self._process_vad_frame(frame)
            events.extend(frame_events)
            if job is not None:
                decode_jobs.append(job)
        return events, decode_jobs

    def flush(self, reason: str = "flush") -> DecodeJob | None:
        if self.closed or not self.speech_active:
            return None
        return self._finalize(reason, trim_silence=False)

    def close(self) -> None:
        self.closed = True
        self._pending = np.empty(0, dtype=np.float32)
        self._pre_roll.clear()
        self._speech_frames.clear()
        self._segment_id = None
        self._vad_model.reset_states()

    def transcribe(self, job: DecodeJob) -> list[dict]:
        result = self.whisper.transcribe(job.audio, sr=self.sample_rate, language=self.language)
        text = result["text"]
        if job.kind == "partial":
            if not text or text == self._last_partial_text:
                return []
            self._last_partial_text = text
            self._revision += 1
            return [
                {
                    "type": "partial",
                    "sessionId": self.session_id,
                    "segmentId": job.segment_id,
                    "revision": self._revision,
                    "text": text,
                    "startMs": round(job.start_sample * 1000 / self.sample_rate),
                    "endMs": round(job.end_sample * 1000 / self.sample_rate),
                }
            ]
        self._revision += 1
        now_ms = int(time.time() * 1000)
        return [
            {
                "type": "final",
                "sessionId": self.session_id,
                "segmentId": job.segment_id,
                "revision": self._revision,
                "text": text,
                "startMs": round(job.start_sample * 1000 / self.sample_rate),
                "endMs": round(job.end_sample * 1000 / self.sample_rate),
                "reason": job.reason,
            },
            {
                "type": "speech_ended",
                "sessionId": self.session_id,
                "segmentId": job.segment_id,
                "timestampMs": now_ms,
            },
        ]

    def _process_vad_frame(self, frame: np.ndarray) -> tuple[list[dict], DecodeJob | None]:
        probability = float(self._vad_model(torch.from_numpy(frame), self.sample_rate).item())
        self._total_samples += frame.size
        threshold = self.config.negative_threshold if self.speech_active else self.config.threshold
        voiced = probability >= threshold

        if not self.speech_active:
            self._pre_roll.append(frame.copy())
            self._voiced_run_samples = self._voiced_run_samples + frame.size if voiced else 0
            min_speech_samples = round(self.config.min_speech_ms * self.sample_rate / 1000)
            if self._voiced_run_samples < min_speech_samples:
                return [], None
            self._segment_id = uuid.uuid4().hex
            self._segment_start_sample = max(
                0, self._total_samples - sum(len(value) for value in self._pre_roll)
            )
            self._speech_frames = [value.copy() for value in self._pre_roll]
            self._pre_roll.clear()
            self._silence_samples = 0
            self._revision = 0
            self._next_partial_samples = round(
                self.config.partial_interval_ms * self.sample_rate / 1000
            )
            self._last_partial_text = ""
            return [
                {
                    "type": "speech_started",
                    "sessionId": self.session_id,
                    "segmentId": self._segment_id,
                    "timestampMs": int(time.time() * 1000),
                }
            ], None

        self._speech_frames.append(frame.copy())
        self._silence_samples = 0 if voiced else self._silence_samples + frame.size
        segment_samples = sum(len(value) for value in self._speech_frames)
        if segment_samples >= round(self.config.max_segment_ms * self.sample_rate / 1000):
            return [], self._finalize("max_duration", trim_silence=False)
        if self._silence_samples >= round(self.config.min_silence_ms * self.sample_rate / 1000):
            return [], self._finalize("vad_silence", trim_silence=True)
        if voiced and segment_samples >= self._next_partial_samples:
            while self._next_partial_samples <= segment_samples:
                self._next_partial_samples += round(
                    self.config.partial_interval_ms * self.sample_rate / 1000
                )
            start_sample = self._segment_start_sample or 0
            audio = np.concatenate(self._speech_frames)
            return [], DecodeJob(
                "partial", audio, self._segment_id, None, start_sample, start_sample + audio.size
            )
        return [], None

    def _finalize(self, reason: str, trim_silence: bool) -> DecodeJob:
        assert self._segment_id is not None
        start_sample = self._segment_start_sample or 0
        audio = (
            np.concatenate(self._speech_frames)
            if self._speech_frames
            else np.empty(0, dtype=np.float32)
        )
        if trim_silence:
            post_roll_samples = round(self.config.post_roll_ms * self.sample_rate / 1000)
            trim_samples = max(0, self._silence_samples - post_roll_samples)
            if trim_samples:
                audio = audio[:-trim_samples]
        end_sample = start_sample + audio.size
        job = DecodeJob("final", audio, self._segment_id, reason, start_sample, end_sample)
        self._speech_frames = []
        self._segment_id = None
        self._segment_start_sample = None
        self._voiced_run_samples = 0
        self._silence_samples = 0
        return job
