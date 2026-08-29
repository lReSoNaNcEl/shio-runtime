import asyncio
import logging
import threading

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from app.config import settings
from app.tts import EmotionRegistry
from app.tts.cosyvoice import SpeechDeliveryIntent
from app.tts.runtime import get_engine
from app.tts.voice_repository_manager import voice_repository_manager
from app.tts.voices import default_voice_id, list_presets, voice_registry

logger = logging.getLogger(__name__)
router = APIRouter(tags=["tts"])
emotion_registry = EmotionRegistry(settings.EMOTION_MANIFEST_PATH)


class VoiceWarmupRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    engine: str = Field(default="cosyvoice3", pattern="^cosyvoice3$")
    voiceId: str | None = None
    language: str = Field(default="ru", pattern="^(ru|en)$")


class VoiceSyncRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    dataset: str | None = None
    limit: int | None = Field(default=None, ge=0, le=200)
    force: bool = False


def _resolve_voice_id(requested: str | None) -> str:
    voice_id = requested or default_voice_id()
    try:
        entry = voice_registry.get(voice_id)
    except KeyError as exc:
        raise ValueError(f"Unknown voiceId: {voice_id}") from exc
    if not entry.is_available():
        raise ValueError(f"Voice '{voice_id}' has no local reference assets")
    return voice_id


@router.post("/tts/warmup", summary="Prepare the selected CosyVoice 3 voice")
async def warmup_voice(request: VoiceWarmupRequest):
    try:
        voice_id = _resolve_voice_id(request.voiceId)
        engine = get_engine()
        phrase = "Короткая проверка голоса." if request.language == "ru" else "Short voice check."

        def run() -> None:
            for _chunk in engine.stream(
                [phrase],
                language=request.language,
                voice=voice_id,
                intent=SpeechDeliveryIntent(),
                cancelled=threading.Event(),
            ):
                pass

        await asyncio.to_thread(run)
        return {
            "state": "ready",
            "engine": "cosyvoice3",
            "voiceId": voice_id,
            "language": request.language,
        }
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.get("/voices", summary="List CosyVoice 3 voice references and emotion contract")
async def voices():
    voice_repository_manager.reconcile_local_assets()
    voice_registry.reload()
    presets = list_presets()
    for preset in presets:
        preset["emotions"] = emotion_registry.supported()
    repository_status = voice_repository_manager.status()
    return {
        "default": default_voice_id(),
        "defaultVoiceId": default_voice_id(),
        "presets": presets,
        "voices": voice_registry.list_voices(),
        "availableVoices": repository_status["availableVoices"],
        "installedVoices": repository_status["installedVoices"],
        "datasets": voice_registry.datasets,
        "repositories": repository_status["repositories"],
        "syncState": repository_status["syncState"],
        "lastSync": repository_status["lastSync"],
        "missingAssets": repository_status["missingAssets"],
        "all_emotions": emotion_registry.supported(),
        "emotions": emotion_registry.public_contract(),
        "cosyvoice3": {
            "modelId": settings.COSYVOICE_MODEL_ID,
            "modelRevision": settings.COSYVOICE_MODEL_REVISION,
            "sourceRevision": settings.COSYVOICE_SOURCE_REVISION,
            "requiresTranscripts": True,
            "streamProtocolVersion": 1,
        },
    }


@router.get("/emotions", summary="Shared emotion manifest contract")
async def emotions():
    emotion_registry.reload()
    return emotion_registry.public_contract()


@router.get("/voices/status", summary="Voice repository sync and local asset status")
async def voices_status():
    return voice_repository_manager.status()


@router.post("/voices/sync", summary="Synchronize configured remote voice repositories")
async def voices_sync(request: VoiceSyncRequest = VoiceSyncRequest()):  # noqa: B008
    try:
        result = voice_repository_manager.sync(
            dataset=request.dataset,
            limit=request.limit,
            force=request.force,
        )
        voice_registry.reload()
        return result
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
