import asyncio
import hashlib
import logging
import time
from collections import OrderedDict
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.audio import apply_pitch_shift, save_wav
from app.config import settings
from app.tts import EmotionRegistry, EmotionTranslator, SynthesisResult
from app.tts.audio_boundaries import AudioBoundaryMetrics, process_audio_boundaries
from app.tts.f5_local import F5LocalEngine
from app.tts.voice_repository_manager import voice_repository_manager
from app.tts.voices import default_voice_id, list_presets, voice_registry

logger = logging.getLogger(__name__)

router = APIRouter(tags=["tts"])


class SynthesizeRequest(BaseModel):
    """Request for F5-TTS synthesis."""

    text: str
    language: str = Field(default="en", description="Language code: en or ru")
    emotion: str | None = Field(
        default=None, description="Emotion/tag preset, e.g. happy, sigh, gasp, angry"
    )
    voiceId: str | None = Field(default=None, description="Logical voice ID from /voices")
    voice: str | None = Field(default=None, description="Deprecated alias for voiceId")
    speed: float = Field(default=1.0, ge=0.5, le=2.0, description="F5 generation speed")
    pitch: float = Field(
        default=0.0, ge=-12.0, le=12.0, description="Post-process pitch shift in semitones"
    )
    engine: str | None = Field(default=None, description="Only f5 is supported")
    utteranceKind: Literal["normal", "technical", "nonverbal", "short-interjection"] = Field(
        default="normal",
        description="Optional conservative final-boundary profile hint",
    )


class VoiceSyncRequest(BaseModel):
    """Remote voice repository sync request."""

    dataset: str | None = Field(default=None, description="Dataset/repository id, e.g. AnimeVox")
    limit: int | None = Field(
        default=None, ge=0, le=200, description="Max voices to import during this sync"
    )
    force: bool = Field(
        default=False, description="Rewrite local reference assets even if cache is valid"
    )


class VoiceWarmupRequest(BaseModel):
    engine: str = Field(default="f5", description="Only f5 is supported")
    voiceId: str | None = Field(default=None, description="Logical voice ID from /voices")
    language: str = Field(default="ru", pattern="^(ru|en)$")


_f5_engine: F5LocalEngine | None = None
emotion_registry = EmotionRegistry(settings.EMOTION_MANIFEST_PATH)
_emotion_translator: EmotionTranslator | None = EmotionTranslator(emotion_registry)
_tts_cache: "OrderedDict[str, tuple[bytes, dict[str, str]]]" = OrderedDict()
TTS_CACHE_MAX_ITEMS = 128
TTS_CACHE_MAX_TEXT_LENGTH = 120
TTS_CACHE_VERSION = "f5-v3-speech-polish"
_warmup_tasks: dict[tuple[str, str, str], asyncio.Task] = {}
_warmup_status: dict[tuple[str, str, str], dict[str, str | float]] = {}
_warmup_gate = asyncio.Semaphore(1)
MAX_PENDING_VOICE_WARMUPS = 8


def _has_speakable_content(text: str) -> bool:
    return any(character.isalnum() for character in text)


def init_engines(f5_engine: F5LocalEngine | None):
    """Initialize the TTS engine."""
    global _f5_engine, _emotion_translator
    _f5_engine = f5_engine
    _warmup_tasks.clear()
    _warmup_status.clear()
    emotion_registry.reload()
    _emotion_translator = EmotionTranslator(emotion_registry)


def _engine_by_name(name: str):
    name = (name or "f5").lower()
    if name != "f5":
        raise HTTPException(status_code=400, detail=f"Unknown engine: {name}; only f5 is available")
    if _f5_engine is None or not _f5_engine.is_available():
        raise HTTPException(status_code=503, detail="f5 engine not available")
    return _f5_engine


