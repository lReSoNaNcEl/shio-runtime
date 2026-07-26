"""Download and verify revision-pinned model assets for the managed Speech Pack."""

from __future__ import annotations

import argparse
import json
import os
import shutil
from pathlib import Path

from huggingface_hub import hf_hub_download, snapshot_download

from app.config import settings


def model_root() -> Path:
    configured = settings.SHIO_MODEL_ROOT or os.environ.get("SHIO_MODEL_ROOT", "")
    if not configured:
        raise RuntimeError("SHIO_MODEL_ROOT must point to the persistent launcher model cache")
    return Path(configured).resolve()


def expected_paths(root: Path) -> list[Path]:
    asr = (
        root
        / "asr"
        / f"faster-whisper-{settings.WHISPER_MODEL.value}"
        / settings.WHISPER_MODEL_REVISION
    )
    f5 = root / "f5" / settings.F5_MODEL_REVISION
    vocoder = root / "vocoder" / settings.F5_VOCODER_REVISION
    accent = root / "ruaccent" / settings.RUACCENT_MODEL_REVISION
    return [
        root / "model-assets.json",
        asr / "config.json",
        asr / "model.bin",
        asr / "tokenizer.json",
        f5 / settings.F5_CKPT_SUBPATH,
        f5 / settings.F5_VOCAB_SUBPATH,
        vocoder / "config.yaml",
        vocoder / "pytorch_model.bin",
        accent / "dictionary",
        accent / "nn",
        accent / "koziev",
    ]


def verify(root: Path) -> None:
    missing = [str(path) for path in expected_paths(root) if not path.exists()]
    if missing:
        raise RuntimeError("Missing prefetched model assets: " + ", ".join(missing))


def prefetch(root: Path) -> None:
    asr_repo = f"Systran/faster-whisper-{settings.WHISPER_MODEL.value}"
    asr_target = root / "asr" / f"faster-whisper-{settings.WHISPER_MODEL.value}"
    asr_target /= settings.WHISPER_MODEL_REVISION
    snapshot_download(
        repo_id=asr_repo,
        revision=settings.WHISPER_MODEL_REVISION,
        local_dir=asr_target,
    )
    f5_target = root / "f5" / settings.F5_MODEL_REVISION
    for filename in (settings.F5_CKPT_SUBPATH, settings.F5_VOCAB_SUBPATH):
        downloaded = Path(
            hf_hub_download(
                repo_id=settings.F5_MODEL_ID,
                filename=filename,
                revision=settings.F5_MODEL_REVISION,
            )
        )
        destination = f5_target / filename
        destination.parent.mkdir(parents=True, exist_ok=True)
        if not destination.exists():
            shutil.copyfile(downloaded, destination)
    snapshot_download(
        repo_id="charactr/vocos-mel-24khz",
        revision=settings.F5_VOCODER_REVISION,
        local_dir=root / "vocoder" / settings.F5_VOCODER_REVISION,
        allow_patterns=["config.yaml", "pytorch_model.bin"],
    )
    snapshot_download(
        repo_id="ruaccent/accentuator",
        revision=settings.RUACCENT_MODEL_REVISION,
        local_dir=root / "ruaccent" / settings.RUACCENT_MODEL_REVISION,
    )
    state = {
        "schemaVersion": 1,
        "whisperRevision": settings.WHISPER_MODEL_REVISION,
        "f5Revision": settings.F5_MODEL_REVISION,
        "vocoderRevision": settings.F5_VOCODER_REVISION,
        "ruaccentRevision": settings.RUACCENT_MODEL_REVISION,
    }
    (root / "model-assets.json").write_text(json.dumps(state, indent=2), encoding="utf-8")
    verify(root)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="Verify without network access")
    args = parser.parse_args()
    root = model_root()
    if args.check:
        verify(root)
    else:
        root.mkdir(parents=True, exist_ok=True)
        prefetch(root)
    print("Model assets are ready.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
