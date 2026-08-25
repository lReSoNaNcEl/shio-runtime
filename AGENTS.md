# AGENTS.md

Developer operating manual for all AI agents working on this monorepository.

This document is mandatory reading before any code change. It is the single
canonical agent manual and holds both repository-wide and application-specific
rules.

## 1. Repository

- `apps/desktop` — Electron, React, TypeScript, Three.js client.
- `apps/api` — Python, FastAPI, ASR and TTS service (port `8000`).
- `launcher` — release installation and process coordination.
- `scripts` — repository and release tooling.
- `docs` — product, architecture, and release documentation.
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
- Character State mutations use domain-limited writers; do not add a generic
  Character State patch API or let Speech overwrite conversational emotion.
- Controller UI state may hold presentation-only state but may not reconstruct a
  second Character State projection.
- Project Awareness Runtime belongs to the Electron main process. GitHub access,
  SQLite/FTS indexing, source filtering, and grounded project retrieval must not
  move into the renderer.
- Project repository access remains read-only. Repository-derived knowledge is
  neither Character State nor conversational memory.
- GitHub credentials entered through the Project Awareness Plugin UI are encrypted through Electron
  `safeStorage` and persisted only below application `userData`. Renderer status
  may expose credential presence and source, never its value.
- Repository and branch are selected through the Project Awareness Plugin UI. Do not
  hardcode a repository identity in the renderer or Runtime implementation.
- Plugins v1 are bundled first-party only.
- No dynamic external JavaScript loading is allowed for Plugins.
- Plugin enablement never grants authority outside the capabilities declared by
  the validated Plugin manifest.
- Plugin dependencies are declared and resolved only through typed capabilities.
  An enabled Plugin with an unavailable requirement registers no capabilities;
  dependency appearance or disappearance is reconciled live without restart.
- Every externally authoritative side effect passes through Action Runtime,
  including side effects requested through Plugins or delegated automation.
- Electron Main composition owns Action Runtime and application services. IPC
  handlers authorize, validate, and delegate; they do not construct business
  runtimes or model LLM, ASR, TTS, health, retrieval, internal Memory, or ordinary
  application configuration changes as Actions.
- Do not equate Adapter execution success with verified action success. Action
  verification belongs to Action Runtime; Adapters return bounded evidence and do
  not decide semantic success.
- Full Control may skip confirmation according to Permission Guard policy, but it
  never bypasses validation, execution tracking, verification, cancellation, or
  Action logging.
- Never automatically retry a potentially non-idempotent mutation. Every recovery
  side effect is a new Action Runtime action and passes through the same validation
  and permission boundary.
- External side effects exposed by a Plugin still pass through Action Runtime.
- Plugin-specific external technologies remain Adapters.
- Plugin failure must not break Core.
- Core must run with every optional Plugin disabled.
- Do not add generic `plugin.invoke` or arbitrary Plugin method dispatch.
- Plugin renderer UI follows React Spectrum 2.
- Every new Plugin UI string must be added in both Russian and English.
- Every Plugin IPC endpoint requires sender authorization and runtime payload
  validation.
- Character LLM must never infer current Plugin availability from static prompt
  text. Current Plugin and capability state comes only from Runtime Capability
  Context resolved for the current turn.
- Character requests are composed through the bounded Character Request Composer.
  Normal turns receive compact capability availability, one foreground goal plus an
  unfinished count, and only a few relevant Mood, Relationship, Habit, and World
  projections. Do not dump complete capability, goal, or Memory stores into every prompt.
- Semantic long-term memory is owned by the main-process Memory Runtime. Character
  LLM decides semantically when typed Memory tools are relevant; do not add
  phrase-, keyword-, regex-, or locale-dictionary Memory intent parsers.
- Memory Tool Broker validates model-produced typed operations and delegates them
  to Memory Runtime and Memory Policy. The Character LLM never receives SQL,
  database paths, filesystem authority, or direct storage access.
- Memory tools are internal Core capabilities and do not pass through Action
  Runtime. Long-term records are not Character State, Project Awareness,
  Browser Context, Screen Context, or raw conversation transcript.
