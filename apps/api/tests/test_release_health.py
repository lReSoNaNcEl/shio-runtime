from unittest import IsolatedAsyncioTestCase

from app.config import settings
from app.routes import health


class ReleaseHealthTests(IsolatedAsyncioTestCase):
    def setUp(self):
        health.health_state.asr_ready = False
        health.health_state.f5_ready = False
        health.health_state.f5_mode = "unavailable"

    async def test_health_exposes_stable_identity_and_explicit_readiness(self):
        health.set_asr_ready(True)
        health.set_engine_ready("f5", True, "real")

        payload = await health.health_check()

        self.assertEqual(payload["serviceId"], settings.SERVICE_ID)
        self.assertEqual(payload["contractVersion"], settings.CONTRACT_VERSION)
        self.assertEqual(payload["speechPackVersion"], settings.SPEECH_PACK_VERSION)
        self.assertTrue(payload["ready"])
        self.assertTrue(payload["asr"]["ready"])
        self.assertTrue(payload["engines"]["f5"]["ready"])
        self.assertEqual(payload["engines"]["f5"]["mode"], "real")

    async def test_mock_f5_is_not_overall_ready(self):
        health.set_asr_ready(True)
        health.set_engine_ready("f5", True, "mock")

        payload = await health.health_check()

        self.assertFalse(payload["ready"])
        self.assertEqual(payload["engines"]["f5"]["mode"], "mock")
