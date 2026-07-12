import logging
import re

import numpy as np
from faster_whisper import WhisperModel

logger = logging.getLogger(__name__)


def _norm(text: str) -> str:
    """Lowercase + drop everything but letters/digits, for robust phrase matching."""
    return re.sub(r"[^0-9a-zа-яё]+", "", text.lower())


# Whisper is trained on YouTube subtitles, so on silence / unintelligible audio it
# hallucinates stock phrases. We (a) drop segments that ARE one of these phrases and
# (b) strip them when glued onto the end of a real sentence.
_HALLUCINATION_PHRASES = {
    _norm(p)
    for p in (
        "Thanks for watching!",
        "Thanks for watching.",
        "Thanks for watching",
        "Thank you for watching!",
        "Thank you for watching.",
        "Thank you for watching",
        "Thanks for watching everyone!",
        "Please subscribe",
        "Like and subscribe",
        "Subscribe to my channel",
        "Don't forget to subscribe",
        "Продолжение следует...",
        "Спасибо за просмотр!",
        "Спасибо за просмотр.",
        "Редактор субтитров",
        "Субтитры subs.media",
        "Субтитры подготовлены сообществом",
        "Дякую за перегляд!",
    )
}

# Strip a hallucinated phrase glued onto the tail of an otherwise real sentence.
_TRAILING_HALLUCINATION_RE = re.compile(
    r"\s*(thanks?\s+for\s+watching|thank\s+you\s+for\s+watching|"
    r"please\s+subscribe|like\s+and\s+subscribe|subscribe\s+to\s+my\s+channel|"
    r"продолжение\s+следует|спасибо\s+за\s+просмотр|дякую\s+за\s+перегляд)"
    r"[\s!.…]*$",
    re.IGNORECASE,
)


def _clean_segment_text(text: str) -> str | None:
    """Return cleaned segment text, or None if the whole segment is a hallucination."""
    if _norm(text) in _HALLUCINATION_PHRASES:
        return None
    cleaned = _TRAILING_HALLUCINATION_RE.sub("", text)
    return cleaned if cleaned.strip() else None


class WhisperASR:
    def __init__(
        self,
        model_size: str = "medium",
        device: str = "cuda",
        compute_type: str = "auto",
        language: str | None = None,
    ):
        """Initialize Whisper ASR model."""
        self.model_size = model_size
        self.device = device
        self.compute_type = compute_type
        self.language = language

        logger.info(f"Loading Whisper {model_size} model...")
        self.model = WhisperModel(model_size, device=device, compute_type=compute_type)
        logger.info("Whisper model loaded successfully")

    def transcribe(self, audio: np.ndarray, sr: int = 16000, language: str | None = None) -> dict:
        """Transcribe audio."""
        # Ensure audio is in correct format
        if len(audio.shape) > 1:
            audio = np.mean(audio, axis=1)

        audio = audio.astype(np.float32)

        # Use specified language or auto-detect
        detect_lang = language or self.language

        logger.info(f"Transcribing audio (language={detect_lang})...")

        segments, info = self.model.transcribe(
            audio,
            language=detect_lang,
            beam_size=5,
            best_of=5,
            temperature=0.0,
            # Anti-hallucination: VAD drops silence (where Whisper invents
            # "Thanks for watching!"); not conditioning on previous text stops
            # such phrases carrying over; thresholds discard low-confidence takes.
            vad_filter=True,
            vad_parameters=dict(min_silence_duration_ms=500),
            condition_on_previous_text=False,
            no_speech_threshold=0.6,
            compression_ratio_threshold=2.4,
            log_prob_threshold=-1.0,
        )

        # Collect segments, dropping/cleaning Whisper hallucinations
        text_parts = []
        segment_list = []

        for segment in segments:
            cleaned = _clean_segment_text(segment.text)
            if cleaned is None:
                logger.info("Dropped hallucinated ASR segment: %r", segment.text.strip())
                continue
            text_parts.append(cleaned)
            segment_list.append(
                {
                    "text": cleaned,
                    "start": segment.start,
                    "end": segment.end,
                    "duration": segment.end - segment.start,
                }
            )

        full_text = "".join(text_parts).strip()
        # Safety net: strip a hallucination still glued to the very end.
        full_text = _TRAILING_HALLUCINATION_RE.sub("", full_text).strip()

        return {
            "text": full_text,
            "segments": segment_list,
            "language": info.language,
            "language_probability": info.language_probability,
        }

    def detect_language(self, audio: np.ndarray, sr: int = 16000) -> dict:
        """Detect language of audio."""
        if len(audio.shape) > 1:
            audio = np.mean(audio, axis=1)

        audio = audio.astype(np.float32)

        # Use first 30 seconds for language detection
        sr_eff = 16000
        num_samples = int(30 * sr_eff)
        audio_chunk = audio[:num_samples]

        _, info = self.model.transcribe(audio_chunk, language=None)

        return {"language": info.language, "probability": float(info.language_probability)}

    def warmup(self):
        """Warmup model with dummy audio."""
        logger.info("Warming up Whisper model...")
        dummy_audio = np.random.randn(16000).astype(np.float32)

        try:
            self.transcribe(dummy_audio)
            logger.info("Whisper warmup completed")
        except Exception as e:
            logger.error(f"Warmup failed: {e}")
