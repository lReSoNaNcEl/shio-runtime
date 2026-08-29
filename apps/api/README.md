# Python Speech — ASR + CosyVoice 3

Local FastAPI service for speech recognition and continuous cloned-voice synthesis.

## Runtime

- ASR: faster-whisper with Silero VAD.
- TTS: one local CosyVoice 3 engine using `FunAudioLLM/Fun-CosyVoice3-0.5B-2512`.
- Streaming: one logical WebSocket speech session receives incremental text and
  returns continuous mono Float32 PCM.
- Voice references: logical `voiceId` values resolve through
  `voice_manifest.json`; original reference audio and transcripts remain immutable.
- Conditioning: stable derived reference assets are cached below
  `cache/voices/<voiceId>/cosyvoice3/` and keyed by the voice ID, reference hashes,
  and pinned model revision.

The provider-neutral emotion vocabulary is exposed by `/emotions`:

```text
neutral, calm, warm, happy, laugh, chuckle, sad, crying,
angry, fear, surprised, gasp, sigh, groan, whisper
```

CosyVoice-specific delivery instructions stay inside the synthesis adapter.

## API

- `GET /` — local service page.
- `GET /docs` — Swagger UI.
- `GET /health` — service, ASR, and synthesis readiness.
- `GET /voices` — manifest-backed voice presets.
- `GET /emotions` — provider-neutral emotion contract.
- `GET /voices/status` — voice synchronization state.
- `POST /voices/sync` — synchronize configured voice repositories.
- `POST /recognize` — ASR for uploaded audio.
- `WS /ws` — streaming ASR.
- `WS /tts/stream` — incremental text-in and continuous PCM audio-out.

The synthesis socket accepts `start`, ordered `text`, optional `delivery`,
`finish-input`, and `cancel` messages. It emits `ready`, ordered audio metadata
followed by a binary Float32 PCM frame, `finished`, `cancelled`, or a bounded
`error`. Protocol version `1` enforces sequence, input, duration, queue, and
single-session limits.

## Local setup

The canonical environment is `apps/api/.venv`. Run commands from the repository
root:

```powershell
npm run alpha:setup
npm run api:dev
```

The managed setup requires Windows x64, Node.js 24.x, npm 11.x, Python 3.12, and
an NVIDIA GPU supported by the pinned CUDA 12.8 PyTorch wheels. It installs the
locked environment, synchronizes the manifest-pinned voice dataset, prefetches
the exact model/source revisions, and runs the strict doctor.

For development tools:

```powershell
npm run api:install:dev
npm run api:doctor
```

Regenerate lock files after changing direct requirements with `npm run api:lock`.
`VOICE_DATASET_REVISION` is an optional override; when empty, synchronization uses
the exact commit in `voice_manifest.json`.

Managed release installation runs `scripts/prefetch_models.py` with
`SHIO_MODEL_ROOT` below the launcher's persistent Data directory. It downloads
only the pinned runtime artifacts and removes unreferenced assets only from that
explicitly application-owned directory. `--check` validates the cache without
network access, so conversation never triggers a model download.

Open `http://127.0.0.1:8000` or `http://127.0.0.1:8000/docs`.
