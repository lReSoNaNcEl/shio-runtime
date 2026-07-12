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
- `GET /health` - service status with `engines.f5`.
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
npm run api:install:dev
npm run api:doctor
npm run api:dev
```

For the default Windows CUDA mode, install matching wheels explicitly after creating
the environment:

```powershell
services\api\.venv\Scripts\python.exe -m pip install --force-reinstall --no-deps "torch==2.11.0+cu128" "torchaudio==2.11.0+cu128" --index-url https://download.pytorch.org/whl/cu128
```

Open `http://localhost:8000` or `http://localhost:8000/docs`.
`127.0.0.1` is the local bind address; `0.0.0.0` means “listen on all interfaces”
and is not a browser URL.
