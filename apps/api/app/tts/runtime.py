from app.tts.fish import FishS2ProEngine

_engine: FishS2ProEngine | None = None


def set_engine(engine: FishS2ProEngine | None) -> None:
    global _engine
    _engine = engine


def get_engine() -> FishS2ProEngine:
    if _engine is None:
        raise RuntimeError("Fish Audio S2 Pro engine is unavailable")
    return _engine


def engine_status() -> str:
    if _engine is None:
        return "unavailable"
    return "ready" if _engine.is_available() else "loading"
