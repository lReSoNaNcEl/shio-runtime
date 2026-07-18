# AGENTS.md

Developer operating manual for all AI agents working on this monorepository.

This document is mandatory reading before any code change. It is the single
canonical agent manual and holds both repository-wide and application-specific
rules.

## 1. Repository

- `apps/desktop` — Electron, React, TypeScript, Three.js client.
- `services/api` — Python, FastAPI, ASR and TTS service (port `8000`).
- `ARCHITECTURE.md` is the canonical architecture document.

## Desktop application rules

`apps/desktop` is the Electron + React + TypeScript + Three.js client.

Architecture and ownership:

- Controller coordinates existing Runtimes but does not absorb their ownership.
- AudioPlayer is the sole audio playback owner.
- AvatarExpressionMixer is the sole final facial-expression writer. Do not write
  to VRM facial expressions outside the mixer.
- Overlay is a presentation consumer, not an application Runtime.
- Character State is the single source of truth for character state.
- Project Awareness Runtime belongs to the Electron main process. GitHub access,
  SQLite/FTS indexing, source filtering, and grounded project retrieval must not
  move into the renderer.
- Project repository access remains read-only. Repository-derived knowledge is
  neither Character State nor conversational memory.
- GitHub credentials entered through Settings are encrypted through Electron
  `safeStorage` and persisted only below application `userData`. Renderer status
  may expose credential presence and source, never its value.
- Repository and branch are selected through the Project settings UI. Do not
  hardcode a repository identity in the renderer or Runtime implementation.
- Preserve the existing HTTP contract with `services/api` unless the task
  explicitly changes it.

Desktop quality and validation:

- Desktop formatting, linting, React checks, and import ordering are owned by
  Biome through `apps/desktop/biome.jsonc` and the local `@biomejs/biome`
  dependency.
- Run `npm run desktop:check`, `npm run desktop:format:check`, and
  `npm run desktop:imports:check` from the repository root as applicable.
- TypeScript types are owned by `tsc`; run `npm run typecheck`.
- Run `npm run build` before the final report for Desktop code changes.
- Every new user-facing UI string must be added in both Russian and English.
  A Work Item that leaves either locale missing is incomplete.
- Do not add ESLint or Prettier alongside Biome.
- Prefer a justified single-line `// biome-ignore lint/<rule>: <reason>` (or the
  CSS block form) over disabling a rule. Never add blanket suppressions.
- When live validation is explicitly requested for Electron main, preload, or
  renderer changes, rebuild, restart Electron, and confirm the client starts.
- When live validation is explicitly requested after Avatar Runtime changes,
  verify VRM loading, idle animation, `loadAnimation`, Debug Preview, Speaking,
  LipSync, Overlay, absence of A-pose, and Runtime Health. Animation Runtime
  changes additionally require idle, speaking, transitions, and preview checks.

## API service rules

`services/api` is the FastAPI service that owns ASR and F5-TTS.

Architecture and ownership:

- The API service owns speech recognition and synthesis.
- It does not own Electron playback, LipSync, or avatar state; those belong to
  `apps/desktop`.
- Preserve the existing HTTP API unless the task explicitly changes the contract.
- Resolve service assets relative to the service root using `Path(__file__)` /
  `services/api`, never from the monorepo working directory.
- FastAPI runs on port `8000`. ASR uses faster-whisper with Silero VAD. TTS uses
  one in-process `F5LocalEngine` wrapping `f5_tts.api.F5TTS`.
- `/synthesize` returns WAV plus engine, language, emotion, VRM-emotion, latency,
  RTF, and duration headers.
- `/voices` exposes voice presets, available references, and VRM expression
  mappings.

API commands and validation:

- Run API commands from the repository root. The `api:*` launcher resolves
  `services/api/.venv` or the legacy `services/api/venv`; manual activation and
  `cd services/api` are unnecessary.
- Override the interpreter with `SHIO_API_PYTHON` when needed and inspect the
  selected interpreter with `npm run api:doctor`.
