import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.asr import SileroVAD, WhisperASR
from app.config import settings
from app.routes import health, recognize, synthesize, ws
from app.tts import F5LocalEngine

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

_asr_instances = {}
_tts_engines = {}


async def init_asr():
    """Initialize ASR components."""
    logger.info("Initializing ASR components...")
    whisper = WhisperASR(
        model_size=settings.WHISPER_MODEL.value,
        device=settings.DEVICE,
        compute_type=settings.WHISPER_COMPUTE_TYPE,
        language=settings.ASR_LANGUAGE.value if settings.ASR_LANGUAGE.value != "auto" else None,
    )
    vad = SileroVAD(sample_rate=16000)
    if settings.WARMUP_ON_STARTUP:
        logger.info("Warming up ASR models...")
        whisper.warmup()

    recognize.init_asr(whisper, vad)
    ws.init_asr(whisper, vad)
    health.set_asr_ready(True)
    logger.info("ASR initialization completed")
    return whisper, vad


async def init_tts_engines():
    """Initialize F5-TTS locally."""
    logger.info("Initializing F5-TTS...")
    f5_engine = None
    try:
        f5_engine = F5LocalEngine(
            device=settings.DEVICE,
            model_id=settings.F5_MODEL_ID,
            ckpt_subpath=settings.F5_CKPT_SUBPATH,
            vocab_subpath=settings.F5_VOCAB_SUBPATH,
            use_accent=settings.F5_USE_ACCENT,
            nfe_step=settings.F5_NFE_STEP,
            cfg_strength=settings.F5_CFG_STRENGTH,
            force_duration=settings.F5_TTS_FORCE_DURATION,
            max_chunk_chars=settings.F5_CHUNK_MAX_CHARS,
            max_chunk_seconds=settings.F5_CHUNK_MAX_SECONDS,
            chunk_crossfade_ms=settings.F5_CHUNK_CROSSFADE_MS,
            tail_validation=settings.F5_TAIL_VALIDATION,
            target_rms_db=settings.F5_TARGET_RMS_DB,
        )
        if settings.WARMUP_ON_STARTUP:
            f5_engine.warmup()
        mode = "real" if f5_engine.model is not None else "mock"
        health.set_engine_ready("f5", True, mode)
        logger.info("F5-TTS loaded (%s)", mode)
    except Exception as e:
        logger.error("Failed to load F5-TTS: %s", e)

    synthesize.init_engines(f5_engine)
    if f5_engine is None:
        logger.warning("No TTS engines available")
    return f5_engine


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting up application...")
    try:
        _asr_instances["whisper"], _asr_instances["vad"] = await init_asr()
        _tts_engines["f5"] = await init_tts_engines()
        logger.info("Application startup completed")
    except Exception as e:
        logger.error("Startup failed: %s", e)
        raise

    yield

    logger.info("Application shutdown completed")


API_DESCRIPTION = """
Local ASR + F5-TTS service for Russian and English.

* **ASR**: faster-whisper + streaming Silero VAD, WAV fallback and continuous PCM WebSocket.
* **Streaming protocol**: connect to `/ws/asr` (`/ws` compatibility alias). The
  Swagger-visible [`GET /asr/stream-protocol`](/asr/stream-protocol) endpoint
  publishes the versioned control messages, binary audio contract, server event
  types, VAD tuning and resource-safety invariants because OpenAPI does not model
  WebSocket operations directly.
* **TTS**: F5-TTS with logical voice IDs resolved through `voice_manifest.json`
  plus matching transcript files (`.wav.txt` or `.txt`).
* **Emotion tags**: loaded from `emotion_manifest.json` through Emotion Registry.
* **Emotion contract**: `/emotions` exposes the shared speech-side emotion contract.

Swagger UI: `/docs`, ReDoc: `/redoc`, schema: `/openapi.json`.
"""

TAGS_METADATA = [
    {
        "name": "asr",
        "description": "Speech recognition: WAV upload (`/recognize`) and continuous PCM WebSocket (`/ws/asr`, `/ws` alias).",
    },
    {"name": "tts", "description": "F5-TTS: synthesis, voices, and emotion metadata."},
    {"name": "health", "description": "Service and engine status."},
]

app = FastAPI(
    title="Speech ASR + F5-TTS",
    description=API_DESCRIPTION,
    version="3.1.0",
    lifespan=lifespan,
    openapi_tags=TAGS_METADATA,
    contact={"name": "Resonance", "url": "https://t.me/IReSoNaNcEI"},
    license_info={"name": "Check F5-TTS model/package license before commercial use"},
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

web_dir = Path(__file__).parent.parent / "web"
if web_dir.exists():
    app.mount("/static", StaticFiles(directory=str(web_dir)), name="static")
    logger.info("Static files mounted from %s", web_dir)

app.include_router(health.router)
app.include_router(recognize.router)
app.include_router(ws.router)
app.include_router(synthesize.router)


@app.get("/", include_in_schema=False)
async def root():
    from fastapi.responses import FileResponse

    index_path = Path(__file__).parent.parent / "web" / "index.html"
    if index_path.exists():
        return FileResponse(str(index_path))
    return {"message": "Welcome to Speech ASR + F5-TTS Service"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host=settings.HOST,
        port=settings.PORT,
        reload=settings.RELOAD,
        log_level="info",
    )
