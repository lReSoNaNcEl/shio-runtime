"""Create local directories declared by voice_manifest.json.

This helper does not download voice assets. Place AnimeVox reference audio at the
manifest paths, for example:

    voices/AnimeVox/default/reference.wav
    voices/AnimeVox/default/reference.txt
"""

import sys

from pathlib import Path

# Allow running from the repo root.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.tts.voices import voice_registry


def main() -> None:
    for voice in voice_registry.list_voices():
        entry = voice_registry.get(voice["voiceId"])
        entry.reference_audio.parent.mkdir(parents=True, exist_ok=True)
        print(f"{entry.id}: {entry.reference_audio.parent}")


if __name__ == "__main__":
    main()