- `npm run api:install:dev` creates `.venv` and installs runtime and development
  dependencies.
- `npm run api:dev` starts uvicorn on port `8000`; extra arguments pass through
  after `--`.
- Run `npm run api:lint`, `npm run api:format:check`, and `npm run api:test`.
- Do not rely on `py_compile` alone. Applicable endpoint validation covers
  `/health`, `/voices`, `/emotions`, `/synthesize`, and `/recognize`; synthesis
  validation must confirm that an actual WAV is produced.
- `/health` must report `engines.f5.mode` as `real` for a real-engine endpoint
  check.

Voice registry and references:

- LLM output should use a single leading normalized emotion tag where possible.
  Supported tags are `neutral`, `calm`, `warm`, `happy`, `laugh`, `chuckle`,
  `sad`, `crying`, `angry`, `fear`, `surprised`, `gasp`, `sigh`, `groan`, and
  `whisper`.
- `app/tts/emotion.py` removes normalized emotion tags and maps them to TTS
  emotions and VRM expression weights.
- `app/tts/voice_registry.py` is the voice-registry owner and resolves logical
  voice IDs to F5 reference audio.
- Reference assets use
  `voices/<dataset>/<voice>/reference.wav` with an adjacent `reference.txt`.
- A voice is available only when both reference files exist.
- Reference assets are not committed. Fetch them with
  `python scripts/sync_voices.py` or `npm run api:voices:sync`.
- Both commands reuse `voice_repository_manager.sync()`, the same path as
  `POST /voices/sync`.
- Voice sync must remain single-flight, revision-pinnable, validated, and atomic;
  interrupted downloads must not produce a partially available voice.
- Confirm `voice_manifest.json` and reference assets resolve from `services/api`.
- Server-side F5 knobs remain in `.env`: `F5_NFE_STEP`, `F5_CFG_STRENGTH`, and
  `F5_USE_ACCENT`.
- Never commit model caches, secrets, generated audio, or the local virtual
  environment.

## 2. Architectural boundaries

- Desktop and API are independent applications.
- They communicate only through the HTTP API contract.
- Desktop must not import or read API implementation files directly.
- API must not depend on Desktop source code.
- Do not merge their runtime lifecycles.
- Do not change runtime ownership or move responsibility between components
  without first rereading `ARCHITECTURE.md`.

Before any architecture-related change, reread `ARCHITECTURE.md`. If a change touches
runtime boundaries or the Desktop–API contract, the final report must include an
`Architecture Review` section stating either that there is no conflict, or describing
the conflict found.

## 3. Behavior-preserving work

If a task is described as refactoring, cleanup, decomposition, or extraction, the
change must be fully behavior-preserving. Do not change, as a side effect:
algorithms, timings, UX, character behavior, API contracts, or runtime semantics.

Do not change architecture and behavior in the same Work Item.

## 4. Minimal changes

Prefer the smallest safe fix. Do not rewrite half of the project. If the task can be
completed by changing one file, do not change twelve. Do not perform unrelated
refactoring. Do not add abstractions "for the future" without a current need.

## 5. Single source of truth

Do not create a second source of truth. If the data already exists, use the existing
source. Examples: animation manifest, emotion manifest, voice manifest, runtime
config, Character State. Character State remains the single source of truth for
character state.

## 6. Git and secrets policy

- Do not push, force-push, or rewrite Git history unless explicitly requested.
- Do not modify files outside this repository, and do not touch the standalone
  backups `D:\Web\vtuber-app` and `D:\Web\python-speech`.
- Never commit `.env`, credentials, model caches, virtual environments, generated
  audio, or build output.

## 7. Validation

Do not automatically run the full validation suite after every edit. During
uncommitted work, run only the focused checks that are useful for the change at
hand. Run the full validation suite for the affected application (defined above)
immediately before staging or creating a commit. All commands run
from the repository root and need no manual virtualenv activation:

```text
npm run desktop:check
npm run desktop:format:check
npm run desktop:imports:check
npm run api:lint
npm run api:format:check
npm run api:test
npm run api:dev
npm run typecheck
npm run build
```

