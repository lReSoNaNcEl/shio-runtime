> Experimental branch: local Fish Audio S2 Pro streaming + bundled Shio S22 2D. The current setup, contract migration and measured qualification are documented in [docs/EXPERIMENT-FISH-S22.md](docs/EXPERIMENT-FISH-S22.md). Historical release notes describe the published F5/3D release, not this experimental branch.

# Shio Runtime

Desktop AI character runtime with a local ASR/TTS service.

The repository contains two independent applications:

- `apps/desktop` — Electron desktop client;
- `apps/api` — local FastAPI service for speech recognition and synthesis.

They communicate only through an HTTP API. Neither application imports or directly
reads the implementation files of the other. See [ARCHITECTURE.md](./ARCHITECTURE.md)
and [AGENTS.md](./AGENTS.md).

## Repository layout

```text
shio-runtime/
├─ apps/
│  ├─ desktop/          Electron + React + S22 2D application
│  ├─ shio-2d/          Bundled S22 renderer, assets and qualification
│  └─ api/              Python Speech API application
├─ launcher/            Release installation and process coordination
├─ scripts/             Repository and release tooling
├─ docs/                Product, architecture, and release documentation
├─ ARCHITECTURE.md      Canonical architecture document
├─ AGENTS.md            Instructions for coding agents
└─ package.json         Root command orchestration
```

## Desktop features

### Capabilities

Open **Capabilities** in the main sidebar to see what Shio can do right now.
The page distinguishes capabilities that are available, disabled, need setup,
degraded, or unavailable and links to the canonical setting or Plugin owner. It is
a live read-only view: changing Plugin state, credentials, Runtime readiness, or
Full Computer Access updates the page without creating another settings store.

### Plugins

Plugins are bundled first-party optional features with declared capability and
permission boundaries. They can be enabled independently, and disabling one keeps
its configuration and data. Shio Core remains usable with every optional Plugin
disabled. Version 1 does not load third-party JavaScript or provide arbitrary Plugin
method dispatch.

### Desktop Control and Browser Control

The Desktop Control Plugin runs validated, bounded automation workflows through
Action Runtime. Computer Control executes foreground PowerShell commands through
the pinned DSH PowerShell tool. Browser Control is a separate Plugin and the sole
owner of one headed Google Chrome persistent context launched through pinned
`playwright-core`. It uses an isolated browser profile below Shio application data;
it does not reuse the user's normal Chrome profile, cookies, or signed-in sessions.

Desktop Control reuses the active OpenAI-compatible provider, model, and encrypted
API key from Shio Settings through the provider-neutral `dsh-llm-pi-ai` Adapter; it
does not keep a second DSH credential. Browser Control additionally needs a
compatible local Google Chrome installation. The packaged Windows build and
development environment use the exact `playwright-core` version pinned by the
Desktop lockfile. Browser input remains behind Action Runtime and the Plugin's
bounded semantic or Computer Use providers; DSH has no browser ownership.

### Full Computer Access and Emergency Stop

By default, each eligible desktop workflow shows a scope preview and requires
confirmation. **Full Computer Access** is an explicit persisted policy that removes
that per-workflow confirmation after a warning is accepted; validation, Action
Runtime, permission policy, logging, cancellation, and Adapter boundaries still
apply. Turning it off makes the next eligible workflow require confirmation again.

**Emergency Stop** cancels pending and running desktop workflows and shuts down the
owned automation and browser processes. A later action starts a fresh session.

### Chat presentation and diagnostics

Assistant Markdown is rendered by Streamdown only in the Chat presentation layer,
with raw HTML disabled, restricted link/image protocols, safe external navigation,
React Spectrum 2 controls, and escaped-plaintext fallback. Runtime Health reports
technical readiness; Diagnostics exposes bounded Action Runtime and Desktop Control
details without logging credentials or full browser/DOM snapshots.

## Requirements

- Node.js 24.x
- npm 11.x
- Python 3.12
- CUDA-capable GPU required for the qualified Fish S2 Pro configuration; see the experimental guide above
- PowerShell examples below assume Windows

