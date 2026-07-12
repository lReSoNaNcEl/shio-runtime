# shio-runtime

Monorepo that organizes two independent applications and their shared documentation.
The root exists **only** to hold canonical docs and to orchestrate the existing
per-project commands — it does not merge the two apps into a monolith.

> **Architecture invariant:** `apps/desktop` and `services/speech` are independent
> applications connected **only** by an HTTP API contract. Desktop never imports
> Speech code (or vice versa), never reads Speech's internal files directly, and the
> two do not share a runtime lifecycle. See [ARCHITECTURE.md](./ARCHITECTURE.md) and
> [AGENTS.md](./AGENTS.md).

## Structure

```
apps/desktop     — Electron + React + Three.js client (VRM avatar, LLM orchestration)
services/speech  — local FastAPI ASR/TTS service (faster-whisper + Silero VAD + F5-TTS)
docs/            — cross-cutting documentation
scripts/         — cross-cutting scripts
ARCHITECTURE.md  — single canonical architecture document
AGENTS.md        — single canonical agent guidance
```

## Requirements

- **Node.js** 24.x (developed with v24.10.0), **npm** 11.x (11.6.1)
- **Python** 3.12 (3.12.10)
- **GPU / CUDA** recommended for Speech. F5-TTS and faster-whisper default to `cuda`
  (`DEVICE=cuda`, `ASR_PROVIDER=cuda`). Install a CUDA build of `torch`/`torchaudio`
  first (e.g. RTX 50xx / Blackwell: `--index-url https://download.pytorch.org/whl/cu128`).
  CPU is possible by setting `DEVICE=cpu` and `ASR_PROVIDER=cpu` but is slow.
- **System deps:** `soundfile` requires libsndfile (bundled in the wheel on Windows).
- **Assets not in Git:** F5-TTS model weights and any Hugging Face model cache are
  downloaded on first run into the HF cache / `services/speech/models/` — not committed.
- **Voice reference assets not in Git:** per-voice reference files
  (`services/speech/voices/<dataset>/<voice>/reference.wav` and `reference.txt`) are
  **intentionally git-ignored** by `services/speech/.gitignore` (inherited from the
  upstream `python-speech` project). They are required runtime inputs for voice cloning
  and are present on disk in this working copy, but are not committed. Re-fetch them into
  a fresh checkout with `POST /voices/sync` (imports AnimeVox references into
  `voices/<dataset>/<voice>/`), or copy them in manually.

## Install

### Desktop

```powershell
npm run desktop:install
```

### Speech

Create and activate a virtual environment **inside `services/speech`** (do not reuse an
old venv), install a CUDA torch build, then the project requirements:

```powershell
cd services\speech
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu128
pip install -r requirements.txt
```

Copy `.env.example` to `.env` in `services/speech` and set `HF_TOKEN` if you use gated
remote voice repositories.

## Run

Use two terminals. Start Speech first, then Desktop.

Terminal 1 — Speech (from repo root, uses the active venv's Python on PATH, or call the
venv uvicorn directly):

```powershell
npm run speech:dev
# equivalent to: cd services\speech && python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Terminal 2 — Desktop:

```powershell
npm run desktop:dev
```

Desktop reaches Speech over HTTP. The base URL defaults to `http://localhost:8000`
(`apps/desktop/src/shared/config.ts`) and is overridable via `PYTHON_SPEECH_URL` in
`apps/desktop/.env`.

## Checks

```powershell
npm run typecheck   # tsc --noEmit in apps/desktop
npm run build       # electron-vite build in apps/desktop
```

Desktop repro harnesses (run from `apps/desktop`, or via root wrappers):

```powershell
npm run desktop:repro:facial
npm run desktop:repro:conversation-single-flight
```

Speech tests / repro (from `services/speech`, venv active):

```powershell
python -m pytest tests
python scripts\f5_long_playback_audit.py
```

## Configuration

- `.env.example` lives in each app: `apps/desktop/.env.example`, `services/speech/.env.example`.
  Copy to `.env` locally; `.env` is git-ignored.
- **Desktop → Speech URL:** `PYTHON_SPEECH_URL` (default `http://localhost:8000`).
- **Speech host/port:** `HOST` / `PORT` in `services/speech/.env` (default `0.0.0.0:8000`).
- **Voice manifest:** `services/speech/voice_manifest.json` (path via `VOICE_MANIFEST_PATH`,
  resolved relative to the Speech working directory).
- **Not in Git:** `.env` files, F5 model weights, HF cache, `services/speech/models/`,
  generated/temporary audio, build output, `node_modules`, virtualenvs. Download models
  on first Speech run; obtain the F5 model from `F5_MODEL_ID` in `.env.example`.

## Speech API contract (unchanged)

`GET /health`, `GET /voices`, `GET /emotions`, `GET /voices/status`,
`POST /voices/sync`, `POST /synthesize`, `POST /recognize`, `WS /ws`.
