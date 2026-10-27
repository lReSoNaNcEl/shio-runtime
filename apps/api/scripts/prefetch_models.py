"""Prepare exact Fish S2 Pro / ASR revisions before conversation starts."""

from __future__ import annotations

import argparse
import json
import shutil
import sys
import tempfile
import urllib.request
import zipfile
from pathlib import Path

SERVICE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVICE_ROOT))

from app.config import settings  # noqa: E402


def model_root() -> Path:
    return Path(settings.SHIO_MODEL_ROOT).resolve()


def expected_paths(root: Path) -> list[Path]:
    asr = (
        root
        / "asr"
        / f"faster-whisper-{settings.WHISPER_MODEL.value}"
        / settings.WHISPER_MODEL_REVISION
    )
    source = root / "fish" / "source" / settings.FISH_SOURCE_REVISION
    model = root / "fish" / "model" / settings.FISH_MODEL_REVISION
    return [
        asr / "model.bin",
        asr / "config.json",
        asr / "tokenizer.json",
        source / "fish_speech" / "models" / "text2semantic" / "inference.py",
        source / "fish_speech" / "configs" / "modded_dac_vq.yaml",
        source / ".project-root",
        source / "LICENSE",
        model / "codec.pth",
        model / "config.json",
        model / "tokenizer.json",
        model / "model.safetensors.index.json",
        model / "model-00001-of-00002.safetensors",
        model / "model-00002-of-00002.safetensors",
    ]


def verify(root: Path) -> None:
    missing = [
        str(path.relative_to(root))
        for path in expected_paths(root)
        if not path.is_file() or (path.name != ".project-root" and path.stat().st_size == 0)
    ]
    if missing:
        raise RuntimeError("Missing pinned speech assets: " + ", ".join(missing))
    model = root / "fish" / "model" / settings.FISH_MODEL_REVISION
    index = json.loads((model / "model.safetensors.index.json").read_text(encoding="utf-8"))
    for shard in set(index["weight_map"].values()):
        if Path(shard).name != shard or not (model / shard).is_file():
            raise RuntimeError("Invalid or missing model shard")


def download_source(root: Path) -> None:
    target = root / "fish" / "source" / settings.FISH_SOURCE_REVISION
    if (target / "fish_speech" / "models" / "text2semantic" / "inference.py").is_file():
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".fish-source-", dir=target.parent) as temporary:
        staging = Path(temporary)
        archive = staging / "source.zip"
        request = urllib.request.Request(
            f"https://codeload.github.com/fishaudio/fish-speech/zip/{settings.FISH_SOURCE_REVISION}",
            headers={"User-Agent": "Shio-Speech-Prefetch"},
        )
        with urllib.request.urlopen(request, timeout=120) as response:  # noqa: S310
            archive.write_bytes(response.read())
        extracted = staging / "source"
        with zipfile.ZipFile(archive) as bundle:
            for member in bundle.infolist():
                destination = (extracted / member.filename).resolve()
                if not destination.is_relative_to(extracted.resolve()):
                    raise RuntimeError("Unsafe Fish source archive path")
            bundle.extractall(extracted)
        candidates = list(extracted.iterdir())
        if len(candidates) != 1 or not (candidates[0] / "fish_speech").is_dir():
            raise RuntimeError("Unexpected Fish source archive")
        # Rename only the validated staging tree; never clean unrelated model families.
        shutil.move(str(candidates[0]), str(target))


def prefetch(root: Path) -> None:
    from huggingface_hub import snapshot_download

    root.mkdir(parents=True, exist_ok=True)
    snapshot_download(
        repo_id=f"Systran/faster-whisper-{settings.WHISPER_MODEL.value}",
        revision=settings.WHISPER_MODEL_REVISION,
        local_dir=root
        / "asr"
        / f"faster-whisper-{settings.WHISPER_MODEL.value}"
        / settings.WHISPER_MODEL_REVISION,
        allow_patterns=[
            "model.bin",
            "config.json",
            "tokenizer.json",
            "vocabulary.*",
            "preprocessor_config.json",
        ],
    )
    download_source(root)
    snapshot_download(
        repo_id=settings.FISH_MODEL_ID,
        revision=settings.FISH_MODEL_REVISION,
        local_dir=root / "fish" / "model" / settings.FISH_MODEL_REVISION,
        allow_patterns=["*.json", "*.safetensors", "*.pth", "*.jinja", "LICENSE.md"],
    )
    verify(root)
    (root / "model-assets.json").write_text(
        json.dumps(
            {
                "schemaVersion": 3,
                "engine": "fish-s2-pro",
                "modelId": settings.FISH_MODEL_ID,
                "modelRevision": settings.FISH_MODEL_REVISION,
                "sourceRevision": settings.FISH_SOURCE_REVISION,
                "whisperRevision": settings.WHISPER_MODEL_REVISION,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path(settings.SHIO_MODEL_ROOT))
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    (verify if args.check else prefetch)(args.root.resolve())
    print("Pinned Fish S2 Pro and ASR assets verified")