- Semantic Memory v1 persists only when the user semantically and explicitly asks
  to remember, update, or forget. Implicit durable-fact capture and Smart Memory
  remain prohibited. Smart Habits may observe only typed runtime-confirmed events,
  require repeated evidence, and remain a pending suggestion until the user
  explicitly approves or rejects them; they never silently create Memory records.
- World Context, Scheduler, Persistent Goals, Autonomy Envelope, Smart Habits, and
  latency aggregation are owned by Electron Main. Renderer reports to these owners
  use typed, runtime-validated IPC and may expose only bounded activity metadata,
  never raw screen, DOM, transcript, prompt, reply, tool payload, or credentials.
- OS-specific foreground and global-idle collection stays behind the Main-owned
  SystemContextAdapter. World Context is present-state metadata, never a keylogger,
  clipboard/browser-history archive, continuous screenshot stream, or ambient transcript.
- Persistent Goals enter Character Response Generation only through the bounded,
  request-scoped Main-owned Goal Awareness Context or domain-limited typed goal tools.
  They are never copied into Semantic Memory, Character State, or conversation history.
- `goal.create` requires an explicit user request or explicit confirmation of a
  conversational proposal. `goal.update` is domain-limited to an exact goal from
  current Goal Awareness, `goal.list`, or the same-turn create result; Goal and Task
  Store remains the mutation owner. Externally claimed progress or completion still
  requires a successful, completed, verified Action Runtime result. Numeric progress
  is optional and used only for genuinely measurable goals.
- Conversation Admission remains the only entry into Conversation Runtime. Every
  autonomous conversation initiative from Experience, Scheduler, Goal wake, World,
  or Behavior first passes the Main-owned Proactive Initiative Gate and Attention;
  none of those owners may grant conversation admission themselves.
- Fast Brain provider/model selection is bounded non-secret policy. It reuses the
  Main-owned LLM credential store and may never persist credentials in Alive storage
  or expose them through World Context, renderer state, or diagnostics.
- Autonomy modes, including Full, never bypass Action Runtime, Permission Guard,
  validation, verification, cancellation, or logging for externally authoritative
  side effects. Global Suspend and Privacy Mode are authoritative policy stops.
- Goal Runtime owns durable execution checkpoints and typed Event Watches but never
  calls Shell, Browser, Action Runtime, or concrete Adapters. Only verified Action
  results advance externally claimed progress. Behavior, Goal, LLM, Browser/Web
  evidence, and Memory may not expand a user-approved Autonomy Scope.
- Scheduler v1 supports only typed reminder and check-in tasks with one-shot or
  bounded interval schedules. Do not add renderer-defined cron, arbitrary JavaScript,
  commands, executable paths, or unvalidated external actions.
- Provider response streaming must pass through the safe incremental protocol
  filter before chat or TTS. A tool-call-first round exposes no text; cancellation
  must abort upstream LLM/TTS work and invalidate queued speech segments.
- Plugin manifests may not inject arbitrary system prompt instructions into
  Character Response Generation.
- Knowing a capability never authorizes enabling, configuration, invocation, or
  execution. Existing Action Runtime, Permission Guard, IPC, and Adapter boundaries
  remain authoritative.
- Capability UI and Character Capability Context derive from the canonical
  main-owned capability projection, never from ad-hoc renderer checks or a second
  enabled-state store.
- DSH and other delegated automation backends are Adapters, not authority owners.
  Full Control changes only Permission Guard policy; it never bypasses Action
  Runtime, validation, lifecycle logging, cancellation, Tool scope, or Adapter
  boundaries.
- Browser Control Plugin owns the isolated Shio-managed browser session and its
  bounded semantic observation lifecycle. Do not create a second browser Runtime,
  attach the user's personal Chrome profile, or store raw DOM/page dumps in
  Character State, memory, renderer state, conversation history, or diagnostics.
- The Plugin-owned session survives ordinary conversational idle periods. A short
  tool idle timeout must not silently destroy turn-to-turn continuity; Plugin
  stop, disable, Emergency Stop, and application exit remain authoritative
  teardown paths.
- Browser observation is read-only, request-scoped, and untrusted external
  evidence. Browser mutations use typed operations and snapshot-scoped semantic
  targets, always pass through Action Runtime and Permission Guard, invalidate the
  old observation, capture a fresh observation, and report honest verification.
