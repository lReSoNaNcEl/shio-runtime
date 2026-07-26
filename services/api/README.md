# Python Speech - ASR + F5-TTS

Local FastAPI service for speech recognition and F5-based speech synthesis.

## What Is Inside

- ASR: faster-whisper + Silero VAD.
- TTS: one local F5-TTS engine.
- Voice references: logical `voiceId` values resolved through `voice_manifest.json`.
- Remote voices: `/voices/sync` imports AnimeVox references into `voices/<dataset>/<voice>/`.
- Emotion contract: emotion tags are normalized through `emotion_manifest.json` and exposed by `/emotions`.

## Emotion Tags

Use one leading tag in LLM output:

```text
[happy] Привет! Я рада тебя видеть.
[sigh] Ладно, давай попробуем ещё раз.
[gasp] Ого, вот это поворот.
```

Supported tags:

```text
neutral, calm, warm, happy, laugh, chuckle, sad, crying,
angry, fear, surprised, gasp, sigh, groan, whisper
```

The backend removes the tag from spoken text and resolves the speech emotion through Emotion Registry.

## API

- `GET /` - Web UI.
- `GET /docs` - Swagger UI.
- `GET /health` - backwards-compatible service status with stable service,
  contract, Speech Pack identity, and explicit ASR/F5 readiness.
- `GET /voices` - manifest-backed voices, datasets, installed/available references, sync metadata, emotion contract.
- `GET /emotions` - shared emotion manifest contract.
- `GET /voices/status` - remote sync state, installed voices, and missing local assets.
- `POST /voices/sync` - synchronize configured remote voice repositories.
- `POST /synthesize` - WAV response from F5-TTS.
- `POST /recognize` - ASR for uploaded audio.
- `WS /ws` - streaming ASR.

## Local setup

The canonical Python environment is `services/api/.venv`. From the repository root:

```powershell
npm run alpha:setup
npm run api:dev
```

The alpha setup requires Windows x64, Node.js 24.x, npm 11.x, Python 3.12 and an
NVIDIA GPU supported by the pinned CUDA 12.8 PyTorch wheels. It installs from
`requirements.lock.txt`, synchronizes the manifest-pinned AnimeVox revision and
runs `api:doctor:strict`.

For development-only tools:

```powershell
npm run api:install:dev
npm run api:doctor
```

Regenerate lock files after changing direct requirements with `npm run api:lock`.
`VOICE_DATASET_REVISION` is an optional override; when empty, voice sync uses the
exact commit SHA stored in `voice_manifest.json`.

Managed release installation runs `scripts/prefetch_models.py` with
`SHIO_MODEL_ROOT` pointing below the launcher's persistent Data directory. It
downloads only the configured commit revisions; `--check` verifies the cache
without network access.

Open `http://localhost:8000` or `http://localhost:8000/docs`.
`127.0.0.1` is the local bind address; `0.0.0.0` means “listen on all interfaces”
and is not a browser URL.
