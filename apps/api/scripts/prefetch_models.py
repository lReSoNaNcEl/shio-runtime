"""Atomically download and verify every revision-pinned Speech Pack asset."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import tempfile
import urllib.request
import zipfile
from pathlib import Path

SERVICE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVICE_ROOT))
os.chdir(SERVICE_ROOT)

from huggingface_hub import snapshot_download  # noqa: E402

from app.config import settings  # noqa: E402


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
    source = root / "cosyvoice" / "source" / settings.COSYVOICE_SOURCE_REVISION
    matcha = root / "cosyvoice" / "matcha" / settings.COSYVOICE_MATCHA_REVISION
    model = root / "cosyvoice" / "model" / settings.COSYVOICE_MODEL_REVISION
    return [
        root / "model-assets.json",
        asr / "config.json",
        asr / "model.bin",
        asr / "tokenizer.json",
        source / "cosyvoice" / "cli" / "cosyvoice.py",
        matcha / "matcha" / "__init__.py",
        model / "cosyvoice3.yaml",
        model / "llm.pt",
        model / "flow.pt",
        model / "hift.pt",
        model / "campplus.onnx",
        model / "speech_tokenizer_v3.onnx",
        model / "CosyVoice-BlankEN" / "model.safetensors",
        model / "CosyVoice-BlankEN" / "tokenizer_config.json",
    ]


def verify(root: Path) -> None:
    missing = [str(path) for path in expected_paths(root) if not path.exists()]
    if missing:
        raise RuntimeError("Missing prefetched model assets: " + ", ".join(missing))


def remove_unreferenced_managed_assets(root: Path) -> None:
    """Remove only assets below the explicit app-owned model root and current manifest."""
    resolved = root.resolve()
    if resolved == Path(resolved.anchor):
        raise RuntimeError("Refusing managed model cleanup at a filesystem root")

    allowed_top_level = {"asr", "cosyvoice", "model-assets.json"}
    for child in resolved.iterdir():
        if child.name not in allowed_top_level:
            shutil.rmtree(child) if child.is_dir() else child.unlink()

    asr_root = resolved / "asr"
    current_asr_family = f"faster-whisper-{settings.WHISPER_MODEL.value}"
    if asr_root.is_dir():
        for child in asr_root.iterdir():
            if child.name != current_asr_family:
                shutil.rmtree(child) if child.is_dir() else child.unlink()
    cosyvoice_root = resolved / "cosyvoice"
    if cosyvoice_root.is_dir():
        for child in cosyvoice_root.iterdir():
            if child.name not in {"source", "matcha", "model"}:
                shutil.rmtree(child) if child.is_dir() else child.unlink()

    current_revisions = {
        resolved / "asr" / f"faster-whisper-{settings.WHISPER_MODEL.value}": {
            settings.WHISPER_MODEL_REVISION
        },
        resolved / "cosyvoice" / "source": {settings.COSYVOICE_SOURCE_REVISION},
        resolved / "cosyvoice" / "matcha": {settings.COSYVOICE_MATCHA_REVISION},
        resolved / "cosyvoice" / "model": {settings.COSYVOICE_MODEL_REVISION},
    }
    for parent, allowed_names in current_revisions.items():
        if not parent.is_dir():
            continue
        for child in parent.iterdir():
            if child.name not in allowed_names:
                shutil.rmtree(child) if child.is_dir() else child.unlink()


def _download_source_archive(repository: str, revision: str, target: Path) -> None:
    relative_required = (
        Path("cosyvoice/cli/cosyvoice.py")
        if repository.endswith("/CosyVoice")
        else Path("matcha/__init__.py")
    )
    if (target / relative_required).is_file():
        _prune_source_tree(target, repository)
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="shio-source-", dir=target.parent) as temporary:
        temporary_path = Path(temporary)
        archive_path = temporary_path / "source.zip"
        request = urllib.request.Request(
            f"https://codeload.github.com/{repository}/zip/{revision}",
            headers={"User-Agent": "Shio-Speech-Pack-Prefetch"},
        )
        with urllib.request.urlopen(request, timeout=120) as response:  # noqa: S310
            archive_path.write_bytes(response.read())
        extracted = temporary_path / "extracted"
        with zipfile.ZipFile(archive_path) as archive:
            for member in archive.infolist():
                resolved = (extracted / member.filename).resolve()
                if extracted.resolve() not in resolved.parents and resolved != extracted.resolve():
                    raise RuntimeError("Unsafe source archive path")
            archive.extractall(extracted)
        roots = [candidate for candidate in extracted.iterdir() if candidate.is_dir()]
        if len(roots) != 1:
            raise RuntimeError(f"Unexpected source archive layout for {repository}@{revision}")
        staged = target.parent / f".{target.name}.staged"
        if staged.exists():
            shutil.rmtree(staged)
        shutil.move(str(roots[0]), staged)
        if not (staged / relative_required).is_file():
            shutil.rmtree(staged)
            raise RuntimeError(f"Pinned source validation failed: {relative_required}")
        _prune_source_tree(staged, repository)
        if target.exists():
            shutil.rmtree(target)
        staged.replace(target)


def _prune_source_tree(target: Path, repository: str) -> None:
    """Keep only importable runtime packages and upstream licensing in a source snapshot."""
    allowed = (
        {"cosyvoice", "LICENSE"} if repository.endswith("/CosyVoice") else {"matcha", "LICENSE"}
    )
    for child in target.iterdir():
        if child.name in allowed:
            continue
        shutil.rmtree(child) if child.is_dir() else child.unlink()


def prefetch(root: Path) -> None:
    asr_repo = f"Systran/faster-whisper-{settings.WHISPER_MODEL.value}"
    asr_target = (
        root
        / "asr"
        / f"faster-whisper-{settings.WHISPER_MODEL.value}"
        / settings.WHISPER_MODEL_REVISION
    )
    snapshot_download(
        repo_id=asr_repo,
        revision=settings.WHISPER_MODEL_REVISION,
        local_dir=asr_target,
    )
    _download_source_archive(
        "QwenAudio/CosyVoice",
        settings.COSYVOICE_SOURCE_REVISION,
        root / "cosyvoice" / "source" / settings.COSYVOICE_SOURCE_REVISION,
    )
    _download_source_archive(
        "shivammehta25/Matcha-TTS",
        settings.COSYVOICE_MATCHA_REVISION,
        root / "cosyvoice" / "matcha" / settings.COSYVOICE_MATCHA_REVISION,
    )
    snapshot_download(
        repo_id=settings.COSYVOICE_MODEL_ID,
        revision=settings.COSYVOICE_MODEL_REVISION,
        local_dir=root / "cosyvoice" / "model" / settings.COSYVOICE_MODEL_REVISION,
        allow_patterns=[
            "cosyvoice3.yaml",
            "llm.pt",
            "flow.pt",
            "hift.pt",
            "campplus.onnx",
            "speech_tokenizer_v3.onnx",
            "CosyVoice-BlankEN/*",
        ],
    )
    state = {
        "schemaVersion": 2,
        "whisperRevision": settings.WHISPER_MODEL_REVISION,
        "cosyVoiceModelId": settings.COSYVOICE_MODEL_ID,
        "cosyVoiceModelRevision": settings.COSYVOICE_MODEL_REVISION,
        "cosyVoiceSourceRevision": settings.COSYVOICE_SOURCE_REVISION,
        "matchaRevision": settings.COSYVOICE_MATCHA_REVISION,
    }
    (root / "model-assets.json").write_text(json.dumps(state, indent=2), encoding="utf-8")
    verify(root)
    remove_unreferenced_managed_assets(root)


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
