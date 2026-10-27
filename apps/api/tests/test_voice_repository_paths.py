import json
import os
import subprocess
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase

from app.tts.voice_repository_manager import ImportedVoice, VoiceRepositoryManager


class VoiceRepositoryPathTests(TestCase):
    def test_manifest_keeps_junction_backed_voice_paths_relative_to_service_root(self):
        with TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            service_root = root / "speech-pack" / "api"
            persistent_voices = root / "data" / "voices"
            voice_dir = persistent_voices / "AnimeVox" / "Frieren"
            voice_dir.mkdir(parents=True)
            audio_path = voice_dir / "reference.wav"
            text_path = voice_dir / "reference.txt"
            audio_path.write_bytes(b"voice")
            text_path.write_text("hello\n", encoding="utf-8")

            service_root.mkdir(parents=True)
            voices_link = service_root / "voices"
            try:
                voices_link.symlink_to(persistent_voices, target_is_directory=True)
            except OSError as exc:
                if os.name != "nt":
                    raise
                # Match the launcher: directory junctions need no symlink privilege.
                result = subprocess.run(
                    [
                        "powershell",
                        "-NoProfile",
                        "-Command",
                        "New-Item -ItemType Junction -Path $env:SHIO_TEST_LINK -Target $env:SHIO_TEST_TARGET -ErrorAction Stop | Out-Null",
                    ],
                    capture_output=True,
                    check=False,
                    env={
                        **os.environ,
                        "SHIO_TEST_LINK": str(voices_link),
                        "SHIO_TEST_TARGET": str(persistent_voices),
                    },
                )
                self.assertEqual(result.returncode, 0, f"Could not create test junction: {exc}")

            manifest_path = service_root / "voice_manifest.json"
            status_path = service_root / "voice_repository_status.json"
            manifest_path.write_text(
                json.dumps({"version": 1, "datasets": [], "voices": []}),
                encoding="utf-8",
            )
            manager = VoiceRepositoryManager(str(manifest_path), str(status_path))
            linked_voice_dir = voices_link / "AnimeVox" / "Frieren"
            imported = ImportedVoice(
                voice_id="animevox_frieren",
                display_name="Frieren",
                dataset="AnimeVox",
                language="en",
                audio_path=linked_voice_dir / "reference.wav",
                text_path=linked_voice_dir / "reference.txt",
                installed=True,
                cached=True,
                text_hash="test-hash",
            )

            manager._merge_manifest(manager.repositories()[0], [imported])

            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            voice = manifest["voices"][0]
            self.assertEqual(
                voice["referenceAudio"],
                "voices/AnimeVox/Frieren/reference.wav",
            )
            self.assertEqual(
                voice["referenceText"],
                "voices/AnimeVox/Frieren/reference.txt",
            )
            self.assertEqual(manager._resolve(voice["referenceAudio"]), audio_path.resolve())
            self.assertEqual(manager._resolve(voice["referenceText"]), text_path.resolve())
