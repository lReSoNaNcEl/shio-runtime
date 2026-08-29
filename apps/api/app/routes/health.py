import logging

from fastapi import APIRouter

from app.config import settings

logger = logging.getLogger(__name__)

router = APIRouter(tags=["health"])


class HealthState:
    """Store health status of components."""

    def __init__(self):
        self.asr_ready = False
        self.cosyvoice_ready = False
        self.cosyvoice_mode = "unavailable"
        self.device = "cuda"


health_state = HealthState()


@router.get("/health", summary="Service and engine status")
async def health_check():
    """Get health status of the service."""
    overall_ready = health_state.asr_ready and health_state.cosyvoice_ready
    return {
        "status": "ok",
        "service": "speech-asr-cosyvoice3",
        "serviceId": settings.SERVICE_ID,
        "contractVersion": settings.CONTRACT_VERSION,
        "speechPackVersion": settings.SPEECH_PACK_VERSION,
        "ready": overall_ready,
        "asr": {
            "status": "ready" if health_state.asr_ready else "loading",
            "ready": health_state.asr_ready,
            "model": "whisper-medium",
        },
        "synthesis": {
            "status": "ready" if health_state.cosyvoice_ready else "unavailable",
            "ready": health_state.cosyvoice_ready,
            "engine": "cosyvoice3",
            "mode": health_state.cosyvoice_mode,
            "model": settings.COSYVOICE_MODEL_ID,
            "modelRevision": settings.COSYVOICE_MODEL_REVISION,
            "sourceRevision": settings.COSYVOICE_SOURCE_REVISION,
            "protocolVersion": 1,
            "streaming": True,
            "voiceCloning": True,
        },
        "provider": health_state.device,
        "timestamp": None,
    }


def set_asr_ready(ready: bool):
    """Set ASR readiness status."""
    health_state.asr_ready = ready


def set_engine_ready(engine: str, ready: bool, mode: str = "real"):
    """Set real CosyVoice 3 readiness; no alternate or mock engine exists."""
    if engine == "cosyvoice3":
        health_state.cosyvoice_ready = ready
        health_state.cosyvoice_mode = mode


def get_health_state() -> HealthState:
    """Get current health state."""
    return health_state