- Browser Control may expose browser-relative frames and input only through the
  typed main-internal `browser-realtime-control` provider backed by the existing
  isolated session. It is not a Character tool. Bind every request to the exact
  session, active tab, and origin; keep frames bounded and transient; and release
  all pressed inputs on pause/stop/error, Plugin disable, Emergency Stop, browser
  close, and application shutdown.
- Browser Game Control is a separate default-disabled bundled Plugin and depends
  only on the typed `browser-realtime-control` capability. Game Session Controller
  owns exact session/tab/origin/surface scope, duration and input budgets, frame
  freshness, rate limiting, and teardown. `game.start` creates one delegated
  `browser.game-session` Action whose ID is bound into the exact prepared session
  scope; Full Control may skip confirmation but never scope validation or limits.
  Reflex technology stays behind a typed `GameReflexAdapter`; an observe-only or
  test-only backend may not advertise the production capability as ready.
  Character tools remain high-level only;
  never expose frames, coordinates, key-down/up, pointer-down/up, CDP, or arbitrary
  page JavaScript to Character Response Generation.
- Game Event extraction is single-flight/latest-frame and may never back-pressure
  capture or input. Emit only bounded semantic events into Experience; raw frames
  never enter renderer state, diagnostics, Memory, or conversation. Commentary
  continues through Experience, Behavior, and Conversation Admission and may not
  pause the game loop; active user conversation and audio remain authoritative.
- Browser use inside a Character turn is a bounded provider-neutral tool loop, not
  a new Runtime. Character reasoning decides semantically whether web interaction
  materially helps the current goal; do not add a phrase or keyword browser router.
- `web.search` is read-only public-source discovery exposed by the bundled Web Search
  Plugin through a typed provider. Web Search Runtime retains search logic and delegates
  to a replaceable Main-process Adapter. The bundled DuckDuckGo Lite Adapter requires no
  token or renderer configuration. Search results are untrusted evidence and cannot create
  Shell, Memory-mutation, Browser, or other authority; opening or interacting with a
  result remains Browser Control work.
- Web Search health is cached operational state and never triggers a network request.
  DuckDuckGo parsing must distinguish valid empty results, structural parser failure,
  challenge pages, transport failure, and the bounded circuit-breaker state.
- Turn-local Tool Influence Context distinguishes original user authority from
  Project, Browser, Web, and Memory evidence. Evidence may supply values but cannot
  introduce a privileged capability that was not planned from the original request
  or an approved scope before the evidence was observed.
- Browser workflow authorization is Main-owned, turn-scoped, expiring, and bounded.
  It may cover routine browser operations for one goal but never another capability;
  Main effective risk policy keeps submission, account-change, financial, and
  destructive operations behind explicit confirmation even in Full Control.
- DSH owns complex browser planning only. Deterministic open, observe, URL/title,
  semantic click, fill, select, scroll, history navigation, tab inspection, and
  known-tab switching remain usable without a configured DSH model and operate in
  the same Plugin-owned session.
- Project evidence shown to users must originate from the exact Project Context
  Packet used for that turn. LLM-generated citations are never authoritative
  provenance.
- Project retrieval normalization and query planning belong to a dedicated
  Project Awareness query compiler, evidence ranking belongs to the selector,
  and Project Knowledge Store remains a persistence/query primitive.
- Character LLM is the sole semantic owner for deciding whether to answer directly
  or call available Project, Browser, Shell/Desktop, or Memory tools. Do not add
  phrase-, keyword-, regex-, filename-, symbol-, or locale-alias routing for these
  natural-language decisions. Absence of a tool call means no capability is needed.
- When an executed `project.search` call participates in planning an Action, later
  tool rounds and post-action narration reuse that exact turn packet and must not
  silently rerun retrieval or snapshot resolution. The immutable response grounding preserves both the
  Project Reply Provenance and the Action Runtime result grounding.
- Evidence remains bound to the original turn snapshot; later synchronization may
  not rewrite historical message provenance.