Developed with:

```text
Node.js 24.10.0
npm 11.6.1
Python 3.12.10
PyTorch CUDA 12.8
```

CPU mode is supported through the API configuration, but ASR and TTS will be
significantly slower. To use it, set in `apps/api/.env`:

```text
DEVICE=cpu
ASR_PROVIDER=cpu
```

## Alpha setup

Run on Windows x64 from a fresh clone:

```text
git clone https://github.com/lReSoNaNcEl/shio-runtime.git
cd shio-runtime
npm run desktop:install
npm run alpha:setup
```

`alpha:setup` verifies Node.js 24.x, npm 11.x, Python 3.12 and Windows x64,
creates `apps/api/.env` only when missing, installs the locked CUDA 12.8 API
environment, downloads the pinned voice dataset revision and runs the strict doctor.
It does not install system software and does not start either application.

Start the API:

```powershell
npm run api:dev
```

Desktop alpha testers run `Shio Runtime.exe` from the portable
`Shio-Runtime-0.1.0-alpha.6-win-x64.zip`; `desktop:dev` is not part of the tester
workflow.

## Developer setup

The canonical Python environment is `apps/api/.venv`. For development tooling:

```powershell
npm run api:install:dev
npm run api:doctor
```

The reproducible Windows alpha environment is installed separately:

```powershell
npm run api:install:alpha
npm run api:voices:sync
npm run api:doctor:strict
```

The `api:*` npm commands automatically use the canonical local virtual environment
(`apps/api/.venv`). Environments from the previous layout are detected only to show
migration instructions and are never executed. No manual `activate` is required.
To point the commands at a different interpreter, set
`SHIO_API_PYTHON`. Run `npm run api:doctor` to see which interpreter is selected.

Regenerate dependency locks only when direct dependencies change:

```powershell
npm run api:lock
```

### 3. Download voice references

Voice reference files are not stored in Git. After a fresh clone the voices are
missing — `/voices` lists them as `available:false`, and voice-dependent synthesis
is unavailable (the default voice has no reference files either) until you fetch them.

Run from the repository root:

```powershell
npm run api:voices:sync
```

The command downloads the configured AnimeVox voice references from Hugging Face into:

```text
apps/api/voices/<dataset>/<voice>/
├─ reference.wav
└─ reference.txt
```

Set `HF_TOKEN` in `apps/api/.env` when authentication or higher Hugging Face
rate limits are required.

### 4. Start the applications

Use two terminals.

**Terminal 1 — API**

```powershell
npm run api:dev
```

The API starts at `http://localhost:8000`. Stop it with `Ctrl+C`; the launcher
forwards the signal so uvicorn shuts down and port 8000 is released.

