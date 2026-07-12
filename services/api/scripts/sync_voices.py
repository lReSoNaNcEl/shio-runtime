"""Download voice reference assets into voices/ from the configured repository.

Voice reference audio/transcripts (voices/<dataset>/<voice>/reference.wav|.txt) are
intentionally NOT committed to Git. This helper fetches them into the expected paths
so a fresh clone becomes runnable. It calls the same code path as POST /voices/sync
but does not require a running server.

Source is configured in app/tts/voice_repository_manager.py (DEFAULT_REPOSITORIES):
the HuggingFace dataset `taresh18/AnimeVox`. Set HF_TOKEN in .env for higher rate
limits. Usage (from repo root or from services/api):

    python scripts/sync_voices.py                 # up to VOICE_SYNC_MAX_VOICES voices
    python scripts/sync_voices.py --limit 3       # only the first 3
    python scripts/sync_voices.py --force          # re-download even if cached
    python scripts/sync_voices.py --dataset AnimeVox
"""

import argparse
import os
import sys
from pathlib import Path

# Resolve everything relative to the service root, not the caller's cwd, so the
# manifest and voices/ directory are found no matter where this is launched from.
SERVICE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVICE_ROOT))
os.chdir(SERVICE_ROOT)

from app.tts.voice_repository_manager import voice_repository_manager  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="Sync voice reference assets into voices/.")
    parser.add_argument(
        "--dataset",
        default=None,
        help="Dataset/repository id (default: first configured, AnimeVox)",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Max voices to import (default: VOICE_SYNC_MAX_VOICES)",
    )
    parser.add_argument(
        "--force", action="store_true", help="Re-download assets even if already cached"
    )
    args = parser.parse_args()

    print("Syncing voice reference assets...")
    try:
        result = voice_repository_manager.sync(
            dataset=args.dataset, limit=args.limit, force=args.force
        )
    except Exception as exc:  # noqa: BLE001 - surface a clear message to the operator
        print(f"Voice sync failed: {exc}", file=sys.stderr)
        return 1

    available = result.get("availableVoices") or []
    print(
        f"State: {result.get('syncState')}  dataset: {result.get('dataset')}  voices: {len(available)}"
    )
    for voice in available:
        flag = "cached" if voice.get("cached") else "installed"
        print(f"  - {voice.get('id')} ({voice.get('displayName')}) [{flag}]")
    if not available:
        print("No voices imported. Check network access and HF_TOKEN.", file=sys.stderr)
        return 1
    print("Done. Restart the service (or call /voices) to pick up the new references.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