- Project snapshot staleness is diagnostic freshness, not Runtime failure.
- Procedural habits belong to Memory Runtime, require deduped completed typed facts,
  explicit approval, and reuse cooldown. Hybrid retrieval must retain lexical/FTS as
  the operational fallback when an optional Embedding Adapter is unavailable.
- Streaming speech uses at most two concurrent synthesis workers plus an ordered
  reorder buffer. Cancellation aborts both workers, queued or prepared audio, and
  pending playback; no later segment may overtake an earlier segment.
- New Project evidence UI uses React Spectrum 2, and every new evidence or Plugin UI
  string is added in both Russian and English.
- Preserve the existing HTTP contract with `apps/api` unless the task
  explicitly changes it.
- The Desktop Speech API endpoint is immutable Main-owned environment configuration:
  `SHIO_SPEECH_API_URL`, defaulting to `http://127.0.0.1:8000`. Renderer-editable
  settings may not persist, mutate, or send an arbitrary endpoint; changing the
  environment requires restarting Desktop.

Desktop UI and UX:

- Build all new or changed Desktop UI/UX with React Spectrum 2
  (`@react-spectrum/s2`). This is mandatory, not a preference.
- Every new or changed Desktop screen must support both the light and dark UI
  themes. Use Spectrum components, Spectrum design tokens, or existing semantic
  application tokens for color, border, elevation, and interaction states; do not
  hardcode theme-specific colors or validate a UI change against only one theme.
- Use React Spectrum 2 components for every available UI primitive, including
  buttons, action buttons, fields, pickers, switches, meters, progress
  indicators, status lights, text, headings, badges, tooltips, dialogs, and
  similar controls. Do not recreate an available Spectrum component with
  vanilla HTML and custom CSS.
- Native HTML elements are allowed only for semantic document structure and
  layout when React Spectrum 2 has no equivalent, for example `section`, `nav`,
  `main`, `div`, and list containers. They must not implement a hand-rolled
  interactive control or imitate Spectrum styling and behavior.
- Prefer React Spectrum 2 component props, Spectrum style macros, and Spectrum
  design tokens before adding custom CSS. Keep custom CSS limited to
  application-specific layout and integration that Spectrum does not provide;
  do not override Spectrum component internals to invent a parallel design
  system.
- When modifying an existing vanilla control, migrate the touched control to
  the appropriate React Spectrum 2 component as part of the same Work Item
  unless no Spectrum equivalent exists. If no equivalent exists, state that
  explicitly in the final report.
- Streamdown and other Markdown presentation libraries may not enable raw unsafe
  HTML, permissive custom protocols, remote content beyond the existing product
  policy, or non-Spectrum interactive controls.

Desktop quality and validation:

- Renderer input is always untrusted. TypeScript types are not runtime
  authorization.
- Every renderer-facing `BrowserWindow` must keep `sandbox`, `webSecurity`, and
  `contextIsolation` enabled, `nodeIntegration` disabled, and unexpected
  navigation/new-window creation denied.
- Presentation-only windows must use a minimal preload and cannot inherit the
  privileged API surface of the main application renderer. Overlay receives only
  presentation projections and strictly necessary presentation commands.
- Every privileged IPC endpoint validates both payload and caller identity. Every
  renderer-to-main handler must also be present in the canonical channel inventory;
  unknown senders and invalid argument tuples are rejected before domain code runs.
- No renderer-controlled filesystem paths cross an IPC boundary. Filesystem
  resources are represented by main-owned opaque handles or validated application
  resources; custom protocols may resolve only explicitly registered bundled assets.
- No renderer may spawn or configure arbitrary child processes. Child-process
  commands, arguments, working directories, environments, and executable paths are
  owned and validated by Electron Main.
- Subprocess environments are explicit and credential-minimal. Do not launch
  application-runtime tools through `npx` or another network-resolving launcher.
  Every owned child process has deterministic shutdown, cancellation, and app-exit
  cleanup.
- Runtime health and support contracts must report explicit owned state. Do not
  infer health from adjacent projections, and mark cached renderer reports stale
  whenever their renderer is not ready.
- Every renderer root has an Error Boundary. Every renderer-facing `BrowserWindow`
  handles `did-fail-load` and `render-process-gone` with bounded recovery and
  exposes the failure in diagnostics.
