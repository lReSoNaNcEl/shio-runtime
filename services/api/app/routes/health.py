import logging

from fastapi import APIRouter

from app.config import settings

logger = logging.getLogger(__name__)

router = APIRouter(tags=["health"])


class HealthState:
    """Store health status of components."""

    def __init__(self):
        self.asr_ready = False
        self.f5_ready = False
        self.f5_mode = "unavailable"
        self.device = "cuda"


health_state = HealthState()


@router.get("/health", summary="Service and engine status")
async def health_check():
    """Get health status of the service."""
    overall_ready = (
        health_state.asr_ready and health_state.f5_ready and health_state.f5_mode == "real"
    )
    return {
        "status": "ok",
        "service": "speech-asr-f5-tts",
        "serviceId": settings.SERVICE_ID,
        "contractVersion": settings.CONTRACT_VERSION,
        "speechPackVersion": settings.SPEECH_PACK_VERSION,
        "ready": overall_ready,
        "asr": {
            "status": "ready" if health_state.asr_ready else "loading",
            "ready": health_state.asr_ready,
            "model": "whisper-medium",
        },
        "engines": {
            "f5": {
                "status": "ready" if health_state.f5_ready else "not-connected",
                "ready": health_state.f5_ready,
                "mode": health_state.f5_mode,
            }
        },
        "provider": health_state.device,
        "timestamp": None,
    }


def set_asr_ready(ready: bool):
    """Set ASR readiness status."""
    health_state.asr_ready = ready


def set_engine_ready(engine: str, ready: bool, mode: str = "mock"):
    """Set TTS engine readiness status and mode ('real' or 'mock')."""
    if engine == "f5":
        health_state.f5_ready = ready
        health_state.f5_mode = mode


def get_health_state() -> HealthState:
    """Get current health state."""
    return health_state
