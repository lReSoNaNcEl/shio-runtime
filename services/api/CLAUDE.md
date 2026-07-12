# API service (ASR + TTS)

Local ASR + F5-TTS service. Local rules for `services/api`. The canonical cross-repo
manual is `../../AGENTS.md`; global and Claude-specific rules are in `../../CLAUDE.md`.

## Boundaries

- This service owns speech recognition and synthesis.
- It does not own Electron playback, LipSync, or avatar state — those belong to
  `apps/desktop`.
- Preserve the existing HTTP API unless the task explicitly changes the contract.
- Resolve service assets relative to the service root (`Path(__file__)` /
  `services/api`), not the monorepo cwd. The service must run correctly whether
  launched from `services/api` or from the repo root via `npm run api:dev`.
- Never commit model caches, secrets, generated audio, or the local virtualenv.

## Commands

- Create and use the local virtualenv in `services/api` (do not reuse an old venv).
- `python -m uvicorn app.main:app --host 0.0.0.0 --port 8000` (or `npm run api:dev`
  from the repo root).

## API checks

Do not rely on `py_compile` alone. After changes verify the affected endpoints:

- `/health` — `engines.f5.mode` should be `real`
- `/voices`
- `/emotions`
- `/synthesize` — actual WAV is produced
- `/recognize`

Also confirm `voice_manifest.json` and reference assets resolve from `services/api`.

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

Reference assets are **not committed to Git** (third-party `taresh18/AnimeVox`
dataset). Fetch them into `voices/` with `python scripts/sync_voices.py` (or
`npm run api:voices:sync` from the repo root), which reuses
`voice_repository_manager.sync()` — the same path as `POST /voices/sync`. A voice is
`available` only when both its `reference.wav` and `reference.txt` exist on disk.

Sync is hardened: it is single-flight (a cross-process lock at `.voice_sync.lock`
prevents concurrent CLI + server syncs racing the manifest), it writes assets to temp
files, validates the WAV, then atomically renames (transcript last, cache marker last)
so an interrupted download can never produce a half-written `available` voice, and the
dataset revision is pinnable via `VOICE_DATASET_REVISION`.

Server-side F5 knobs live in `.env`: `F5_NFE_STEP`, `F5_CFG_STRENGTH`, and `F5_USE_ACCENT`.
