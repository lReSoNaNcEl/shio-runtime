import logging

from fastapi import APIRouter

from app.config import settings
from app.tts.runtime import engine_diagnostics, engine_status

logger = logging.getLogger(__name__)

router = APIRouter(tags=["health"])


class HealthState:
    """Store health status of components."""

    def __init__(self):
        self.asr_ready = False
        self.asr_error = None
        self.fish_ready = False
        self.fish_mode = "unavailable"
        self.fish_error = None
        self.device = "cuda"


health_state = HealthState()


@router.get("/health", summary="Service and engine status")
async def health_check():
    """Get health status of the service."""
    synthesis_status = engine_status()
    synthesis_ready = synthesis_status == "ready"
    overall_ready = health_state.asr_ready and synthesis_ready
    diagnostics = engine_diagnostics()
    if diagnostics["error"] is None:
        diagnostics["error"] = health_state.fish_error
    return {
        "status": "ok",
        "service": "speech-asr-fish-s2-pro",
        "serviceId": settings.SERVICE_ID,
        "contractVersion": settings.CONTRACT_VERSION,
        "speechPackVersion": settings.SPEECH_PACK_VERSION,
        "ready": overall_ready,
        "asr": {
            "status": "ready"
            if health_state.asr_ready
            else "failed"
            if health_state.asr_error
            else "loading",
            "ready": health_state.asr_ready,
            "model": settings.WHISPER_MODEL.value,
            "error": health_state.asr_error,
        },
        "synthesis": {
            "status": synthesis_status,
            "ready": synthesis_ready,
            "engine": "fish-s2-pro",
            "mode": health_state.fish_mode,
            "model": settings.FISH_MODEL_ID,
            "modelRevision": settings.FISH_MODEL_REVISION,
            "sourceRevision": settings.FISH_SOURCE_REVISION,
            "protocolVersion": 2,
            "streaming": True,
            "voiceCloning": True,
            **diagnostics,
        },
        "provider": health_state.device,
        "timestamp": None,
    }


def set_asr_ready(ready: bool):
    """Set ASR readiness status."""
    health_state.asr_ready = ready
    health_state.asr_error = None


def set_asr_failed(error: str):
    health_state.asr_ready = False
    health_state.asr_error = error[:100]


def set_engine_ready(engine: str, ready: bool, mode: str = "real", error: str | None = None):
    """Set real Fish Audio S2 Pro readiness; no alternate or mock engine exists."""
    if engine == "fish-s2-pro":
        health_state.fish_ready = ready
        health_state.fish_mode = mode
        health_state.fish_error = error


def get_health_state() -> HealthState:
    """Get current health state."""
    return health_state
