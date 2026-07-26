import logging

from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from pydantic import BaseModel

from app.asr import SileroVAD, WhisperASR
from app.audio import load_wav

logger = logging.getLogger(__name__)

router = APIRouter(tags=["asr"])

# Global ASR instances
_whisper: WhisperASR | None = None
_vad: SileroVAD | None = None


class RecognizeSegment(BaseModel):
    """Single recognized segment."""

    text: str
    start: float
    end: float
    duration: float


class RecognizeResponse(BaseModel):
    """Response from /recognize endpoint."""

    text: str
    segments: list[RecognizeSegment]
    language: str
    language_probability: float


def init_asr(whisper: WhisperASR, vad: SileroVAD):
    """Initialize ASR engines."""
    global _whisper, _vad
    _whisper = whisper
    _vad = vad


@router.post("/recognize", response_model=RecognizeResponse, summary="Распознать WAV-файл")
async def recognize(
    file: UploadFile = File(...),
    language: str | None = Query(None, description="Force language (ru/en/auto)"),
):
    """
    Recognize speech from uploaded WAV file.

    - **file**: WAV audio file
    - **language**: Optional language code (auto/ru/en)
    """
    if _whisper is None:
        raise HTTPException(status_code=503, detail="ASR not initialized")

    try:
        # Read uploaded file
        contents = await file.read()

        # Save to temp file and load
        import tempfile

        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            tmp.write(contents)
            tmp_path = tmp.name

        # Load audio
        audio, sr = load_wav(tmp_path, sr=16000)

        # Clean up
        import os

        os.unlink(tmp_path)

        # Transcribe
        result = _whisper.transcribe(audio, sr=16000, language=language)

        # Convert segments
        segments = [
            RecognizeSegment(
                text=seg["text"], start=seg["start"], end=seg["end"], duration=seg["duration"]
            )
            for seg in result["segments"]
        ]

        return RecognizeResponse(
            text=result["text"],
            segments=segments,
            language=result["language"],
            language_probability=result["language_probability"],
        )

    except Exception as e:
        logger.error(f"Recognition error: {e}")
        raise HTTPException(status_code=500, detail=str(e)) from e
