from app.tts.cosyvoice import CosyVoiceEngine

_engine: CosyVoiceEngine | None = None


def set_engine(engine: CosyVoiceEngine | None) -> None:
    global _engine
    _engine = engine


def get_engine() -> CosyVoiceEngine:
    if _engine is None or not _engine.is_available():
        raise RuntimeError("CosyVoice 3 engine is unavailable")
    return _engine