Desktop lint/format/import ordering is owned by Biome (`apps/desktop/biome.jsonc`,
installed only in `apps/desktop`); the Python API uses Ruff; TypeScript types use
`tsc`. Do not add Biome to `services/api`, and do not run Biome over Python.

- Before committing Desktop changes → `npm run desktop:check`, the desktop build,
  typecheck, and applicable repro tests.
- Before committing API changes → `npm run api:lint`, `npm run api:test`, plus the
  applicable endpoint checks.
- Before committing cross-boundary changes → validate both applications and run an
  integration smoke test.

If a check run for the current work cannot be completed, say so explicitly in the
final report. A commit must not be created if its required validation has not passed.

Do not launch the application or run a live smoke test unless the user explicitly
requests live validation for the current Work Item. Static checks, builds, typechecks,
and focused automated repro tests remain required where applicable. When live validation
was not requested, state this directly in the final report; its absence does not block
a commit.

## 8. Do not hide errors

If something was not checked, say it directly (e.g. "Не проверял live. Проверил только
build.", "Не смог воспроизвести."). Do not pretend a problem is solved only because
compilation passed. Confirm fixes in the live runtime when the bug is runtime-visible
and the user explicitly requested live validation.

## 9. RCA for bug fixes

Before changing code for a bug, determine: observed behavior, root cause, why the
previous fix failed, and why the new fix works. Collect evidence first — logs,
telemetry, repro steps, or runtime observations. Do not write "предположительно"
without verification.

## 10. Do not remove debug facilities

Unless the task explicitly requires it, do not remove or weaken telemetry,
diagnostics, debug state, or Runtime Health surfaces. They are part of
maintainability.

## 11. Documentation

If a change alters architecture, introduces a new contract, or changes ownership,
update `ARCHITECTURE.md` and the corresponding rules in this manual when needed.

`ARCHITECTURE.md` is the single canonical architecture document and the sole source
of architectural meaning. When editing it, editorial improvements are allowed —
restructuring, reordering, removing duplication, unifying terminology, consolidating
each concept into exactly one primary definition, adding cross-references, and
normalizing headings, lists, tables, and wording. These edits must never change
architectural meaning: do not introduce concepts absent from the architecture, rename
Runtime names / layers / principles / terminology, add new architectural layers,
reinterpret or extend existing ideas, reassign responsibilities or ownership, or alter
Runtime behavior, contracts, boundaries, or guarantees. Whenever editorial convenience
conflicts with architectural accuracy, architectural accuracy takes precedence.

This restriction applies to editorial work only: an editorial edit must not silently
change an architectural decision. It does not freeze the architecture. When
`ARCHITECTURE.md` is confirmed to diverge from the actual architecture, that divergence
must be fixed — but as a separate, deliberate change that explicitly records what was
stale, why, and what the corrected decision is (not smuggled in under an editorial or
refactoring task). Keeping a known-outdated statement in place is itself a defect.

## 12. Final report format

Every Work Item must end with this format. Do not omit sections; if a section does
not apply, write `N/A`.

```text
Architecture Review

Что изменено

Root Cause (если был баг)

Почему фикс работает

Файлы

Проверки

Ограничения
```

## 13. General principles

- Simple solutions are preferred over complex ones.
- Preserve component boundaries and Single Responsibility.
- Changes must improve maintainability, not only solve the immediate task.
- All responses to the user, and all reasoning shown to the user, must be written
  in Russian.

## 14. Never Again

Known mistakes and risks — do not repeat them.

- Always reread `ARCHITECTURE.md` before architecture changes.
- When the user explicitly requests live validation after refactoring, do not stop at
  a passing build; run the required live smoke test when runtime behavior is involved.
- Do not move helper methods without checking all call sites.
- Do not change architecture and behavior in the same Work Item.
- When fixing bugs, collect evidence first.
- Do not consider a problem solved only because compilation succeeds.
- Do not silently remove or weaken debug, telemetry, diagnostics, or Runtime Health.
