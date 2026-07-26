import asyncio
import threading
import time
from unittest import IsolatedAsyncioTestCase
from unittest.mock import patch

import numpy as np
from fastapi import HTTPException

from app.routes import synthesize as route
from app.tts.f5_local import F5LocalEngine


class FakeWarmupEngine:
    def __init__(self):
        self.calls = 0

    def synthesize(self, **_kwargs):
        self.calls += 1
        time.sleep(0.03)
        return object()


class VoiceWarmupTests(IsolatedAsyncioTestCase):
    def setUp(self):
        route._warmup_tasks.clear()
        route._warmup_status.clear()

    async def test_concurrent_russian_voice_warmups_are_coalesced(self):
        engine = FakeWarmupEngine()
        request = route.VoiceWarmupRequest(voiceId="selected_voice", language="ru")
        with (
            patch.object(route, "_engine_by_name", return_value=engine),
            patch.object(route, "_resolve_voice_id", return_value="selected_voice"),
        ):
            first, second = await asyncio.gather(
                route.warmup_voice(request),
                route.warmup_voice(request),
            )

        self.assertEqual(engine.calls, 1)
        self.assertEqual(first["state"], "ready")
        self.assertEqual(second["state"], "ready")
        self.assertEqual(first["language"], "ru")

    async def test_f5_inference_lock_prevents_overlap(self):
        engine = F5LocalEngine.__new__(F5LocalEngine)
        engine.is_ready = True
        engine.sample_rate = 24_000
        engine.engine_name = "f5"
        engine._inference_lock = threading.Lock()
        active = 0
        maximum = 0
        state_lock = threading.Lock()

        def synthesize_internal(**_kwargs):
            nonlocal active, maximum
            with state_lock:
                active += 1
                maximum = max(maximum, active)
            time.sleep(0.03)
            with state_lock:
                active -= 1
            return np.zeros(240, dtype=np.float32)

        engine._synthesize_internal = synthesize_internal
        await asyncio.gather(
            asyncio.to_thread(engine.synthesize, "warmup", language="ru", voice="selected_voice"),
            asyncio.to_thread(engine.synthesize, "real", language="ru", voice="selected_voice"),
        )

        self.assertEqual(maximum, 1)

    async def test_distinct_warmup_queue_is_bounded(self):
        engine = FakeWarmupEngine()
        request = route.VoiceWarmupRequest(voiceId="overflow", language="ru")
        blocker = asyncio.create_task(asyncio.sleep(10))
        try:
            route._warmup_tasks.update(
                {
                    ("f5", f"voice_{index}", "ru"): blocker
                    for index in range(route.MAX_PENDING_VOICE_WARMUPS)
                }
            )
            with (
                patch.object(route, "_engine_by_name", return_value=engine),
                patch.object(route, "_resolve_voice_id", return_value="overflow"),
                self.assertRaises(HTTPException) as raised,
            ):
                await route.warmup_voice(request)
            self.assertEqual(raised.exception.status_code, 429)
            self.assertEqual(engine.calls, 0)
        finally:
            blocker.cancel()
            await asyncio.gather(blocker, return_exceptions=True)
