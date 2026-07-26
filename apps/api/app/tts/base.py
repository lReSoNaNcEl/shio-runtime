import logging
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass

import numpy as np

logger = logging.getLogger(__name__)


@dataclass
class SynthesisResult:
    """Result of TTS synthesis."""

    audio: np.ndarray  # Audio samples as float32 [-1, 1]
    sample_rate: int
    duration_sec: float
    language: str
    emotion: str
    engine: str
    latency_ms: float
    rtf: float  # Real-time factor
    text: str


class TTSEngine(ABC):
    """Abstract base class for TTS engines."""

    def __init__(self, engine_name: str):
        """Initialize TTS engine."""
        self.engine_name = engine_name
        self.is_ready = False

    @abstractmethod
    def synthesize(
        self,
        text: str,
        language: str = "en",
        emotion: str = "neutral",
        voice: str | None = None,
        speed: float = 1.0,
        **kwargs,
    ) -> SynthesisResult:
        """
        Synthesize speech.

        Args:
            text: Text to synthesize
            language: Language code (ru/en)
            emotion: Emotion name
            voice: Logical voice ID
            speed: Speed factor (0.5 - 2.0)
            **kwargs: Engine-specific parameters

        Returns:
            SynthesisResult with audio and metadata
        """
        pass

    @abstractmethod
    def warmup(self):
        """Warmup model with dummy synthesis."""
        pass

    def is_available(self) -> bool:
        """Check if engine is ready."""
        return self.is_ready

    def measure_rtf(self, audio: np.ndarray, sr: int, latency_ms: float) -> float:
        """
        Calculate Real-Time Factor (RTF).

        RTF = inference_time / audio_duration
        """
        audio_duration = len(audio) / sr
        if audio_duration == 0:
            return 0

        inference_time_sec = latency_ms / 1000
        return inference_time_sec / audio_duration


class LocalTTSEngine(TTSEngine):
    """Base class for locally-running TTS engines."""

    def __init__(self, engine_name: str, device: str = "cuda"):
        """Initialize local TTS engine."""
        super().__init__(engine_name)
        self.device = device

    def _measure_synthesis(self, synthesis_fn, *args, **kwargs) -> tuple[np.ndarray, float]:
        """
        Measure synthesis time.

        Returns (audio, latency_ms)
        """
        start_time = time.perf_counter()

        try:
            audio = synthesis_fn(*args, **kwargs)
        finally:
            end_time = time.perf_counter()
            latency_ms = (end_time - start_time) * 1000

        return audio, latency_ms
