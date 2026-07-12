"""Remote voice repository synchronization for manifest-backed voices."""

from __future__ import annotations

import hashlib
import io
import json
import logging
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

import numpy as np

from app.config import settings

logger = logging.getLogger(__name__)


DEFAULT_REPOSITORIES: List[Dict[str, Any]] = [
    {
        "id": "AnimeVox",
        "label": "AnimeVox",
        "source": "https://huggingface.co/datasets/taresh18/AnimeVox",
        "provider": "huggingface",
        "repoId": "taresh18/AnimeVox",
        "repoType": "dataset",
        "language": "en",
    }
]


@dataclass(frozen=True)
class ImportedVoice:
    voice_id: str
    display_name: str
    dataset: str
    language: str
    audio_path: Path
    text_path: Path
    installed: bool
    cached: bool
    text_hash: str


def _read_json(path: Path, fallback: Dict[str, Any]) -> Dict[str, Any]:
    if not path.exists():
        return dict(fallback)
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        logger.warning("Failed to read %s: %s", path, exc)
        return dict(fallback)


def _write_json(path: Path, data: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _slug(value: str) -> str:
    normalized = re.sub(r"[^0-9A-Za-zА-Яа-яЁё._-]+", "_", value.strip())
    normalized = re.sub(r"_+", "_", normalized).strip("._-")
    return normalized or "default"


def _voice_id(dataset: str, display_name: str) -> str:
    return f"{_slug(dataset).lower()}_{_slug(display_name).lower()}"


def _first_text(example: Dict[str, Any]) -> str:
    for key in ("text", "transcript", "transcription", "sentence", "caption", "normalized_text"):
        value = example.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    for value in example.values():
        if isinstance(value, str) and 3 <= len(value.strip()) <= 500:
            return value.strip()
    return ""


def _first_name(example: Dict[str, Any], fallback: str) -> str:
    for key in ("speaker", "speaker_name", "character", "character_name", "voice", "name", "actor"):
        value = example.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return fallback


def _first_audio(example: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    for value in example.values():
        if isinstance(value, dict) and ("array" in value or "bytes" in value or "path" in value):
            return value
    return None


def _audio_array(audio: Dict[str, Any]) -> tuple[np.ndarray, int]:
    if "array" in audio and audio["array"] is not None:
        data = np.asarray(audio["array"], dtype=np.float32)
        sample_rate = int(audio.get("sampling_rate") or 24000)
        if data.ndim > 1:
            data = data.mean(axis=1)
        return data, sample_rate
    if audio.get("bytes"):
        import soundfile as sf

        data, sample_rate = sf.read(io.BytesIO(audio["bytes"]), dtype="float32")
        if data.ndim > 1:
            data = data.mean(axis=1)
        return np.asarray(data, dtype=np.float32), int(sample_rate)
    if audio.get("path"):
        import soundfile as sf

        data, sample_rate = sf.read(audio["path"], dtype="float32")
        if data.ndim > 1:
            data = data.mean(axis=1)
        return np.asarray(data, dtype=np.float32), int(sample_rate)
    raise ValueError("streamed dataset example does not contain decoded audio array")


class VoiceRepositoryManager:
    """Synchronizes remote voice datasets into local manifest entries."""

    def __init__(self, manifest_path: str, status_path: str):
        self.manifest_path = Path(manifest_path).resolve()
        self.root_dir = self.manifest_path.parent
        self.status_path = Path(status_path).resolve()

    def repositories(self) -> List[Dict[str, Any]]:
        manifest = _read_json(self.manifest_path, {"datasets": []})
        datasets = manifest.get("datasets") or []
        merged = {repo["id"]: dict(repo) for repo in DEFAULT_REPOSITORIES}
        for dataset in datasets:
            if "id" in dataset:
                merged[str(dataset["id"])] = {**merged.get(str(dataset["id"]), {}), **dataset}
        return list(merged.values())

    def status(self) -> Dict[str, Any]:
        self.reconcile_local_assets()
        manifest = _read_json(self.manifest_path, {"voices": [], "datasets": []})
        cached = _read_json(self.status_path, {})
        voices = []
        missing_assets = []
        for raw in manifest.get("voices") or []:
            audio = self._resolve(raw.get("referenceAudio", ""))
            text = self._resolve(raw.get("referenceText", ""))
            missing = []
            if not audio.exists():
                missing.append(str(audio))
            if not text.exists():
                missing.append(str(text))
            if missing:
                missing_assets.append({"voiceId": raw.get("id"), "missingAssets": missing})
            voices.append({
                "id": raw.get("id"),
                "voiceId": raw.get("id"),
                "displayName": raw.get("displayName") or raw.get("label") or raw.get("id"),
                "dataset": raw.get("dataset"),
                "installed": not missing,
                "available": not missing,
                "missingAssets": missing,
            })
        return {
            "repositories": self.repositories(),
            "syncState": cached.get("syncState") or "never_synced",
            "lastSync": cached.get("lastSync"),
            "lastError": cached.get("lastError"),
            "availableVoices": cached.get("availableVoices") or [],
            "installedVoices": voices,
            "missingAssets": missing_assets,
        }

    def reconcile_local_assets(self) -> Dict[str, Any]:
        """Register already downloaded voice assets in the manifest."""
        manifest = _read_json(self.manifest_path, {"version": 1, "datasets": [], "voices": []})
        datasets = {str(item.get("id")): item for item in manifest.get("datasets") or [] if item.get("id")}
        voices = {str(item.get("id")): item for item in manifest.get("voices") or [] if item.get("id")}
        changed = False

        for repo in self.repositories():
            dataset_id = str(repo["id"])
            dataset_dir = self.root_dir / "voices" / dataset_id
            if not dataset_dir.exists():
                continue
            datasets[dataset_id] = {
                "id": dataset_id,
                "label": repo.get("label") or dataset_id,
                "source": repo.get("source"),
                "provider": repo.get("provider"),
                "repoId": repo.get("repoId"),
            }
            for voice_dir in dataset_dir.iterdir():
                if not voice_dir.is_dir():
                    continue
                audio_path = voice_dir / "reference.wav"
                text_path = voice_dir / "reference.txt"
                if not audio_path.exists() or not text_path.exists():
                    continue
                cache = _read_json(voice_dir / ".voice_cache.json", {})
                display_name = str(cache.get("displayName") or voice_dir.name.replace("_", " "))
                voice_id = _voice_id(dataset_id, display_name)
                if voice_id in voices:
                    continue
                voices[voice_id] = {
                    "id": voice_id,
                    "label": display_name,
                    "displayName": display_name,
                    "dataset": dataset_id,
                    "referenceAudio": self._relative(audio_path),
                    "referenceText": self._relative(text_path),
                    "language": str(repo.get("language") or "unknown"),
                    "gender": "unknown",
                    "tags": ["animevox", "remote"],
                    "behaviorTags": [],
                    "futureEmotionProfiles": {},
                    "emotionProfiles": {},
                    "styles": {},
                    "supportedEmotions": [],
                    "remote": {
                        "provider": repo.get("provider"),
                        "repoId": repo.get("repoId"),
                        "source": repo.get("source"),
                        "textHash": cache.get("textHash"),
                    },
                }
                changed = True

        default_voice_id = str(manifest.get("defaultVoiceId") or "")
        default_voice = voices.get(default_voice_id)
        default_available = bool(default_voice and self._resolve(default_voice.get("referenceAudio", "")).exists() and self._resolve(default_voice.get("referenceText", "")).exists())
        if not default_available:
            for voice_id, raw in voices.items():
                if self._resolve(raw.get("referenceAudio", "")).exists() and self._resolve(raw.get("referenceText", "")).exists():
                    manifest["defaultVoiceId"] = voice_id
                    changed = True
                    break

        if changed:
            manifest["datasets"] = list(datasets.values())
            manifest["voices"] = list(voices.values())
            _write_json(self.manifest_path, manifest)
        return manifest

    def sync(self, dataset: Optional[str] = None, limit: Optional[int] = None, force: bool = False) -> Dict[str, Any]:
        selected = self._repository(dataset)
        if selected.get("id") != "AnimeVox":
            raise ValueError(f"Unsupported voice repository: {selected.get('id')}")

        max_voices = settings.VOICE_SYNC_MAX_VOICES if limit is None else limit
        result: Dict[str, Any] = {
            "dataset": selected["id"],
            "repository": selected,
            "syncState": "running",
            "limit": max_voices,
            "installed": [],
            "cached": [],
            "skipped": [],
            "errors": [],
        }
        self._save_status({**self.status(), **result, "lastSync": time.time()})

        try:
            local_imported = self._local_imported(selected)
            if len(local_imported) >= max_voices:
                imported = local_imported[:max_voices]
                result["installed"] = []
                result["cached"] = [self._public_import(item) for item in imported]
                result["availableVoices"] = [self._public_import(item) for item in imported]
                self._merge_manifest(selected, imported)
                result["syncState"] = "idle"
                result["lastSync"] = time.time()
                self._save_status({**self.status(), **result, "lastError": None})
                return result

            imported = self._sync_huggingface_dataset(selected, max_voices, force)
            result["installed"] = [self._public_import(item) for item in imported if item.installed and not item.cached]
            result["cached"] = [self._public_import(item) for item in imported if item.cached]
            result["availableVoices"] = [self._public_import(item) for item in imported]
            self._merge_manifest(selected, imported)
            result["syncState"] = "idle"
            result["lastSync"] = time.time()
            self._save_status({**self.status(), **result, "lastError": None})
            return result
        except Exception as exc:
            logger.exception("Voice repository sync failed")
            result["syncState"] = "error"
            result["lastError"] = str(exc)
            result["errors"].append(str(exc))
            self._save_status({**self.status(), **result, "lastSync": time.time()})
            raise

    def _local_imported(self, repo: Dict[str, Any]) -> List[ImportedVoice]:
        dataset_dir = self.root_dir / "voices" / str(repo["id"])
        if not dataset_dir.exists():
            return []
        imported: List[ImportedVoice] = []
        for voice_dir in sorted(dataset_dir.iterdir(), key=lambda item: item.name.lower()):
            if not voice_dir.is_dir():
                continue
            audio_path = voice_dir / "reference.wav"
            text_path = voice_dir / "reference.txt"
            if not audio_path.exists() or not text_path.exists():
                continue
            cache = _read_json(voice_dir / ".voice_cache.json", {})
            display_name = str(cache.get("displayName") or voice_dir.name.replace("_", " "))
            text = text_path.read_text(encoding="utf-8").strip()
            text_hash = str(cache.get("textHash") or hashlib.sha256(text.encode("utf-8")).hexdigest())
            imported.append(ImportedVoice(
                voice_id=_voice_id(str(repo["id"]), display_name),
                display_name=display_name,
                dataset=str(repo["id"]),
                language=str(repo.get("language") or "unknown"),
                audio_path=audio_path,
                text_path=text_path,
                installed=True,
                cached=True,
                text_hash=text_hash,
            ))
        return imported

    def _sync_huggingface_dataset(self, repo: Dict[str, Any], limit: int, force: bool) -> List[ImportedVoice]:
        if limit == 0:
            return []
        try:
            from datasets import Audio, load_dataset
        except Exception as exc:
            raise RuntimeError("Install the 'datasets' package to sync remote voice repositories") from exc

        token = settings.HF_TOKEN or None
        stream = load_dataset(
            repo["repoId"],
            split="train",
            streaming=True,
            token=token,
        )
        audio_columns = [name for name, feature in getattr(stream, "features", {}).items() if feature.__class__.__name__ == "Audio"]
        for audio_column in audio_columns:
            stream = stream.cast_column(audio_column, Audio(decode=False))

        imported: List[ImportedVoice] = []
        seen: set[str] = set()
        fallback_index = 1
        for example in stream:
            display_name = _first_name(example, "AnimeVox Default" if not seen else f"AnimeVox Voice {fallback_index}")
            voice_id = _voice_id(repo["id"], display_name)
            if voice_id in seen:
                continue
            audio = _first_audio(example)
            text = _first_text(example)
            if audio is None or not text:
                fallback_index += 1
                continue
            seen.add(voice_id)
            imported.append(self._install_voice(repo, voice_id, display_name, audio, text, force))
            fallback_index += 1
            if len(imported) >= limit:
                break
        if not imported:
            raise RuntimeError("No importable voice samples were found in the remote dataset stream")
        return imported

    def _install_voice(
        self,
        repo: Dict[str, Any],
        voice_id: str,
        display_name: str,
        audio: Dict[str, Any],
        text: str,
        force: bool,
    ) -> ImportedVoice:
        voice_dir = self.root_dir / "voices" / repo["id"] / _slug(display_name)
        audio_path = voice_dir / "reference.wav"
        text_path = voice_dir / "reference.txt"
        cache_path = voice_dir / ".voice_cache.json"
        text_hash = hashlib.sha256(text.encode("utf-8")).hexdigest()
        cache = _read_json(cache_path, {})
        cached = (
            not force
            and audio_path.exists()
            and text_path.exists()
            and text_path.read_text(encoding="utf-8").strip()
            and cache.get("textHash") == text_hash
        )
        if not cached:
            data, sample_rate = _audio_array(audio)
            voice_dir.mkdir(parents=True, exist_ok=True)
            from app.audio import save_wav

            audio_path.write_bytes(save_wav(data, sample_rate))
            text_path.write_text(text.strip() + "\n", encoding="utf-8")
            _write_json(cache_path, {
                "dataset": repo["id"],
                "repoId": repo.get("repoId"),
                "displayName": display_name,
                "textHash": text_hash,
                "updatedAt": time.time(),
            })
        return ImportedVoice(
            voice_id=voice_id,
            display_name=display_name,
            dataset=repo["id"],
            language=str(repo.get("language") or "unknown"),
            audio_path=audio_path,
            text_path=text_path,
            installed=True,
            cached=bool(cached),
            text_hash=text_hash,
        )

    def _merge_manifest(self, repo: Dict[str, Any], imported: Iterable[ImportedVoice]) -> None:
        manifest = _read_json(self.manifest_path, {"version": 1, "datasets": [], "voices": []})
        datasets = {str(item.get("id")): item for item in manifest.get("datasets") or [] if item.get("id")}
        datasets[repo["id"]] = {
            "id": repo["id"],
            "label": repo.get("label") or repo["id"],
            "source": repo.get("source"),
            "provider": repo.get("provider"),
            "repoId": repo.get("repoId"),
        }
        voices = {str(item.get("id")): item for item in manifest.get("voices") or [] if item.get("id")}
        for item in imported:
            voices[item.voice_id] = {
                "id": item.voice_id,
                "label": item.display_name,
                "displayName": item.display_name,
                "dataset": item.dataset,
                "referenceAudio": self._relative(item.audio_path),
                "referenceText": self._relative(item.text_path),
                "language": item.language,
                "gender": "unknown",
                "tags": ["animevox", "remote"],
                "behaviorTags": [],
                "futureEmotionProfiles": {},
                "emotionProfiles": {},
                "styles": {},
                "supportedEmotions": [],
                "remote": {
                    "provider": repo.get("provider"),
                    "repoId": repo.get("repoId"),
                    "source": repo.get("source"),
                    "textHash": item.text_hash,
                },
            }
        manifest["datasets"] = list(datasets.values())
        manifest["voices"] = list(voices.values())
        default_voice_id = str(manifest.get("defaultVoiceId") or "")
        default_voice = voices.get(default_voice_id)
        default_available = bool(default_voice and self._resolve(default_voice.get("referenceAudio", "")).exists() and self._resolve(default_voice.get("referenceText", "")).exists())
        if not default_available:
            for item in imported:
                if item.installed:
                    manifest["defaultVoiceId"] = item.voice_id
                    break
            else:
                if not manifest.get("defaultVoiceId") and voices:
                    manifest["defaultVoiceId"] = next(iter(voices.keys()))
        _write_json(self.manifest_path, manifest)

    def _repository(self, dataset: Optional[str]) -> Dict[str, Any]:
        repositories = self.repositories()
        if not dataset:
            return repositories[0]
        for repo in repositories:
            if repo.get("id") == dataset:
                return repo
        raise ValueError(f"Unknown voice repository: {dataset}")

    def _resolve(self, value: str) -> Path:
        path = Path(value)
        if path.is_absolute():
            return path
        return (self.root_dir / path).resolve()

    def _relative(self, path: Path) -> str:
        return path.resolve().relative_to(self.root_dir).as_posix()

    def _save_status(self, status: Dict[str, Any]) -> None:
        _write_json(self.status_path, status)

    def _public_import(self, item: ImportedVoice) -> Dict[str, Any]:
        return {
            "id": item.voice_id,
            "voiceId": item.voice_id,
            "displayName": item.display_name,
            "dataset": item.dataset,
            "language": item.language,
            "installed": item.installed,
            "available": item.installed,
            "cached": item.cached,
        }


voice_repository_manager = VoiceRepositoryManager(
    settings.VOICE_MANIFEST_PATH,
    settings.VOICE_REPOSITORY_STATUS_PATH,
)