def _resolve_emotion(text: str, emotion: str | None):
    emotion = emotion or emotion_registry.default_emotion
    if _emotion_translator:
        return _emotion_translator.process_text_and_emotion_debug(text, emotion)
    cleaned_text, extracted_emotion = emotion_registry.extract_marker(text)
    requested_emotion = emotion_registry.normalize(emotion)
    resolved_emotion = (
        requested_emotion
        if requested_emotion != emotion_registry.default_emotion
        else extracted_emotion
    )
    return cleaned_text, resolved_emotion, requested_emotion, extracted_emotion


def _cache_key(request: SynthesizeRequest, text: str, emotion: str) -> str:
    voice_id = request.voiceId or request.voice or default_voice_id()
    raw = "|".join(
        [
            text.strip(),
            request.language,
            emotion,
            voice_id,
            str(request.speed),
            str(request.pitch),
            "f5",
            request.utteranceKind,
            TTS_CACHE_VERSION,
        ]
    )
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _cache_enabled_for(text: str) -> bool:
    return 0 < len(text.strip()) <= TTS_CACHE_MAX_TEXT_LENGTH


def _cache_get(key: str) -> tuple[bytes, dict[str, str]] | None:
    item = _tts_cache.get(key)
    if item is None:
        return None
    _tts_cache.move_to_end(key)
    return item


def _cache_set(key: str, audio_bytes: bytes, headers: dict[str, str]) -> None:
    _tts_cache[key] = (audio_bytes, dict(headers))
    _tts_cache.move_to_end(key)
    while len(_tts_cache) > TTS_CACHE_MAX_ITEMS:
        _tts_cache.popitem(last=False)


def _synthesis_result_to_response(result: SynthesisResult) -> bytes:
    return save_wav(result.audio, result.sample_rate)


def _apply_pitch(result: SynthesisResult, semitones: float) -> SynthesisResult:
    if semitones:
        result.audio = apply_pitch_shift(result.audio, result.sample_rate, semitones)
        result.duration_sec = len(result.audio) / result.sample_rate
    return result


def _apply_audio_boundaries(
    result: SynthesisResult, request: SynthesizeRequest, emotion: str
) -> tuple[SynthesisResult, AudioBoundaryMetrics]:
    result.audio, metrics = process_audio_boundaries(
        result.audio,
        result.sample_rate,
        utterance_kind=request.utteranceKind,
        emotion=emotion,
    )
    result.duration_sec = len(result.audio) / result.sample_rate
    return result, metrics


def _boundary_headers(metrics: AudioBoundaryMetrics) -> dict[str, str]:
    return {
        "X-Audio-Boundary-Profile": metrics.profile,
        "X-Audio-Leading-Silence-Ms": str(metrics.detected_leading_silence_ms),
        "X-Audio-Trailing-Silence-Ms": str(metrics.detected_trailing_silence_ms),
        "X-Audio-Trimmed-Leading-Ms": str(metrics.trimmed_leading_ms),
        "X-Audio-Trimmed-Trailing-Ms": str(metrics.trimmed_trailing_ms),
        "X-Audio-Fade-In-Ms": str(metrics.fade_in_ms),
        "X-Audio-Fade-Out-Ms": str(metrics.fade_out_ms),
        "X-Audio-Postprocess-Ms": str(metrics.postprocess_latency_ms),
    }


def _request_voice_id(request: SynthesizeRequest) -> str:
    requested = request.voiceId or request.voice or default_voice_id()
    try:
        entry = voice_registry.get(requested)
        if entry.is_available():
            return requested
        logger.warning(
            "Requested voiceId '%s' has no local reference assets; using default voice.", requested
        )
    except KeyError:
        logger.warning("Requested unknown voiceId '%s'; using default voice.", requested)
    return default_voice_id()


def _resolve_voice_id(requested: str | None) -> str:
    voice_id = requested or default_voice_id()
    try:
        entry = voice_registry.get(voice_id)
        if not entry.is_available():
            raise ValueError(f"Voice '{voice_id}' has no local reference assets")
    except KeyError as exc:
        raise ValueError(f"Unknown voiceId: {voice_id}") from exc
    return voice_id


