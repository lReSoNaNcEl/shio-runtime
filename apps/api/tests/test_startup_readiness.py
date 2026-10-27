import threading
import time

from fastapi.testclient import TestClient

from app import main
from app.routes import health
from app.tts.runtime import set_engine


def test_health_is_reachable_while_owned_models_are_loading(monkeypatch):
    started, release = threading.Event(), threading.Event()

    def loading_asr():
        started.set()
        assert release.wait(3)
        return object(), object()

    monkeypatch.setattr(main, "init_asr", loading_asr)
    monkeypatch.setattr(main, "init_tts_engines", lambda: None)
    monkeypatch.setattr(main, "_tts_engines", {})
    set_engine(None)
    health.set_asr_ready(False)
    try:
        with TestClient(main.app) as client:
            assert started.wait(1)
            before = time.monotonic()
            response = client.get("/health")
            assert time.monotonic() - before < 1
            assert response.status_code == 200
            assert response.json()["asr"]["status"] == "loading"
            assert response.json()["ready"] is False
            release.set()
    finally:
        release.set()


def test_startup_failure_has_bounded_diagnostic_and_keeps_health_available(monkeypatch):
    def broken_asr():
        raise RuntimeError("synthetic provider payload must not reach health")

    monkeypatch.setattr(main, "init_asr", broken_asr)
    monkeypatch.setattr(main, "_tts_engines", {})
    set_engine(None)
    health.set_asr_ready(False)
    with TestClient(main.app) as client:
        for _ in range(20):
            state = client.get("/health").json()
            if state["asr"]["status"] == "failed":
                break
            time.sleep(0.01)
        assert state["asr"]["status"] == "failed"
        assert state["asr"]["error"] == "RuntimeError"
        assert "provider payload" not in str(state)
    health.set_asr_ready(False)