> Run `npm run api:prefetch` before startup to download the pinned Fish and ASR assets.
> The first startup compiles and warms the Fish sampler before reporting readiness.
> Weights and compiler caches are not stored in Git.

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
npm run desktop:check
npm run desktop:check:fix
npm run desktop:lint
npm run desktop:format
npm run desktop:format:check
npm run desktop:imports:check
```

Desktop code quality is owned by [Biome](https://biomejs.dev)
(`apps/desktop/biome.jsonc`): it handles JS/TS/JSX formatting,
linting, React checks, and import ordering. `npm run desktop:check` runs
formatter, linter, and import sorting together; `desktop:check:fix` applies the
safe fixes. Tooling ownership across the monorepo:

- Desktop (`apps/desktop`) → Biome
- API (`apps/api`, Python) → Ruff
- TypeScript types → `tsc` (`npm run desktop:typecheck`)

### API

No manual virtualenv activation is required — every command resolves the local
interpreter automatically.

```text
npm run api:install
npm run api:install:dev
npm run api:install:alpha
npm run api:voices:sync
npm run api:dev
npm run api:start
npm run api:prefetch
npm run api:lint
npm run api:lint:fix
npm run api:format
npm run api:format:check
npm run api:test
npm run api:doctor
npm run api:doctor:strict
npm run api:lock
npm run alpha:setup
```

Repository-owned Ruff commands explicitly set `RUFF_CACHE_DIR` to
`apps/api/.ruff_cache`, including when they are launched from the repository root.

On macOS the same commands apply, e.g.:

```bash
npm run api:install:dev
npm run api:voices:sync
npm run api:dev
```

Optional manual activation (only for working with Python directly) still works:

```bash
source apps/api/.venv/bin/activate
```

```powershell
apps\api\.venv\Scripts\Activate.ps1
```

### Repository (aggregated)

These root commands fan out across both applications:

```text
npm run check         # lint + format:check + typecheck + test (no autofix)
npm run lint          # desktop:lint + api:lint
npm run lint:fix      # desktop:lint:fix + api:lint:fix
npm run format        # desktop:format + api:format
npm run format:check  # desktop:format:check + api:format:check
npm run typecheck     # desktop:typecheck
npm run test          # api:test
npm run build         # desktop:build (kept separate from check; heavier)
```

`npm run check` is the safe static gate (no autofixes); run `npm run build`
separately when a production Desktop build is needed.

### Repository checks (per application)

```text
npm run desktop:check
npm run desktop:format:check
npm run desktop:imports:check
npm run api:lint
npm run api:format:check
npm run api:test
npm run typecheck
npm run build
```

## Configuration

Each application has its own local environment file, created from the included
examples. Local `.env` files are ignored by Git.

```text
apps/desktop/.env       (from apps/desktop/.env.example)
apps/api/.env       (from apps/api/.env.example)
```

### Desktop → API URL

The Desktop client connects to `http://localhost:8000`. The URL can be overridden
with the environment variable `PYTHON_SPEECH_URL`. Despite its legacy name, it now
points to the service located in `apps/api`.

### API host and port

The launcher uses `SHIO_API_HOST` / `SHIO_API_PORT` and defaults to
`127.0.0.1:8000`. `http://localhost:8000` is the browser URL. Use
`SHIO_API_HOST=0.0.0.0` only for an intentional LAN, Docker, or VM bind:

```powershell
$env:SHIO_API_HOST = "0.0.0.0"
npm run api:dev
```

`127.0.0.1` is the local bind address; `0.0.0.0` means “listen on all interfaces”
and is not a browser URL.

### Manifests (single source of truth)

- `VOICE_MANIFEST_PATH` — path to the voice manifest
  (`apps/api/voice_manifest.json`).
- `EMOTION_MANIFEST_PATH` — path to the emotion manifest
  (`apps/api/emotion_manifest.json`).

Both paths are resolved relative to the API working directory.

### Voice dataset revision

The repository-owned AnimeVox revision is pinned to an exact commit in
`apps/api/voice_manifest.json`. `VOICE_DATASET_REVISION` is only an optional
environment override.

```text
VOICE_DATASET_REVISION=
```

### Fish Audio S2 Pro model

The local TTS engine uses `fishaudio/s2-pro`, with immutable source/model revisions.
Prepare its weights with `npm run api:prefetch`; see the experiment guide for pins,
GPU requirements, streaming protocol and measured performance.

## Files not stored in Git

```text
.env files
API virtual environments
node_modules
build output
Fish/ASR model weights and Hugging Face model caches (apps/api/models/)
voice reference assets (apps/api/voices/**/reference.wav|.txt)
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
WS   /tts/stream
POST /tts/warmup
POST /recognize
WS   /ws
```

## API checks

Run from the repository root (no activation required):

```powershell
npm run api:lint
npm run api:test
```

Then verify the read-only endpoints respond: `/health`, `/voices`, `/emotions`.
Verify ordered binary PCM, first-packet latency, delivery cues and cancellation
through `/tts/stream` after changing synthesis or its transport.

## Architecture

`apps/desktop` and `apps/api` are independently runnable applications. Their
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

See [ARCHITECTURE.md](./ARCHITECTURE.md), [Alive & Autonomous v1](./docs/ALIVE-AUTONOMY.md),
[AGENTS.md](./AGENTS.md), and the [third-party license inventory](./THIRD_PARTY_NOTICES.md).
