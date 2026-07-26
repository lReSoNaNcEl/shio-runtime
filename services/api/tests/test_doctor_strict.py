from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase
from unittest.mock import patch

from scripts.doctor_strict import SERVICE_ROOT, expected_venv


class StrictDoctorTests(TestCase):
    def test_default_environment_is_service_local_venv(self):
        with patch.dict("os.environ", {}, clear=True):
            self.assertEqual(expected_venv(), (SERVICE_ROOT / ".venv").resolve())

    def test_launcher_can_supply_release_environment_path(self):
        with TemporaryDirectory() as temporary_directory:
            release_venv = Path(temporary_directory) / "SpeechPack" / ".venv"
            with patch.dict("os.environ", {"SHIO_API_VENV": str(release_venv)}):
                self.assertEqual(expected_venv(), release_venv.resolve())
