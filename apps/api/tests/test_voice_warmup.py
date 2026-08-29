from unittest import IsolatedAsyncioTestCase
from unittest.mock import patch

import numpy as np

from app.routes import tts as route


class FakeWarmupEngine:
    def __init__(self):
        self.calls = 0

    def stream(self, text_chunks, **_kwargs):
        self.calls += 1
        assert list(text_chunks)
        yield np.zeros(240, dtype=np.float32)


class VoiceWarmupTests(IsolatedAsyncioTestCase):
    async def test_selected_voice_is_warmed_through_streaming_engine(self):
        engine = FakeWarmupEngine()
        request = route.VoiceWarmupRequest(voiceId="selected_voice", language="ru")
        with (
            patch.object(route, "get_engine", return_value=engine),
            patch.object(route, "_resolve_voice_id", return_value="selected_voice"),
        ):
            result = await route.warmup_voice(request)

        self.assertEqual(engine.calls, 1)
        self.assertEqual(result["state"], "ready")
        self.assertEqual(result["engine"], "cosyvoice3")
        self.assertEqual(result["language"], "ru")

    async def test_delivery_intent_is_provider_neutral_at_route_boundary(self):
        intent = route.SpeechDeliveryIntent(emotion="warm", pace="slow")
        self.assertEqual(intent.emotion, "warm")
        self.assertEqual(intent.pace, "slow")
