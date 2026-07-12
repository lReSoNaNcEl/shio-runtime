"""Manifest-backed voice registry for F5 reference audio."""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class VoiceEntry:
    id: str
    label: str
    dataset: str
    reference_audio: Path
    reference_text: Path
    language: str = "unknown"
    gender: str = "unknown"
    tags: tuple[str, ...] = ()
    behavior_tags: tuple[str, ...] = ()
    future_emotion_profiles: Dict[str, Any] = field(default_factory=dict)
    emotion_profiles: Dict[str, Any] = field(default_factory=dict)
    styles: Dict[str, Any] = field(default_factory=dict)
    supported_emotions: tuple[str, ...] = ()
    remote: Dict[str, Any] = field(default_factory=dict)

    def is_available(self) -> bool:
        return self.reference_audio.exists() and self.reference_text.exists()

    def transcript(self) -> Optional[str]:
        if not self.reference_text.exists():
            return None
        return self.reference_text.read_text(encoding="utf-8").strip()

    def to_public_dict(self) -> Dict[str, Any]:
        missing_assets = []
        if not self.reference_audio.exists():
            missing_assets.append(str(self.reference_audio))
        if not self.reference_text.exists():
            missing_assets.append(str(self.reference_text))
        available = self.is_available()
        return {
            "id": self.id,
            "voiceId": self.id,
            "key": self.id,
            "label": self.label,
            "displayName": self.label,
            "dataset": self.dataset,
            "language": self.language,
            "gender": self.gender,
            "tags": list(self.tags),
            "behaviorTags": list(self.behavior_tags),
            "futureEmotionProfiles": self.future_emotion_profiles,
            "emotionProfiles": self.emotion_profiles,
            "styles": self.styles,
            "supportedEmotions": list(self.supported_emotions),
            "available": available,
            "installed": available,
            "missingAssets": missing_assets,
            "referenceAudio": str(self.reference_audio),
            "referenceText": str(self.reference_text),
            "remote": self.remote,
        }


class VoiceRegistry:
    def __init__(self, manifest_path: str):
        self.manifest_path = Path(manifest_path).resolve()
        self.root_dir = self.manifest_path.parent
        self.default_voice_id = ""
        self.datasets: List[Dict[str, Any]] = []
        self._voices: Dict[str, VoiceEntry] = {}
        self.reload()

    def reload(self) -> None:
        data = json.loads(self.manifest_path.read_text(encoding="utf-8"))
        self.default_voice_id = str(data.get("defaultVoiceId") or "")
        self.datasets = list(data.get("datasets") or [])
        voices: Dict[str, VoiceEntry] = {}

        for raw in data.get("voices") or []:
            voice_id = str(raw["id"])
            voices[voice_id] = VoiceEntry(
                id=voice_id,
                label=str(raw.get("displayName") or raw.get("label") or voice_id),
                dataset=str(raw.get("dataset") or "Custom"),
                reference_audio=self._resolve_path(str(raw["referenceAudio"])),
                reference_text=self._resolve_path(str(raw["referenceText"])),
                language=str(raw.get("language") or "unknown"),
                gender=str(raw.get("gender") or "unknown"),
                tags=tuple(str(tag) for tag in raw.get("tags") or ()),
                behavior_tags=tuple(str(tag) for tag in raw.get("behaviorTags") or ()),
                future_emotion_profiles=dict(raw.get("futureEmotionProfiles") or {}),
                emotion_profiles=dict(raw.get("emotionProfiles") or {}),
                styles=dict(raw.get("styles") or {}),
                supported_emotions=tuple(str(emotion) for emotion in raw.get("supportedEmotions") or ()),
                remote=dict(raw.get("remote") or {}),
            )

        if not self.default_voice_id and voices:
            self.default_voice_id = next(iter(voices.keys()))
        if self.default_voice_id not in voices:
            raise ValueError(f"defaultVoiceId '{self.default_voice_id}' is not present in voice manifest")

        self._voices = voices
        logger.info("Loaded %s voices from %s", len(self._voices), self.manifest_path)

    def default_voice(self) -> VoiceEntry:
        return self.get(self.default_voice_id)

    def get(self, voice_id: Optional[str]) -> VoiceEntry:
        key = voice_id or self.default_voice_id
        entry = self._voices.get(key)
        if entry is None:
            raise KeyError(f"Unknown voiceId: {key}")
        return entry

    def list_voices(self) -> List[Dict[str, Any]]:
        return [entry.to_public_dict() for entry in self._voices.values()]

    def resolve_reference(self, voice_id: Optional[str]) -> Optional[Tuple[str, str, VoiceEntry]]:
        entry = self.get(voice_id)
        transcript = entry.transcript()
        if not entry.reference_audio.exists() or not transcript:
            logger.warning(
                "Voice '%s' reference is unavailable: audio=%s transcript=%s",
                entry.id,
                entry.reference_audio,
                entry.reference_text,
            )
            return None
        return str(entry.reference_audio), transcript, entry

    def _resolve_path(self, value: str) -> Path:
        path = Path(value)
        if path.is_absolute():
            return path
        return (self.root_dir / path).resolve()