async def _run_voice_warmup(
    key: tuple[str, str, str], engine: F5LocalEngine
) -> dict[str, str | float]:
    _, voice_id, language = key
    started = time.perf_counter()
    _warmup_status[key] = {
        "state": "warming",
        "engine": "f5",
        "voiceId": voice_id,
        "language": language,
    }
    try:
        async with _warmup_gate:
            phrase = "Короткая проверка голоса." if language == "ru" else "Short voice check."
            await asyncio.to_thread(
                engine.synthesize,
                text=phrase,
                language=language,
                emotion="neutral",
                voice=voice_id,
            )
        latency_ms = (time.perf_counter() - started) * 1000
        result: dict[str, str | float] = {
            "state": "ready",
            "engine": "f5",
            "voiceId": voice_id,
            "language": language,
            "latencyMs": round(latency_ms, 1),
        }
        _warmup_status[key] = result
        logger.info(
            "Voice warmup ready: engine=f5 voiceId=%s language=%s latencyMs=%.1f",
            voice_id,
            language,
            latency_ms,
        )
        return result
    except Exception as exc:
        result = {
            "state": "failed",
            "engine": "f5",
            "voiceId": voice_id,
            "language": language,
            "error": str(exc),
        }
        _warmup_status[key] = result
        logger.warning(
            "Voice warmup failed: engine=f5 voiceId=%s language=%s error=%s",
            voice_id,
            language,
            exc,
        )
        return result


@router.post("/tts/warmup", summary="Prepare a selected F5 voice and language")
async def warmup_voice(request: VoiceWarmupRequest):
    engine = _engine_by_name(request.engine)
    try:
        voice_id = _resolve_voice_id(request.voiceId)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    key = ("f5", voice_id, request.language)
    if _warmup_status.get(key, {}).get("state") == "ready":
        return _warmup_status[key]
    task = _warmup_tasks.get(key)
    if task is None or task.done():
        pending = sum(not candidate.done() for candidate in _warmup_tasks.values())
        if pending >= MAX_PENDING_VOICE_WARMUPS:
            raise HTTPException(status_code=429, detail="Voice warmup queue is full")
        task = asyncio.create_task(_run_voice_warmup(key, engine))
        _warmup_tasks[key] = task
    return await task


@router.get("/tts/warmup", summary="Selected voice warmup status")
async def warmup_status(engine: str = "f5", voiceId: str | None = None, language: str = "ru"):
    voice_id = _resolve_voice_id(voiceId)
    key = (engine, voice_id, language)
    return _warmup_status.get(
        key,
        {"state": "idle", "engine": engine, "voiceId": voice_id, "language": language},
    )


