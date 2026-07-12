# Project Notes

Local ASR + F5-TTS service.

## Architecture

- FastAPI on `:8000`.
- ASR: faster-whisper + Silero VAD.
- TTS: one in-process `F5LocalEngine` wrapping `f5_tts.api.F5TTS`.
- `/synthesize` returns WAV plus headers: `X-Engine`, `X-Language`, `X-Emotion`, `X-VRM-Emotion`, latency, RTF, duration.
- `/voices` exposes voice presets, available references, and VRM expression mappings.

## Emotion Contract

LLM output should use a single leading tag where possible:

```text
[happy] Привет! Я рада тебя видеть.
```

Supported normalized tags:

```text
neutral, calm, warm, happy, laugh, chuckle, sad, crying,
angry, fear, surprised, gasp, sigh, groan, whisper
```

`app/tts/emotion.py` removes inline tags and maps them to both TTS emotion names and VRM expression weights. `app/tts/voice_registry.py` resolves logical voice IDs into F5 reference audio.

## F5 References

Reference lookup:

```text
voices/<dataset>/<voice>/reference.wav
voice_manifest.json
```

Each reference needs a transcript next to it:

```text
voices/<dataset>/<voice>/reference.txt
```

Server-side F5 knobs live in `.env`: `F5_NFE_STEP`, `F5_CFG_STRENGTH`, and `F5_USE_ACCENT`.
