import json
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase
from unittest.mock import patch

from app.config import settings
from app.tts.voice_repository_manager import VoiceRepositoryManager

PINNED_REVISION = "4f5ea88465616eede2b364a0369dcba0d8bebaee"


class VoiceDatasetRevisionTests(TestCase):
    def test_cached_sync_persists_manifest_revision_as_resolved_revision(self):
        with TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            manifest_path = root / "voice_manifest.json"
            status_path = root / "voice_repository_status.json"
            voice_dir = root / "voices" / "AnimeVox" / "Makima"
            voice_dir.mkdir(parents=True)
            (voice_dir / "reference.wav").write_bytes(b"cached")
            (voice_dir / "reference.txt").write_text("hello\n", encoding="utf-8")
            manifest_path.write_text(
                json.dumps(
                    {
                        "version": 1,
                        "defaultVoiceId": "animevox_makima",
                        "datasets": [
                            {
                                "id": "AnimeVox",
                                "repoId": "taresh18/AnimeVox",
                                "revision": PINNED_REVISION,
                            }
                        ],
                        "voices": [],
                    }
                ),
                encoding="utf-8",
            )

            manager = VoiceRepositoryManager(str(manifest_path), str(status_path))
            with patch.object(settings, "VOICE_DATASET_REVISION", ""):
                result = manager.sync(limit=1)

            self.assertEqual(result["resolvedRevision"], PINNED_REVISION)
            status = json.loads(status_path.read_text(encoding="utf-8"))
            self.assertEqual(status["resolvedRevision"], PINNED_REVISION)
            self.assertEqual(manager.status()["resolvedRevision"], PINNED_REVISION)
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            self.assertEqual(manifest["datasets"][0]["revision"], PINNED_REVISION)

    def test_environment_revision_overrides_manifest_revision(self):
        with patch.object(settings, "VOICE_DATASET_REVISION", "a" * 40):
            revision = VoiceRepositoryManager._resolved_revision({"revision": PINNED_REVISION})
        self.assertEqual(revision, "a" * 40)