@router.get("/voices", summary="List F5 voices, available references and emotion contract")
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
        "f5": {
            "voice_manifest": str(voice_registry.manifest_path),
            "requires_transcripts": True,
            "nfe_step": settings.F5_NFE_STEP,
            "cfg_strength": settings.F5_CFG_STRENGTH,
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
async def voices_sync(request: VoiceSyncRequest = VoiceSyncRequest()):  # noqa: B008 - FastAPI optional-body default; changing it alters the API contract
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


@router.post(
    "/synthesize",
    summary="Synthesize speech with F5-TTS",
    responses={
        200: {
            "content": {"audio/wav": {}},
            "description": "WAV audio plus synthesis, duration, cache and optional audio-boundary telemetry headers",
        }
    },
)
async def synthesize(request: SynthesizeRequest):
    """
    F5-TTS synthesis.

    Emotion tags can be sent as a field (`emotion: "happy"`) or inline in text:
    `[laugh]`, `[sigh]`, `[gasp]`, `[groan]`, `[angry]`, `[happy]`, `[crying]`,
    `[fear]`, `[surprised]`, `[whisper]`.
    """
    if not _has_speakable_content(request.text.strip()):
        raise HTTPException(
            status_code=422,
            detail={"code": "no_speakable_text", "message": "Text contains no speakable content"},
        )

    engine = _engine_by_name(request.engine or settings.TTS_DEFAULT_ENGINE.value)
    try:
        text, emotion, requested_emotion, text_emotion = _resolve_emotion(
            request.text, request.emotion
        )
        if not _has_speakable_content(text):
            raise HTTPException(
                status_code=422,
                detail={
                    "code": "no_speakable_text",
                    "message": "Text contains no speakable content",
                },
            )
        cache_key = _cache_key(request, text, emotion)
        cacheable = _cache_enabled_for(text)

        from fastapi.responses import Response

        if cacheable:
            cached = _cache_get(cache_key)
            if cached:
                started = time.perf_counter()
                audio_bytes, cached_headers = cached
                headers = dict(cached_headers)
                headers["X-Cache"] = "HIT"
                headers["X-Generated-Latency-Ms"] = cached_headers.get(
                    "X-Generated-Latency-Ms", cached_headers.get("X-Latency-Ms", "")
                )
                headers["X-Latency-Ms"] = str((time.perf_counter() - started) * 1000)
                logger.info(
                    "TTS cache hit: textChars=%d audioBytes=%d profile=%s",
                    len(text),
                    len(audio_bytes),
                    headers.get("X-Audio-Boundary-Profile", "none"),
                )
                return Response(content=audio_bytes, media_type="audio/wav", headers=headers)

        voice_id = _request_voice_id(request)

        warmup_task = _warmup_tasks.get(("f5", voice_id, request.language))
        if warmup_task is not None and not warmup_task.done():
            await warmup_task
        result = await asyncio.to_thread(
            engine.synthesize,
            text=text,
            language=request.language,
            emotion=emotion,
            voice=voice_id,
            speed=request.speed,
        )
        result = _apply_pitch(result, request.pitch)
        result, boundary_metrics = _apply_audio_boundaries(result, request, emotion)
        audio_bytes = _synthesis_result_to_response(result)
        logger.info(
            "Synthesis emotion metadata: requested=%s text=%s resolved=%s",
            requested_emotion,
            text_emotion,
            emotion,
        )
        headers = {
            "X-Engine": result.engine,
            "X-Language": result.language,
            "X-Emotion": result.emotion,
            "X-Requested-Emotion": requested_emotion,
            "X-Text-Emotion": text_emotion,
            "X-Voice-Id": voice_id,
            "X-Latency-Ms": str(result.latency_ms),
            "X-Generated-Latency-Ms": str(result.latency_ms),
            "X-RTF": str(result.rtf),
            "X-Duration-Sec": str(result.duration_sec),
            "X-Cache": "MISS" if cacheable else "SKIP",
            **_boundary_headers(boundary_metrics),
        }
        logger.info(
            "Speech audio boundary processed: profile=%s inputMs=%.1f outputMs=%.1f "
            "leadingMs=%.1f trailingMs=%.1f trimLeadingMs=%.1f trimTrailingMs=%.1f "
            "fadeInMs=%.1f fadeOutMs=%.1f postprocessMs=%.2f bypass=%s",
            boundary_metrics.profile,
            boundary_metrics.input_duration_ms,
            boundary_metrics.output_duration_ms,
            boundary_metrics.detected_leading_silence_ms,
            boundary_metrics.detected_trailing_silence_ms,
            boundary_metrics.trimmed_leading_ms,
            boundary_metrics.trimmed_trailing_ms,
            boundary_metrics.fade_in_ms,
            boundary_metrics.fade_out_ms,
            boundary_metrics.postprocess_latency_ms,
            boundary_metrics.bypass_reason or "none",
        )
        if cacheable:
            _cache_set(cache_key, audio_bytes, headers)

        return Response(content=audio_bytes, media_type="audio/wav", headers=headers)
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Synthesis error: %s", e)
        raise HTTPException(status_code=500, detail=str(e)) from e
