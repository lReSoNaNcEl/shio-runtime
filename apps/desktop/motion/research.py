"""Stage-A prerequisite checks, not the application's ARDY Adapter.

Network access is explicit (doctor/prefetch). The public checkpoint probe runs
offline and cannot qualify semantic motion, VRM retargeting, or joint playback.
"""

from __future__ import annotations

import argparse
import io
import json
import os
import re
import sys
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CACHE = ROOT / ".cache"
ARTIFACTS = ROOT / ".artifacts"
COMMIT = re.compile(r"[0-9a-f]{40}")


def load_pins(path: Path = ROOT / "research-pins.json") -> dict:
    pins = json.loads(path.read_text(encoding="utf-8"))
    if pins.get("version") != 1 or pins.get("status") != "research-only":
        raise ValueError("Unsupported research manifest")
    entries = [pins["source"], pins["motion"], *pins["textEncoder"]]
    for entry in entries:
        if not COMMIT.fullmatch(entry["revision"]):
            raise ValueError("Every source and checkpoint requires an exact commit")
        if not re.fullmatch(r"[A-Za-z0-9_-]+/[A-Za-z0-9_.-]+", entry["repository"]):
            raise ValueError("Invalid repository identity")
    return pins


def unpack_source(data: bytes, destination: Path) -> None:
    """Reject escaping paths, links, and oversized archives before any write."""
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        files = archive.infolist()
        if not files or len(files) > 5000 or sum(item.file_size for item in files) > 100_000_000:
            raise ValueError("Source archive exceeds research limits")
        targets = []
        prefix = files[0].filename.split("/")[0] if files else ""
        for item in files:
            parts = item.filename.split("/")
            relative = Path(*parts[1:])
            target = (destination / relative).resolve()
            if (
                parts[0] != prefix
                or ".." in parts
                or "\\" in item.filename
                or not target.is_relative_to(destination.resolve())
                or (item.external_attr >> 16) & 0o170000 == 0o120000
            ):
                raise ValueError("Unsafe source archive")
            targets.append((item, target))
        for item, target in targets:
            if item.is_dir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(archive.read(item))


def asset_path(entry: dict) -> Path:
    return CACHE / "models" / entry["repository"] / entry["revision"]


def source_path(pins: dict) -> Path:
    return CACHE / "source" / pins["source"]["revision"]


def check_access(repository: str) -> dict:
    from huggingface_hub import HfApi
    from huggingface_hub.errors import HfHubHTTPError

    try:
        HfApi().auth_check(repository)
        return {"repository": repository, "status": "granted"}
    except HfHubHTTPError as error:
        # Do not serialize provider exceptions, headers, account identity or tokens.
        code = error.response.status_code if error.response is not None else None
        return {"repository": repository, "status": "unavailable", "httpStatus": code}


def write_report(name: str, report: dict) -> None:
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    (ARTIFACTS / name).write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2), flush=True)


def snapshot_ready(entry: dict) -> bool:
    from safetensors import SafetensorError, safe_open

    folder = asset_path(entry)
    if not folder.is_dir():
        return False
    if entry["repository"] == "nvidia/ARDY-SOMA-RP-30FPS-Horizon60":
        names = ["denoiser.safetensors", "tokenizer.safetensors"]
    elif (folder / "model.safetensors.index.json").is_file():
        index = json.loads((folder / "model.safetensors.index.json").read_text(encoding="utf-8"))
        names = sorted(set(index["weight_map"].values()))
    else:
        names = ["adapter_model.safetensors"]
    if not 1 <= len(names) <= 128 or any(
        Path(name).name != name or not name.endswith(".safetensors") for name in names
    ):
        return False
    try:
        for name in names:
            with safe_open(str(folder / name), framework="pt", device="cpu") as weights:
                if not weights.keys():
                    return False
    except (OSError, ValueError, SafetensorError):
        return False
    return True


def doctor(pins: dict, offline: bool = False) -> int:
    import torch

    access = (
        {"status": "cached-offline"}
        if offline
        else check_access(pins["textEncoder"][0]["repository"])
    )
    result = {
        "scope": "stage-a-prerequisites-only",
        "experimentQualified": False,
        "python": sys.version.split()[0],
        "torch": torch.__version__,
        "cuda": torch.version.cuda,
        "cudaAvailable": torch.cuda.is_available(),
        "textEncoderAccess": access,
        "sourceRevision": pins["source"]["revision"],
        "sourcePresent": (source_path(pins) / "ardy" / "model" / "ardy_model.py").is_file(),
        "motionRevision": pins["motion"]["revision"],
        "publicCheckpointPresent": snapshot_ready(pins["motion"]),
        "textEncoderSnapshotsPresent": all(snapshot_ready(entry) for entry in pins["textEncoder"]),
    }
    write_report("prerequisites.json", result)
    ready = all(
        [
            access["status"] in {"granted", "cached-offline"},
            result["cudaAvailable"],
            result["sourcePresent"],
            result["publicCheckpointPresent"],
            result["textEncoderSnapshotsPresent"],
        ]
    )
    return 0 if ready else 1


def prefetch(pins: dict, public_only: bool) -> int:
    from huggingface_hub import snapshot_download

    if not public_only:
        access = check_access(pins["textEncoder"][0]["repository"])
        if access["status"] != "granted":
            write_report("prefetch.json", {"prepared": False, "textEncoderAccess": access})
            return 1
    source = source_path(pins)
    if not (source / "ardy" / "model" / "ardy_model.py").is_file():
        entry = pins["source"]
        url = f"https://github.com/{entry['repository']}/archive/{entry['revision']}.zip"
        with urllib.request.urlopen(url, timeout=60) as response:
            data = response.read(32_000_001)
        if len(data) > 32_000_000:
            raise ValueError("Source download exceeds research limit")
        unpack_source(data, source)
    entries = [pins["motion"]] + ([] if public_only else pins["textEncoder"])
    for entry in entries:
        snapshot_download(
            entry["repository"],
            revision=entry["revision"],
            local_dir=asset_path(entry),
            ignore_patterns=["original/*"],
        )
    write_report(
        "prefetch.json",
        {
            "prepared": True,
            "scope": "public-only" if public_only else "all-snapshots",
            "experimentQualified": False,
            "revisions": [
                {"repository": e["repository"], "revision": e["revision"]} for e in entries
            ],
        },
    )
    return 0


def probe(pins: dict) -> int:
    # No implicit download. The command runner excludes HF and LLM credentials.
    source = source_path(pins)
    if not source.is_dir() or not (asset_path(pins["motion"]) / "config.yaml").is_file():
        raise RuntimeError("Run motion:research:prefetch -- --public-only first")
    os.environ.update({"HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1"})
    from probe_public_checkpoint import main as run_probe

    run_probe()
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["doctor", "prefetch", "probe"])
    parser.add_argument("--public-only", action="store_true")
    parser.add_argument("--offline", action="store_true")
    arguments = parser.parse_args()
    pins = load_pins()
    if arguments.action == "prefetch":
        return prefetch(pins, arguments.public_only)
    if arguments.public_only:
        parser.error("--public-only applies only to prefetch")
    return doctor(pins, arguments.offline) if arguments.action == "doctor" else probe(pins)


if __name__ == "__main__":
    raise SystemExit(main())
