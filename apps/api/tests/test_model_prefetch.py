import subprocess
import sys
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase

from scripts.prefetch_models import SERVICE_ROOT, expected_paths, verify


class ModelPrefetchTests(TestCase):
    def test_script_bootstraps_service_imports_outside_service_root(self):
        with TemporaryDirectory() as temporary_directory:
            result = subprocess.run(
                [sys.executable, str(SERVICE_ROOT / "scripts" / "prefetch_models.py"), "--help"],
                cwd=temporary_directory,
                capture_output=True,
                check=False,
                text=True,
            )

        self.assertEqual(result.returncode, 0, result.stderr)

    def test_check_rejects_incomplete_cache(self):
        with TemporaryDirectory() as temporary_directory:
            with self.assertRaisesRegex(RuntimeError, "Missing pinned speech assets"):
                verify(Path(temporary_directory))

    def test_check_accepts_complete_revision_pinned_layout(self):
        with TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            for path in expected_paths(root):
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(b"test")

            index = next(
                path for path in expected_paths(root) if path.name == "model.safetensors.index.json"
            )
            index.write_text(
                '{"weight_map":{"layer":"model-00001-of-00002.safetensors"}}', encoding="utf-8"
            )

            verify(root)
