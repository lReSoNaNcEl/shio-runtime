"""Manifest-backed emotion registry for speech-side emotion contracts."""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class EmotionEntry:
    id: str
    display_name: str
    aliases: tuple[str, ...]
    markers: tuple[str, ...]
    speech: Dict[str, Any]

    def to_public_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "displayName": self.display_name,
            "aliases": list(self.aliases),
            "markers": list(self.markers),
            "speech": self.speech,
        }


class EmotionRegistry:
    """Loads and resolves the shared emotion manifest."""

    def __init__(self, manifest_path: str):
        self.manifest_path = Path(manifest_path).resolve()
        self.schema_version = 0
        self.default_emotion = "neutral"
        self._emotions: Dict[str, EmotionEntry] = {}
        self._aliases: Dict[str, str] = {}
        self._marker_patterns: list[tuple[re.Pattern[str], str]] = []
        self.reload()

    def reload(self) -> None:
        data = json.loads(self.manifest_path.read_text(encoding="utf-8"))
        self.schema_version = int(data.get("schemaVersion") or 1)
        self.default_emotion = self._normalize_key(str(data.get("defaultEmotion") or "neutral"))
        emotions: Dict[str, EmotionEntry] = {}
        aliases: Dict[str, str] = {}
        marker_patterns: list[tuple[re.Pattern[str], str]] = []

        for raw in data.get("emotions") or []:
            emotion_id = self._normalize_key(str(raw["id"]))
            if emotion_id in emotions:
                raise ValueError(f"Duplicate emotion id: {emotion_id}")
            entry = EmotionEntry(
                id=emotion_id,
                display_name=str(raw.get("displayName") or emotion_id),
                aliases=tuple(self._normalize_key(str(alias)) for alias in raw.get("aliases") or ()),
                markers=tuple(str(marker) for marker in raw.get("markers") or ()),
                speech=dict(raw.get("speech") or {}),
            )
            emotions[emotion_id] = entry
            aliases[emotion_id] = emotion_id
            for alias in entry.aliases:
                aliases[alias] = emotion_id
            for marker in entry.markers:
                marker_patterns.append((re.compile(re.escape(marker), re.IGNORECASE), emotion_id))

        if self.default_emotion not in emotions:
            raise ValueError(f"defaultEmotion '{self.default_emotion}' is not present in emotion manifest")

        # Legacy-compatible bracket/paren markers are data-driven from ids and aliases.
        known = sorted(aliases.keys(), key=len, reverse=True)
        if known:
            group = "|".join(re.escape(key).replace("_", r"[_ -]?") for key in known)
            dynamic = re.compile(rf"\s*[\[(]({group})[\])]\s*", re.IGNORECASE)
            marker_patterns.append((dynamic, "__dynamic__"))

        self._emotions = emotions
        self._aliases = aliases
        self._marker_patterns = marker_patterns
        logger.info("Loaded %s emotions from %s", len(self._emotions), self.manifest_path)

    def supported(self) -> List[str]:
        return list(self._emotions.keys())

    def normalize(self, emotion: Optional[str]) -> str:
        raw = self._normalize_key(emotion or self.default_emotion)
        resolved = self._aliases.get(raw)
        if resolved:
            return resolved
        if raw != self.default_emotion:
            logger.warning("Unknown emotion '%s', using '%s'", emotion, self.default_emotion)
        return self.default_emotion

    def extract_marker(self, text: str) -> Tuple[str, str]:
        for pattern, emotion_id in self._marker_patterns:
            match = pattern.search(text)
            if not match:
                continue
            resolved = self.normalize(match.group(1)) if emotion_id == "__dynamic__" else emotion_id
            cleaned = pattern.sub(" ", text, count=1).strip()
            cleaned = re.sub(r"\s+", " ", cleaned)
            return cleaned, resolved
        return text.strip(), self.default_emotion

    def is_supported(self, emotion: str) -> bool:
        return self.normalize(emotion) == self._normalize_key(emotion)

    def get(self, emotion: str) -> EmotionEntry:
        return self._emotions[self.normalize(emotion)]

    def public_contract(self) -> Dict[str, Any]:
        return {
            "schemaVersion": self.schema_version,
            "defaultEmotion": self.default_emotion,
            "supported": self.supported(),
            "emotions": [entry.to_public_dict() for entry in self._emotions.values()],
        }

    @staticmethod
    def _normalize_key(value: str) -> str:
        return value.lower().strip().replace(" ", "_").replace("-", "_")


class EmotionParser:
    """Parse and normalize emotions from text through EmotionRegistry."""

    def __init__(self, registry: EmotionRegistry):
        self.registry = registry

    def extract_emotion_from_text(self, text: str) -> Tuple[str, str]:
        return self.registry.extract_marker(text)

    def normalize_emotion(self, emotion: str) -> str:
        return self.registry.normalize(emotion)

    def is_valid_emotion(self, emotion: str) -> bool:
        return self.registry.is_supported(emotion)


class EmotionTranslator:
    """Translate LLM emotion tags to speech-side emotion styles."""

    def __init__(self, registry: EmotionRegistry):
        self.registry = registry
        self.parser = EmotionParser(registry)

    def process_text_and_emotion(self, text: str, emotion: Optional[str] = None) -> Tuple[str, str]:
        cleaned_text, resolved, _, _ = self.process_text_and_emotion_debug(text, emotion)
        return cleaned_text, resolved

    def process_text_and_emotion_debug(self, text: str, emotion: Optional[str] = None) -> Tuple[str, str, str, str]:
        cleaned_text, extracted_emotion = self.parser.extract_emotion_from_text(text)
        requested_emotion = self.parser.normalize_emotion(emotion or self.registry.default_emotion)
        resolved_emotion = requested_emotion if requested_emotion != self.registry.default_emotion else extracted_emotion
        logger.info(
            "Emotion resolved: requested=%s extracted=%s resolved=%s",
            requested_emotion,
            extracted_emotion,
            resolved_emotion,
        )
        return cleaned_text, resolved_emotion, requested_emotion, extracted_emotion


def create_emotion_config(registry: EmotionRegistry) -> Dict[str, Any]:
    return registry.public_contract()
