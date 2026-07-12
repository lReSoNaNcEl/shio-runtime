import logging
import numpy as np
import torch
import silero_vad
from typing import List, Tuple, Optional

logger = logging.getLogger(__name__)


class SileroVAD:
    def __init__(self, sample_rate: int = 16000):
        """Initialize Silero VAD."""
        self.sample_rate = sample_rate
        self.threshold = 0.5
        self.neg_threshold = 0.35
        self.window_size_samples = 512

        logger.info("Loading Silero VAD model...")
        self.model = silero_vad.load_silero_vad()
        logger.info("Silero VAD loaded successfully")

    def get_speech_timestamps(
        self,
        audio: np.ndarray,
        min_speech_duration_ms: int = 250,
        max_speech_duration_s: float = float('inf'),
        min_silence_duration_ms: int = 100,
        window_size_samples: Optional[int] = None,
        speech_pad_ms: int = 30
    ) -> List[dict]:
        """
        Get speech timestamps from audio.

        Returns list of dicts with 'start' and 'end' in seconds.
        """
        if window_size_samples is None:
            window_size_samples = self.window_size_samples

        # Ensure audio is float32
        audio = audio.astype(np.float32)

        # Normalize audio
        max_val = np.max(np.abs(audio))
        if max_val > 0:
            audio = audio / max_val

        try:
            # silero-vad expects a torch tensor and uses `sampling_rate`
            audio_tensor = torch.from_numpy(audio)

            timestamps = silero_vad.get_speech_timestamps(
                audio_tensor,
                self.model,
                sampling_rate=self.sample_rate,
                threshold=self.threshold,
                min_speech_duration_ms=min_speech_duration_ms,
                max_speech_duration_s=max_speech_duration_s,
                min_silence_duration_ms=min_silence_duration_ms,
                speech_pad_ms=speech_pad_ms,
            )

            # Convert to seconds
            result = []
            for ts in timestamps:
                result.append({
                    'start': ts['start'] / self.sample_rate,
                    'end': ts['end'] / self.sample_rate,
                    'duration': (ts['end'] - ts['start']) / self.sample_rate
                })

            return result

        except Exception as e:
            logger.error(f"VAD processing failed: {e}")
            return []

    def segment_audio(
        self,
        audio: np.ndarray,
        sr: int = 16000,
        min_silence_duration_ms: int = 300
    ) -> List[Tuple[np.ndarray, float, float]]:
        """
        Segment audio into speech chunks.

        Returns list of (audio_chunk, start_sec, end_sec) tuples.
        """
        # Resample if needed
        if sr != self.sample_rate:
            from scipy import signal
            num_samples = int(len(audio) * self.sample_rate / sr)
            audio = signal.resample(audio, num_samples)

        # Get speech timestamps
        timestamps = self.get_speech_timestamps(
            audio,
            min_silence_duration_ms=min_silence_duration_ms
        )

        segments = []
        for ts in timestamps:
            start_sample = int(ts['start'] * self.sample_rate)
            end_sample = int(ts['end'] * self.sample_rate)

            segment_audio = audio[start_sample:end_sample]
            segments.append((segment_audio, ts['start'], ts['end']))

        return segments

    def collect_chunks(
        self,
        audio: np.ndarray,
        min_silence_duration_ms: int = 100
    ) -> List[Tuple[np.ndarray, float, float]]:
        """
        Collect continuous chunks of speech.
        Similar to segment_audio but with finer control.
        """
        return self.segment_audio(audio, self.sample_rate, min_silence_duration_ms)
