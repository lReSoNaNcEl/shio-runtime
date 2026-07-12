# Shio Runtime

Desktop AI character runtime with a local ASR/TTS service.

The repository contains two independent applications:

- `apps/desktop` — Electron desktop client;
- `services/api` — local FastAPI service for speech recognition and synthesis.

They communicate only through an HTTP API. Neither application imports or directly
reads the implementation files of the other. See [ARCHITECTURE.md](./ARCHITECTURE.md)
and [AGENTS.md](./AGENTS.md).

## Repository layout

```text
shio-runtime/
├─ apps/
│  └─ desktop/          Electron + React + Three.js client
├─ services/
│  └─ api/              FastAPI ASR/TTS service (faster-whisper + Silero VAD + F5-TTS)
├─ scripts/             Repository-level scripts
├─ ARCHITECTURE.md      Canonical architecture document
├─ AGENTS.md            Instructions for coding agents
└─ package.json         Root command orchestration
```

## Requirements

- Node.js 24.x
- npm 11.x
- Python 3.12
- CUDA-capable GPU recommended (F5-TTS and faster-whisper default to CUDA)
- PowerShell examples below assume Windows

Developed with:

```text
Node.js 24.10.0
npm 11.6.1
Python 3.12.10
PyTorch CUDA 12.8
```

CPU mode is supported through the API configuration, but ASR and TTS will be
significantly slower. To use it, set in `services/api/.env`:

```text
DEVICE=cpu
ASR_PROVIDER=cpu
```

## Quick start

### 1. Install Desktop dependencies

Run from the repository root:

```powershell
npm run desktop:install
```

### 2. Create the API virtual environment

```powershell
cd services\api

python -m venv venv
.\venv\Scripts\Activate.ps1

pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu128
pip install -r requirements.txt

Copy-Item .env.example .env

cd ..\..
```

The `api:*` npm commands use the active `python` executable from `PATH`. Keep the
virtual environment activated in the terminal where API commands are executed.

### 3. Download voice references

Voice reference files are not stored in Git. After a fresh clone the voices are
missing — `/voices` lists them as `available:false`, and voice-dependent synthesis
is unavailable (the default voice has no reference files either) until you fetch them.

With the API virtual environment active, run from the repository root:

```powershell
npm run api:voices:sync
```

The command downloads the configured AnimeVox voice references from Hugging Face into:

```text
services/api/voices/<dataset>/<voice>/
├─ reference.wav
└─ reference.txt
```

Set `HF_TOKEN` in `services/api/.env` when authentication or higher Hugging Face
rate limits are required.

### 4. Start the applications

Use two terminals.

**Terminal 1 — API**

```powershell
cd services\api
.\venv\Scripts\Activate.ps1
cd ..\..

npm run api:dev
```

The API starts at `http://localhost:8000`.

> **First run may be slow.** On the first `api:dev` the F5-TTS model (`F5_MODEL_ID`,
> default `Misha24-10/F5-TTS_RUSSIAN`) and the ASR model are downloaded into the
> Hugging Face cache / `services/api/models/`. These weights are not stored in Git,
> so the first startup can take a while before the service becomes ready.

**Terminal 2 — Desktop**

```powershell
npm run desktop:dev
```

## Root commands

### Desktop

```text
npm run desktop:install
npm run desktop:dev
npm run desktop:build
npm run desktop:preview
npm run desktop:start
npm run desktop:typecheck
```

### API

The API virtual environment must be active.

```text
npm run api:install
npm run api:voices:sync
npm run api:dev
```

### Repository checks

```text
npm run typecheck
npm run build
```

## Configuration

Each application has its own local environment file, created from the included
examples. Local `.env` files are ignored by Git.

```text
apps/desktop/.env       (from apps/desktop/.env.example)
services/api/.env       (from services/api/.env.example)
```

### Desktop → API URL

The Desktop client connects to `http://localhost:8000`. The URL can be overridden
with the environment variable `PYTHON_SPEECH_URL`. Despite its legacy name, it now
points to the service located in `services/api`.

### API host and port

Configured through `HOST` / `PORT` in `services/api/.env` (default `0.0.0.0:8000`).

### Manifests (single source of truth)

- `VOICE_MANIFEST_PATH` — path to the voice manifest
  (`services/api/voice_manifest.json`).
- `EMOTION_MANIFEST_PATH` — path to the emotion manifest
  (`services/api/emotion_manifest.json`).

Both paths are resolved relative to the API working directory.

### Voice dataset revision

Voice synchronization uses the Hugging Face dataset revision `VOICE_DATASET_REVISION`.

```text
VOICE_DATASET_REVISION currently defaults to main.
Set it to a dataset commit SHA for reproducible installations.
```

### F5-TTS model

The TTS engine loads the F5 model from `F5_MODEL_ID`
(default `Misha24-10/F5-TTS_RUSSIAN`). The weights are downloaded on the first API
run and are not committed (see below).

## Files not stored in Git

```text
.env files
API virtual environments
node_modules
build output
F5 model weights and Hugging Face model caches (services/api/models/)
voice reference assets (services/api/voices/**/reference.wav|.txt)
generated and temporary audio
runtime logs
```

After a fresh clone, voice entries may be listed as unavailable until
`npm run api:voices:sync` completes.

## API contract

The Desktop application uses the following API contract:

```text
GET  /health
GET  /voices
GET  /emotions
GET  /voices/status
POST /voices/sync
POST /synthesize
POST /recognize
WS   /ws
```

## API checks

Run from `services/api` with its virtual environment active:

```powershell
ruff check .
python -m pytest tests
```

Then verify the read-only endpoints respond: `/health`, `/voices`, `/emotions`.
Run a short `/synthesize` smoke test only after backend changes (F5 engine, audio
encoding, or synthesis lifecycle).

## Architecture

`apps/desktop` and `services/api` are independently runnable applications. Their
boundary is the HTTP API contract:

```text
Desktop
   │
   │ HTTP / WebSocket
   ▼
API service
```

Desktop must not import API source code or read its internal files. The API must not
depend on Desktop source code or control avatar playback, LipSync or UI state.

See [ARCHITECTURE.md](./ARCHITECTURE.md) and [AGENTS.md](./AGENTS.md).
</content>
</invoke>