- Every subscription, DOM/process listener, timer, animation frame, and owned media
  resource has an idempotent teardown path exercised by its owner.
- Every intentionally detached Promise has an explicit rejection observer or is
  implemented by a function whose full body contains and reports all failures.
- Provider control syntax and structured embodiment markers are internal protocol
  data. Malformed markers must be contained before text reaches chat, TTS, memory,
  or other user-visible projections.

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
- Any Electron main, preload, native executable, or subprocess integration change
  requires a live Electron smoke check in addition to static checks and builds.
- When live validation is explicitly requested after Avatar Runtime changes,
  verify VRM loading, idle animation, `loadAnimation`, Debug Preview, Speaking,
  LipSync, Overlay, absence of A-pose, and Runtime Health. Animation Runtime
  changes additionally require idle, speaking, transitions, and preview checks.

## API service rules

`apps/api` is the FastAPI service that owns ASR and F5-TTS.

Architecture and ownership:

- The API service owns speech recognition and synthesis.
- It does not own Electron playback, LipSync, or avatar state; those belong to
  `apps/desktop`.
- Preserve the existing HTTP API unless the task explicitly changes the contract.
- Resolve service assets relative to the service root using `Path(__file__)` /
  `apps/api`, never from the monorepo working directory.
- FastAPI runs on port `8000`. ASR uses faster-whisper with Silero VAD. TTS uses
  one in-process `F5LocalEngine` wrapping `f5_tts.api.F5TTS`.
- `/synthesize` returns WAV plus engine, language, emotion, VRM-emotion, latency,
  RTF, and duration headers.
- `/voices` exposes voice presets, available references, and VRM expression
  mappings.

API commands and validation:

- Run API commands from the repository root. The `api:*` launcher resolves the
  canonical `apps/api/.venv`; environments from previous layouts are diagnostic
  signals only and are never executable fallbacks. Manual activation and
  `cd apps/api` are unnecessary.
- Override the interpreter with `SHIO_API_PYTHON` when needed and inspect the
  selected interpreter with `npm run api:doctor`.
- `npm run api:install:dev` creates `.venv` and installs runtime and development
  dependencies.
- `npm run api:dev` starts uvicorn on port `8000`; extra arguments pass through
  after `--`.
- Repository-owned Ruff invocations set `RUFF_CACHE_DIR` explicitly to
  `apps/api/.ruff_cache`; they must not create `.ruff_cache` in the repository root.
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
- Confirm `voice_manifest.json` and reference assets resolve from `apps/api`.
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
- After merging any non-main working branch into `main`, delete that branch from the remote.
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
`tsc`. Do not add Biome to `apps/api`, and do not run Biome over Python.

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

## 12. Release management

Releases follow Semantic Versioning and advance through explicit maturity
channels. A release version is immutable after its tag has been published.

Release channels:

- **Alpha:** `X.Y.Z-alpha.N`. Early technical prerelease for controlled testing.
  Features and contracts may still change, but every known incompatibility and
  limitation must be documented.
- **Beta:** `X.Y.Z-beta.N`. Feature-complete candidate intended for broader
  testing. New scope should normally wait for a later version; beta work focuses
  on correctness, compatibility, packaging, migration, and usability.
- **Release candidate:** `X.Y.Z-rc.N` when a final qualification stage is useful.
  Only release-blocking fixes are expected.
- **Stable:** `X.Y.Z`. Production release with no prerelease suffix.
- **Stable patch:** increment `Z` (`X.Y.(Z+1)`) for backward-compatible bug,
  security, packaging, or reliability fixes. Do not hide feature releases inside
  a patch increment.

Choose the next version from user-visible compatibility and release maturity, not
from the number of commits. Moving from Alpha to Beta or from Beta/RC to Stable is
a deliberate release decision and must not happen as a side effect of unrelated
work.

### Release sources of truth

Before creating a tag, keep these version-bearing sources synchronized:

- root `package.json`
- `apps/desktop/package.json`
- `launcher/release-manifest.json` (`productVersion` and Speech Pack version)
- `CHANGELOG.md`
- release notes for the selected channel

