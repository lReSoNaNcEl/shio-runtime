"""Fetch only the fixed ordinary SOMA candidate; never change production pins."""

import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2] / "motion"
os.environ["HF_HOME"] = str(ROOT / ".cache" / "huggingface")
os.environ["HF_XET_CACHE"] = str(ROOT / ".cache" / "huggingface" / "xet")
os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"

REPOSITORY = "nvidia/ARDY-SOMA-RP-30FPS-Horizon60"
REVISION = "244215084b22fcd29ab743017330e87411fe168a"


def main():
    from huggingface_hub import snapshot_download

    destination = ROOT / ".cache" / "models" / REPOSITORY / REVISION
    snapshot_download(
        REPOSITORY,
        revision=REVISION,
        token=False,
        local_dir=destination,
        allow_patterns=["config.yaml", "*.safetensors", "stats/**"],
    )
    print(json.dumps({"candidate": REPOSITORY, "revision": REVISION, "downloaded": True}))


if __name__ == "__main__":
    main()
