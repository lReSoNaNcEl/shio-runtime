from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase

from scripts.prefetch_models import expected_paths, verify


class ModelPrefetchTests(TestCase):
    def test_check_rejects_incomplete_cache(self):
        with TemporaryDirectory() as temporary_directory:
            with self.assertRaisesRegex(RuntimeError, "Missing prefetched model assets"):
                verify(Path(temporary_directory))

    def test_check_accepts_complete_revision_pinned_layout(self):
        with TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            for path in expected_paths(root):
                if path.suffix or path.name == "model-assets.json":
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_bytes(b"test")
                else:
                    path.mkdir(parents=True, exist_ok=True)

            verify(root)