Desktop artifact names must continue to derive from the Desktop package version.
Do not hand-edit generated artifact names to compensate for mismatched versions.
The channel's version-verification command must pass before staging a release
commit.

`CHANGELOG.md` is the factual history of Added, Changed, Fixed, Security, and
Known Limitations for each version. Release notes are the concise user-facing
summary, requirements, installation path, important limitations, and support
instructions. Do not use release notes as a substitute for the changelog.

### Required release flow

1. Merge the intended release scope into `main`; the worktree must be clean and
   `main` synchronized with `origin/main`.
2. Select the next version and channel explicitly.
3. Update every version source, `CHANGELOG.md`, and the channel release notes.
   Update installation, troubleshooting, architecture, and requirements
   documentation when the release changes those areas.
4. Regenerate and commit lock files when direct dependencies changed.
5. Run the full required validation for every affected application. For a
   Desktop/API bundle, validate both applications and the launcher.
6. Run the channel's manual build workflow first. Download and verify the exact
   workflow artifact for the release commit; do not substitute a local ZIP.
7. By default, perform clean-machine qualification on the supported platform and hardware.
   For the current Windows speech bundle this includes launcher first-run setup,
   repair/doctor behavior, Desktop startup, API health, real ASR/TTS, microphone,
   VRM loading, playback, shutdown, and ownership-safe API cleanup.
   If the user explicitly directs publication after being told which qualification
   remains incomplete, treat that repeated direction as an informed qualification
   waiver and continue. Record every waived check in the release notes and final report.
8. After explicit publication approval or an informed qualification waiver, create an annotated tag matching the
   synchronized version (`vX.Y.Z-alpha.N`, `vX.Y.Z-beta.N`, `vX.Y.Z-rc.N`, or
   `vX.Y.Z`) and push only that tag.
9. Monitor the tag workflow through completion. Verify the GitHub Release channel
   (prerelease versus stable), title, notes, ZIP, checksum files, and downloadable
   asset integrity.
10. Report any qualification not performed. A green CI build does not prove live
    CUDA, model inference, microphone, avatar, or end-to-end behavior.

Tagging and publishing change external release state. Do them only when the user
explicitly asks to release or publish; a request to prepare a release alone does
not authorize pushing a tag. Once automated validation and exact-artifact
verification pass, an explicit direction to publish must not be blocked solely
because live qualification is incomplete when the user has already been informed
of that gap.

Never move, force-update, or reuse a published tag. If a release is defective,
record the problem, fix it on `main`, increment the appropriate prerelease or
patch version, qualify a new artifact, and publish a new tag. Removing a broken
release page does not make its old tag/version reusable.

### Current automation boundary

The repository currently automates only Windows Alpha releases:

- workflow: `.github/workflows/release-alpha.yml`
- accepted tags: `v*.*.*-alpha.*`
- release type: GitHub prerelease
- operational guide: `docs/ALPHA-RELEASE.md`

Do not claim that Beta, RC, or Stable publication is implemented today. Before
the first release in one of those channels, create a separate Work Item that
deliberately generalizes or adds:

- tag validation and workflow triggers for the new channel
- channel-appropriate artifact and documentation names
- prerelease/stable GitHub Release behavior
- version commands that are no longer Alpha-specific
- clean-machine qualification criteria and rollback instructions

The new channel must preserve the existing Desktop/API boundary and must be
validated with a dry-run artifact before its first publication.

## 13. Final report format

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

## 14. General principles

- Simple solutions are preferred over complex ones.
- Preserve component boundaries and Single Responsibility.
- Changes must improve maintainability, not only solve the immediate task.
- All responses to the user, and all reasoning shown to the user, must be written
  in Russian.

## 15. Never Again

Known mistakes and risks — do not repeat them.

- Always reread `ARCHITECTURE.md` before architecture changes.
- When the user explicitly requests live validation after refactoring, do not stop at
  a passing build; run the required live smoke test when runtime behavior is involved.
- Do not move helper methods without checking all call sites.
- Do not change architecture and behavior in the same Work Item.
- When fixing bugs, collect evidence first.
- Do not consider a problem solved only because compilation succeeds.
- Do not silently remove or weaken debug, telemetry, diagnostics, or Runtime Health.
