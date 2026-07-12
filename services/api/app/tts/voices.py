"""Shared Voice Registry instance used by TTS routes and engines."""

from app.config import settings

from .voice_registry import VoiceRegistry

voice_registry = VoiceRegistry(settings.VOICE_MANIFEST_PATH)


def default_voice_id() -> str:
    """Return the current manifest default voice id."""
    return voice_registry.default_voice_id


def list_presets() -> list:
    """Legacy-shaped [{key, label}] list backed by logical voice IDs."""
    return [
        {
            "key": voice["voiceId"],
            "voiceId": voice["voiceId"],
            "label": voice["label"],
            "dataset": voice["dataset"],
            "available": voice["available"],
        }
        for voice in voice_registry.list_voices()
    ]


def resolve_reference(voice_id: str | None):
    return voice_registry.resolve_reference(voice_id)
