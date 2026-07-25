"""Remote voice repository synchronization for manifest-backed voices."""

from __future__ import annotations

import hashlib
import io
import json
import logging
import os
import re
import tempfile
import threading
import time
from collections.abc import Iterable
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np

from app.config import settings

logger = logging.getLogger(__name__)

# Guards against two syncs writing the same manifest/voices concurrently. The
# threading lock covers concurrent requests inside one process (e.g. the FastAPI
# server); the lock file covers separate processes (e.g. the CLI running while the
# server also syncs).
_sync_thread_lock = threading.Lock()
_SYNC_LOCK_STALE_SECONDS = 3600.0


@contextmanager
def _single_flight_sync(lock_path: Path):
    """Allow only one voice sync at a time across threads and processes."""
    if not _sync_thread_lock.acquire(blocking=False):
        raise RuntimeError("A voice sync is already running in this process.")
    holds_file = False
    try:
        lock_path.parent.mkdir(parents=True, exist_ok=True)
        # Steal an obviously stale lock left behind by a crashed sync.
        try:
            if (
                lock_path.exists()
                and (time.time() - lock_path.stat().st_mtime) > _SYNC_LOCK_STALE_SECONDS
            ):
                lock_path.unlink()
        except OSError:
            pass
        try:
            fd = os.open(str(lock_path), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        except FileExistsError as exc:
            raise RuntimeError(
                "Another voice sync is in progress. Wait for it to finish, or remove "
                f"'{lock_path}' if it is stale."
            ) from exc
        holds_file = True
        try:
            os.write(fd, f"{os.getpid()} {time.time()}".encode())
        finally:
            os.close(fd)
        yield
    finally:
        if holds_file:
            try:
                lock_path.unlink()
            except OSError:
                pass
        _sync_thread_lock.release()


def _atomic_replace(tmp_path: Path, final_path: Path) -> None:
    """Atomically move a fully-written temp file onto its final path."""
    os.replace(str(tmp_path), str(final_path))


def _validate_wav_file(path: Path) -> None:
    """Fail if the downloaded WAV is empty or its header is truncated/corrupt."""
    if path.stat().st_size <= 44:  # WAV header alone is 44 bytes
        raise ValueError(f"downloaded audio is too small to be valid: {path}")
    import soundfile as sf

    info = sf.info(str(path))
    if info.frames <= 0:
        raise ValueError(f"downloaded audio has no frames: {path}")


DEFAULT_REPOSITORIES: list[dict[str, Any]] = [
    {
        "id": "AnimeVox",
        "label": "AnimeVox",
        "source": "https://huggingface.co/datasets/taresh18/AnimeVox",
        "provider": "huggingface",
        "repoId": "taresh18/AnimeVox",
        "repoType": "dataset",
        "language": "en",
        # The repository-owned default belongs to voice_manifest.json. This fallback
        # intentionally has no second revision value.
        "revision": None,
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


def _read_json(path: Path, fallback: dict[str, Any]) -> dict[str, Any]:
    if not path.exists():
        return dict(fallback)
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        logger.warning("Failed to read %s: %s", path, exc)
        return dict(fallback)


def _write_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    # Write to a sibling temp file, then atomically replace so a crash mid-write can
    # never leave a half-written manifest/status behind.
    fd, tmp_name = tempfile.mkstemp(dir=str(path.parent), prefix=path.name + ".", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp_name, str(path))
    except BaseException:
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        raise


def _slug(value: str) -> str:
    normalized = re.sub(r"[^0-9A-Za-zА-Яа-яЁё._-]+", "_", value.strip())
    normalized = re.sub(r"_+", "_", normalized).strip("._-")
    return normalized or "default"


def _voice_id(dataset: str, display_name: str) -> str:
    return f"{_slug(dataset).lower()}_{_slug(display_name).lower()}"


def _first_text(example: dict[str, Any]) -> str:
    for key in ("text", "transcript", "transcription", "sentence", "caption", "normalized_text"):
        value = example.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    for value in example.values():
        if isinstance(value, str) and 3 <= len(value.strip()) <= 500:
            return value.strip()
    return ""


def _first_name(example: dict[str, Any], fallback: str) -> str:
    for key in ("speaker", "speaker_name", "character", "character_name", "voice", "name", "actor"):
        value = example.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return fallback


def _first_audio(example: dict[str, Any]) -> dict[str, Any] | None:
    for value in example.values():
        if isinstance(value, dict) and ("array" in value or "bytes" in value or "path" in value):
            return value
    return None


def _audio_array(audio: dict[str, Any]) -> tuple[np.ndarray, int]:
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
        # Keep the service root lexical: resolving it can dereference a packaged
        # path or normalize only one side of a Windows 8.3 path comparison.
        self.manifest_path = Path(manifest_path).absolute()
        self.root_dir = self.manifest_path.parent
        self.status_path = Path(status_path).absolute()

    def repositories(self) -> list[dict[str, Any]]:
        manifest = _read_json(self.manifest_path, {"datasets": []})
        datasets = manifest.get("datasets") or []
        merged = {repo["id"]: dict(repo) for repo in DEFAULT_REPOSITORIES}
        for dataset in datasets:
            if "id" in dataset:
                merged[str(dataset["id"])] = {**merged.get(str(dataset["id"]), {}), **dataset}
        return list(merged.values())

    def status(self) -> dict[str, Any]:
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
            voices.append(
                {
                    "id": raw.get("id"),
                    "voiceId": raw.get("id"),
                    "displayName": raw.get("displayName") or raw.get("label") or raw.get("id"),
                    "dataset": raw.get("dataset"),
                    "installed": not missing,
                    "available": not missing,
                    "missingAssets": missing,
                }
            )
        return {
            "repositories": self.repositories(),
            "syncState": cached.get("syncState") or "never_synced",
            "lastSync": cached.get("lastSync"),
            "lastError": cached.get("lastError"),
            "resolvedRevision": cached.get("resolvedRevision"),
            "availableVoices": cached.get("availableVoices") or [],
            "installedVoices": voices,
            "missingAssets": missing_assets,
        }

    def reconcile_local_assets(self) -> dict[str, Any]:
        """Register already downloaded voice assets in the manifest."""
        manifest = _read_json(self.manifest_path, {"version": 1, "datasets": [], "voices": []})
        datasets = {
            str(item.get("id")): item for item in manifest.get("datasets") or [] if item.get("id")
        }
        voices = {
            str(item.get("id")): item for item in manifest.get("voices") or [] if item.get("id")
        }
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
                "revision": repo.get("revision"),
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
        default_available = bool(
            default_voice
            and self._resolve(default_voice.get("referenceAudio", "")).exists()
            and self._resolve(default_voice.get("referenceText", "")).exists()
        )
        if not default_available:
            for voice_id, raw in voices.items():
                if (
                    self._resolve(raw.get("referenceAudio", "")).exists()
                    and self._resolve(raw.get("referenceText", "")).exists()
                ):
                    manifest["defaultVoiceId"] = voice_id
                    changed = True
                    break

        if changed:
            manifest["datasets"] = list(datasets.values())
            manifest["voices"] = list(voices.values())
            _write_json(self.manifest_path, manifest)
        return manifest

    def sync(
        self, dataset: str | None = None, limit: int | None = None, force: bool = False
    ) -> dict[str, Any]:
        # Single-flight: refuse to run two syncs at once (CLI + server, or two
        # requests), which would race on the same manifest and voice files.
        with _single_flight_sync(self.root_dir / ".voice_sync.lock"):
            return self._sync_locked(dataset=dataset, limit=limit, force=force)

    def _sync_locked(
        self, dataset: str | None = None, limit: int | None = None, force: bool = False
    ) -> dict[str, Any]:
        selected = self._repository(dataset)
        if selected.get("id") != "AnimeVox":
            raise ValueError(f"Unsupported voice repository: {selected.get('id')}")

        max_voices = settings.VOICE_SYNC_MAX_VOICES if limit is None else limit
        result: dict[str, Any] = {
            "dataset": selected["id"],
            "repository": selected,
            "syncState": "running",
            "limit": max_voices,
            "installed": [],
            "cached": [],
            "skipped": [],
            "errors": [],
            "resolvedRevision": self._resolved_revision(selected),
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
            result["installed"] = [
                self._public_import(item) for item in imported if item.installed and not item.cached
            ]
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

    def _local_imported(self, repo: dict[str, Any]) -> list[ImportedVoice]:
        dataset_dir = self.root_dir / "voices" / str(repo["id"])
        if not dataset_dir.exists():
            return []
        imported: list[ImportedVoice] = []
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
            text_hash = str(
                cache.get("textHash") or hashlib.sha256(text.encode("utf-8")).hexdigest()
            )
            imported.append(
                ImportedVoice(
                    voice_id=_voice_id(str(repo["id"]), display_name),
                    display_name=display_name,
                    dataset=str(repo["id"]),
                    language=str(repo.get("language") or "unknown"),
                    audio_path=audio_path,
                    text_path=text_path,
                    installed=True,
                    cached=True,
                    text_hash=text_hash,
                )
            )
        return imported

    def _sync_huggingface_dataset(
        self, repo: dict[str, Any], limit: int, force: bool
    ) -> list[ImportedVoice]:
        if limit == 0:
            return []
        try:
            from datasets import Audio, load_dataset
        except Exception as exc:
            raise RuntimeError(
                "Install the 'datasets' package to sync remote voice repositories"
            ) from exc

        token = settings.HF_TOKEN or None
        revision = self._resolved_revision(repo)
        logger.info("Syncing voices from %s (revision=%s)", repo["repoId"], revision or "default")
        stream = load_dataset(
            repo["repoId"],
            split="train",
            streaming=True,
            token=token,
            revision=revision,
        )
        audio_columns = [
            name
            for name, feature in getattr(stream, "features", {}).items()
            if feature.__class__.__name__ == "Audio"
        ]
        for audio_column in audio_columns:
            stream = stream.cast_column(audio_column, Audio(decode=False))

        imported: list[ImportedVoice] = []
        seen: set[str] = set()
        fallback_index = 1
        for example in stream:
            display_name = _first_name(
                example, "AnimeVox Default" if not seen else f"AnimeVox Voice {fallback_index}"
            )
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
            raise RuntimeError(
                "No importable voice samples were found in the remote dataset stream"
            )
        return imported

    def _install_voice(
        self,
        repo: dict[str, Any],
        voice_id: str,
        display_name: str,
        audio: dict[str, Any],
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

            # Write both assets to temp files first, validate the audio, then promote
            # them atomically. The transcript (checked for availability) is promoted
            # only after a valid WAV is in place, and the cache marker is written last,
            # so an interrupted sync can never yield a half-written "available" voice.
            audio_tmp = voice_dir / (audio_path.name + ".tmp")
            text_tmp = voice_dir / (text_path.name + ".tmp")
            try:
                audio_tmp.write_bytes(save_wav(data, sample_rate))
                _validate_wav_file(audio_tmp)
                text_tmp.write_text(text.strip() + "\n", encoding="utf-8")
                _atomic_replace(audio_tmp, audio_path)
                _atomic_replace(text_tmp, text_path)
            finally:
                for leftover in (audio_tmp, text_tmp):
                    try:
                        leftover.unlink()
                    except OSError:
                        pass
            _write_json(
                cache_path,
                {
                    "dataset": repo["id"],
                    "repoId": repo.get("repoId"),
                    "displayName": display_name,
                    "textHash": text_hash,
                    "updatedAt": time.time(),
                },
            )
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

    def _merge_manifest(self, repo: dict[str, Any], imported: Iterable[ImportedVoice]) -> None:
        manifest = _read_json(self.manifest_path, {"version": 1, "datasets": [], "voices": []})
        datasets = {
            str(item.get("id")): item for item in manifest.get("datasets") or [] if item.get("id")
        }
        datasets[repo["id"]] = {
            "id": repo["id"],
            "label": repo.get("label") or repo["id"],
            "source": repo.get("source"),
            "provider": repo.get("provider"),
            "repoId": repo.get("repoId"),
            "revision": repo.get("revision"),
        }
        voices = {
            str(item.get("id")): item for item in manifest.get("voices") or [] if item.get("id")
        }
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
        default_available = bool(
            default_voice
            and self._resolve(default_voice.get("referenceAudio", "")).exists()
            and self._resolve(default_voice.get("referenceText", "")).exists()
        )
        if not default_available:
            for item in imported:
                if item.installed:
                    manifest["defaultVoiceId"] = item.voice_id
                    break
            else:
                if not manifest.get("defaultVoiceId") and voices:
                    manifest["defaultVoiceId"] = next(iter(voices.keys()))
        _write_json(self.manifest_path, manifest)

    def _repository(self, dataset: str | None) -> dict[str, Any]:
        repositories = self.repositories()
        if not dataset:
            return repositories[0]
        for repo in repositories:
            if repo.get("id") == dataset:
                return repo
        raise ValueError(f"Unknown voice repository: {dataset}")

    @staticmethod
    def _resolved_revision(repo: dict[str, Any]) -> str | None:
        return settings.VOICE_DATASET_REVISION.strip() or repo.get("revision") or None

    def _resolve(self, value: str) -> Path:
        path = Path(value)
        if path.is_absolute():
            return path
        return (self.root_dir / path).resolve()

    def _relative(self, path: Path) -> str:
        # Keep the manifest path relative to the service root without resolving
        # directory junctions. The Windows launcher intentionally maps
        # services/api/voices to the persistent application data directory; a
        # full resolve would escape root_dir and make relative_to() fail.
        absolute_path = path.absolute()
        try:
            return absolute_path.relative_to(self.root_dir).as_posix()
        except ValueError:
            # Absolute paths remain supported for explicitly external assets.
            return absolute_path.as_posix()

    def _save_status(self, status: dict[str, Any]) -> None:
        _write_json(self.status_path, status)

    def _public_import(self, item: ImportedVoice) -> dict[str, Any]:
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
