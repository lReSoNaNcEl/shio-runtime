"""Manifest-backed local voice-reference registry."""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import shutil
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

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
    future_emotion_profiles: dict[str, Any] = field(default_factory=dict)
    emotion_profiles: dict[str, Any] = field(default_factory=dict)
    styles: dict[str, Any] = field(default_factory=dict)
    supported_emotions: tuple[str, ...] = ()
    remote: dict[str, Any] = field(default_factory=dict)

    def is_available(self) -> bool:
        return self.reference_audio.exists() and self.reference_text.exists()

    def transcript(self) -> str | None:
        if not self.reference_text.exists():
            return None
        return self.reference_text.read_text(encoding="utf-8").strip()

    def to_public_dict(self) -> dict[str, Any]:
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
        self.datasets: list[dict[str, Any]] = []
        self._voices: dict[str, VoiceEntry] = {}
        self.reload()

    def reload(self) -> None:
        data = json.loads(self.manifest_path.read_text(encoding="utf-8"))
        self.default_voice_id = str(data.get("defaultVoiceId") or "")
        self.datasets = list(data.get("datasets") or [])
        voices: dict[str, VoiceEntry] = {}

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
                supported_emotions=tuple(
                    str(emotion) for emotion in raw.get("supportedEmotions") or ()
                ),
                remote=dict(raw.get("remote") or {}),
            )

        if not self.default_voice_id and voices:
            self.default_voice_id = next(iter(voices.keys()))
        if self.default_voice_id not in voices:
            raise ValueError(
                f"defaultVoiceId '{self.default_voice_id}' is not present in voice manifest"
            )

        self._voices = voices
        logger.info("Loaded %s voices from %s", len(self._voices), self.manifest_path)

    def default_voice(self) -> VoiceEntry:
        return self.get(self.default_voice_id)

    def get(self, voice_id: str | None) -> VoiceEntry:
        key = voice_id or self.default_voice_id
        entry = self._voices.get(key)
        if entry is None:
            raise KeyError(f"Unknown voiceId: {key}")
        return entry

    def list_voices(self) -> list[dict[str, Any]]:
        return [entry.to_public_dict() for entry in self._voices.values()]

    def resolve_reference(self, voice_id: str | None) -> tuple[str, str, VoiceEntry] | None:
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

    def condition_reference(
        self,
        voice_id: str | None,
        *,
        model_revision: str,
        cache_root: str,
    ) -> tuple[str, str, VoiceEntry, bool] | None:
        """Materialize stable byte-identical reference assets for one model revision."""
        resolved = self.resolve_reference(voice_id)
        if resolved is None:
            return None
        source_audio, transcript, entry = resolved
        if not re.fullmatch(r"[A-Za-z0-9._-]{1,128}", entry.id):
            raise ValueError(f"Voice id is unsafe for the managed cache: {entry.id}")
        source_text = entry.reference_text
        identity = {
            "voiceId": entry.id,
            "audioSha256": _sha256(entry.reference_audio),
            "transcriptSha256": _sha256(source_text),
            "modelRevision": model_revision,
        }
        identity_key = hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()
        target = Path(cache_root).resolve() / "voices" / entry.id / "fish-s2-pro" / identity_key
        audio_target = target / "reference.wav"
        text_target = target / "reference.txt"
        metadata_target = target / "conditioning.json"
        if _cache_matches(metadata_target, identity, audio_target, text_target):
            return str(audio_target), transcript, entry, True

        target.parent.mkdir(parents=True, exist_ok=True)
        staging = Path(tempfile.mkdtemp(prefix=".conditioning-", dir=target.parent))
        try:
            shutil.copyfile(source_audio, staging / "reference.wav")
            shutil.copyfile(source_text, staging / "reference.txt")
            (staging / "conditioning.json").write_text(
                json.dumps(identity, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
            if target.exists():
                shutil.rmtree(target)
            os.replace(staging, target)
        finally:
            if staging.exists():
                shutil.rmtree(staging, ignore_errors=True)
        return str(audio_target), transcript, entry, False

    def _resolve_path(self, value: str) -> Path:
        path = Path(value)
        if path.is_absolute():
            return path
        return (self.root_dir / path).resolve()


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _cache_matches(
    metadata_path: Path,
    identity: dict[str, str],
    audio_path: Path,
    text_path: Path,
) -> bool:
    if not metadata_path.is_file() or not audio_path.is_file() or not text_path.is_file():
        return False
    try:
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return False
    return (
        metadata == identity
        and _sha256(audio_path) == identity["audioSha256"]
        and _sha256(text_path) == identity["transcriptSha256"]
    )
