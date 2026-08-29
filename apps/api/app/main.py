import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.asr import SileroVAD, WhisperASR
from app.config import settings
from app.routes import health, recognize, tts, tts_stream, ws
from app.tts.cosyvoice import CosyVoiceEngine
from app.tts.runtime import set_engine

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
    model_name = settings.WHISPER_MODEL.value
    if settings.SHIO_MODEL_ROOT:
        model_name = str(
            Path(settings.SHIO_MODEL_ROOT)
            / "asr"
            / f"faster-whisper-{settings.WHISPER_MODEL.value}"
            / settings.WHISPER_MODEL_REVISION
        )
    whisper = WhisperASR(
        model_size=model_name,
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
    """Initialize the one real CosyVoice 3 engine."""
    logger.info("Initializing CosyVoice 3...")
    engine = None
    try:
        engine = CosyVoiceEngine(
            device=settings.DEVICE,
            model_id=settings.COSYVOICE_MODEL_ID,
            model_revision=settings.COSYVOICE_MODEL_REVISION,
            source_revision=settings.COSYVOICE_SOURCE_REVISION,
            matcha_revision=settings.COSYVOICE_MATCHA_REVISION,
            model_root=settings.SHIO_MODEL_ROOT,
            source_path=settings.COSYVOICE_SOURCE_PATH,
            model_path=settings.COSYVOICE_MODEL_PATH,
            sample_rate=settings.COSYVOICE_SAMPLE_RATE,
        )
        if settings.WARMUP_ON_STARTUP:
            engine.warmup()
        health.set_engine_ready("cosyvoice3", True, "real")
        logger.info("CosyVoice 3 loaded")
    except Exception as e:
        logger.error("Failed to load CosyVoice 3: %s", e)
        engine = None
        health.set_engine_ready("cosyvoice3", False, "unavailable")

    set_engine(engine)
    if engine is None:
        logger.warning("No TTS engines available")
    return engine


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting up application...")
    try:
        _asr_instances["whisper"], _asr_instances["vad"] = await init_asr()
        _tts_engines["cosyvoice3"] = await init_tts_engines()
        logger.info("Application startup completed")
    except Exception as e:
        logger.error("Startup failed: %s", e)
        raise

    yield

    logger.info("Application shutdown completed")


API_DESCRIPTION = """
Local ASR + CosyVoice 3 service for Russian and English.

* **ASR**: faster-whisper + streaming Silero VAD, WAV fallback and continuous PCM WebSocket.
* **Streaming protocol**: connect to `/ws/asr` (`/ws` compatibility alias). The
  Swagger-visible [`GET /asr/stream-protocol`](/asr/stream-protocol) endpoint
  publishes the versioned control messages, binary audio contract, server event
  types, VAD tuning and resource-safety invariants because OpenAPI does not model
  WebSocket operations directly.
* **TTS**: CosyVoice 3 bi-streaming text-in/audio-out over `/tts/stream`, with
  logical voice IDs resolved through `voice_manifest.json` and matching transcripts.
* **Emotion tags**: loaded from `emotion_manifest.json` through Emotion Registry.
* **Emotion contract**: `/emotions` exposes the shared speech-side emotion contract.

Swagger UI: `/docs`, ReDoc: `/redoc`, schema: `/openapi.json`.
"""

TAGS_METADATA = [
    {
        "name": "asr",
        "description": "Speech recognition: WAV upload (`/recognize`) and continuous PCM WebSocket (`/ws/asr`, `/ws` alias).",
    },
    {
        "name": "tts",
        "description": "CosyVoice 3 streaming synthesis, voices, and emotion metadata.",
    },
    {"name": "health", "description": "Service and engine status."},
]

app = FastAPI(
    title="Speech ASR + CosyVoice 3",
    description=API_DESCRIPTION,
    version="3.1.0",
    lifespan=lifespan,
    openapi_tags=TAGS_METADATA,
    contact={"name": "Resonance", "url": "https://t.me/IReSoNaNcEI"},
    license_info={"name": "Check CosyVoice model/package license before commercial use"},
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
app.include_router(tts.router)
app.include_router(tts_stream.router)


@app.get("/", include_in_schema=False)
async def root():
    from fastapi.responses import FileResponse

    index_path = Path(__file__).parent.parent / "web" / "index.html"
    if index_path.exists():
        return FileResponse(str(index_path))
    return {"message": "Welcome to Speech ASR + CosyVoice 3 Service"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host=settings.HOST,
        port=settings.PORT,
        reload=settings.RELOAD,
        log_level="info",
    )
