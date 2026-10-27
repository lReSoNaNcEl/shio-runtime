"""Read-only alpha environment qualification checks."""

from __future__ import annotations

import importlib
import json
import os
import re
import sys
from pathlib import Path

SERVICE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVICE_ROOT))
EXPECTED_TORCH_VERSION = "2.11.0+cu128"
EXPECTED_CUDA_VERSION = "12.8"
COMMIT_SHA = re.compile(r"^[0-9a-f]{40}$")


def fail(message: str) -> None:
    raise RuntimeError(message)


def require_file(path: Path, label: str) -> None:
    if not path.is_file():
        fail(f"{label} is missing: {path}")


def expected_venv() -> Path:
    configured = os.environ.get("SHIO_API_VENV", "").strip()
    return Path(configured).resolve() if configured else (SERVICE_ROOT / ".venv").resolve()


def main() -> int:
    required_venv = expected_venv()
    if sys.version_info[:2] != (3, 12):
        fail(f"Python 3.12 is required; detected {sys.version.split()[0]}")
    if Path(sys.prefix).resolve() != required_venv:
        fail(f"Expected venv {required_venv}; selected {Path(sys.prefix).resolve()}")

    for module_name in (
        "faster_whisper",
        "silero_vad",
        "transformers",
        "hydra",
        "dac",
        "onnxruntime",
        "datasets",
        "pyarrow",
    ):
        importlib.import_module(module_name)

    import torch
    import torchaudio

    if torch.__version__ != EXPECTED_TORCH_VERSION:
        fail(f"torch must be {EXPECTED_TORCH_VERSION}; detected {torch.__version__}")
    if torchaudio.__version__ != EXPECTED_TORCH_VERSION:
        fail(f"torchaudio must be {EXPECTED_TORCH_VERSION}; detected {torchaudio.__version__}")
    if torch.version.cuda != EXPECTED_CUDA_VERSION:
        fail(f"torch CUDA must be {EXPECTED_CUDA_VERSION}; detected {torch.version.cuda}")
    if not torch.cuda.is_available():
        fail("torch.cuda.is_available() is false")
    gpu_name = torch.cuda.get_device_name(0)
    if not gpu_name.strip():
        fail("NVIDIA GPU name is empty")

    from app.config import settings
    from scripts.prefetch_models import model_root, verify

    host = settings.HOST.strip()
    if not host or any(character.isspace() for character in host):
        fail(f"Invalid API bind address: {settings.HOST!r}")
    if not 1 <= settings.PORT <= 65535:
        fail(f"Invalid API port: {settings.PORT}")
    verify(model_root())

    manifest_path = (SERVICE_ROOT / settings.VOICE_MANIFEST_PATH).resolve()
    emotion_path = (SERVICE_ROOT / settings.EMOTION_MANIFEST_PATH).resolve()
    status_path = (SERVICE_ROOT / settings.VOICE_REPOSITORY_STATUS_PATH).resolve()
    require_file(manifest_path, "voice_manifest.json")
    require_file(emotion_path, "emotion_manifest.json")
    require_file(status_path, "voice sync status")

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    datasets = {item["id"]: item for item in manifest.get("datasets", [])}
    dataset = datasets.get("AnimeVox")
    if not dataset:
        fail("AnimeVox dataset entry is missing from voice_manifest.json")
    manifest_revision = str(dataset.get("revision") or "")
    override_revision = settings.VOICE_DATASET_REVISION.strip()
    resolved_revision = override_revision or manifest_revision
    if not COMMIT_SHA.fullmatch(resolved_revision):
        fail("Resolved voice dataset revision must be an exact 40-character commit SHA")
    if resolved_revision.lower() in {"main", "master", "latest"}:
        fail("Voice dataset revision must not be main, master, or latest")

    status = json.loads(status_path.read_text(encoding="utf-8"))
    if status.get("resolvedRevision") != resolved_revision:
        fail(
            "Voice sync status revision does not match the resolved dataset revision: "
            f"{status.get('resolvedRevision')!r} != {resolved_revision!r}"
        )

    voices = {item["id"]: item for item in manifest.get("voices", [])}
    default_voice_id = manifest.get("defaultVoiceId")
    default_voice = voices.get(default_voice_id)
    if not default_voice:
        fail(f"Default voice is missing from manifest: {default_voice_id!r}")
    require_file(
        (manifest_path.parent / default_voice["referenceAudio"]).resolve(),
        "default voice reference.wav",
    )
    require_file(
        (manifest_path.parent / default_voice["referenceText"]).resolve(),
        "default voice reference.txt",
    )

    print(f"Python: {sys.version.split()[0]}")
    print(f"Environment: {required_venv}")
    print(f"PyTorch: {torch.__version__} (CUDA {torch.version.cuda})")
    print(f"NVIDIA GPU: {gpu_name}")
    print(f"API bind: {host}:{settings.PORT}")
    print(f"Voice dataset revision: {resolved_revision}")
    print("ALPHA ENVIRONMENT READY")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # noqa: BLE001 - doctor must report every qualification failure.
        print(f"STRICT DOCTOR FAILED: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc
