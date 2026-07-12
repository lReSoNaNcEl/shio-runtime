import logging
from fastapi import APIRouter, UploadFile, File, Query, HTTPException
from pydantic import BaseModel
from typing import List, Optional
import numpy as np

from app.asr import WhisperASR, SileroVAD
from app.audio import load_wav

logger = logging.getLogger(__name__)

router = APIRouter(tags=["asr"])

# Global ASR instances
_whisper: Optional[WhisperASR] = None
_vad: Optional[SileroVAD] = None


class RecognizeSegment(BaseModel):
    """Single recognized segment."""
    text: str
    start: float
    end: float
    duration: float


class RecognizeResponse(BaseModel):
    """Response from /recognize endpoint."""
    text: str
    segments: List[RecognizeSegment]
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
    language: Optional[str] = Query(None, description="Force language (ru/en/auto)")
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
        with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp:
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
                text=seg['text'],
                start=seg['start'],
                end=seg['end'],
                duration=seg['duration']
            )
            for seg in result['segments']
        ]

        return RecognizeResponse(
            text=result['text'],
            segments=segments,
            language=result['language'],
            language_probability=result['language_probability']
        )

    except Exception as e:
        logger.error(f"Recognition error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
