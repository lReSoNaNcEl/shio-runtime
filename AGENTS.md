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
- `ARCHITECTURE.md` is the protected canonical architecture consolidation;
  original architecture documents remain authoritative for architectural meaning
  under the Shio Runtime Documentation Editing Policy.

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
  projections. Context allocation reserves a bounded minimum for every present section
  before distributing the remainder by priority tier; never restore sequential
  first-come allocation that can starve lower sections. Do not dump complete capability,
  goal, or Memory stores into every prompt.
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
- Mood may only modulate bounded Behavior thresholds, deterministic initiative versus
  nonverbal selection, semantic embodiment intensity, banter allowance, and cooldowns.
  Mood never generates text, writes Avatar state, bypasses proactive policy, or grants
  capability authority.
- Experience Policy remains the deterministic appraisal authority. Contextual
  modifiers may consume only bounded recent-event, Mood, exact Goal owner/derived
  importance, numeric Relationship, and approved-motif-count projections. They never
  interpret Goal, Relationship, or habit text as instructions, and an optional model
  nuance scorer may not replace base appraisal or expand authority.
- Fast Brain provider/model selection is bounded non-secret policy. It reuses the
  Main-owned LLM credential store and may never persist credentials in Alive storage
  or expose them through World Context, renderer state, or diagnostics. Fast Brain
  accepts only exact JSON through a strict typed result schema, and every model call
  receives caller cancellation. Candidate expiry, continuous-listening/session reset,
  and Alive Runtime shutdown abort actual provider work; a late result is discarded.
- Autonomy modes, including Full, never bypass Action Runtime, Permission Guard,
  validation, verification, cancellation, or logging for externally authoritative
  side effects. Global Suspend and Privacy Mode are authoritative policy stops.
- Goal Runtime owns durable execution checkpoints and typed Event Watches but never
  calls Shell, Browser, Action Runtime, or concrete Adapters. Only verified Action
  results advance externally claimed progress. Numeric progress carries a typed basis:
  verified and ordinary user-reported progress are monotonic, while only an explicit
  user correction may move backward. A verified Action result does not complete a
  logical goal step unless its durable GoalStepOutcome explicitly says that the step
  expectation is satisfied and the step is complete. Behavior, Goal, LLM, Browser/Web
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
- Browser Control Plugin is the single owner of the isolated Shio-managed Google Chrome persistent context. It uses pinned `playwright-core`, never attaches the user's personal Chrome profile, and must not create a second browser daemon, MCP bridge, or browser Runtime.
- Browser Control owns both typed `browser-control` and `browser-computer-use` capabilities over the same context, pages, observations, and profile. Deterministic semantic operations remain available without a visual model.
- Generic Browser Computer Use is one bounded delegated session coordinated at two frequencies: the existing slow `Observe → Decide → Act → Observe` path plus at most one Main-owned fast reactive lane driven by strict, expiring visual plans. Character tools remain high-level only: `browser.use`, `browser.useStatus`, `browser.usePause`, `browser.useResume`, and `browser.useStop`. Never expose screenshots, anchors, coordinates, pointer/key down or up, drag paths, CDP, or arbitrary page JavaScript to Character Response Generation.
- `browser.use` creates one delegated Action Runtime action scoped by exact goal, typed termination, and a Main-owned hard duration budget. Goal mode also uses maximum steps/actions; continuous modes do not reinterpret those counters as user-requested termination. Full Control may skip confirmation according to policy but never bypasses validation, scope, lifecycle logging, budgets, cancellation, verification, blockers, or input release. Pause, resume, and stop use the registered `browser.use-control` Action path.
- Continuous Browser Computer Use must reuse the same Browser Control-owned Playwright context and page. CDP screencast/input is an internal Adapter path only; ACK every frame, retain at most one pending frame, perform decode/masking/tracking in one owned Worker Thread, and never persist or project raw frames or tracking payloads outside Electron Main.
- Reactive plans are strict declarative data scoped to exact session, page, observation, visual fingerprint, and a TTL of at most five seconds. They may select only allowlisted generic primitives and never contain selectors, scripts, code, arbitrary JavaScript, or authority for another capability. Low confidence, scene change, navigation, active-page change, stale frame, plan expiry, provider failure after expiry, Pause, Stop, blocker, Plugin disable, Emergency Stop, browser close, and shutdown release all held input.
- Computer Use decisions bind to the exact observation ID and page ID. Navigation, active-page, URL, viewport, or accessibility-state changes make the decision stale before input. Every mutation invalidates the prior observation and captures fresh bounded evidence.
- The internal input owner releases every held key and pointer button on pause, stop, blocker, error, provider failure, Plugin disable, Emergency Stop, browser close, and application shutdown.
- Accessibility snapshots, masked screenshots, and page content are transient untrusted evidence. Never persist them or place them in Character State, Memory, renderer state, diagnostics, or conversation history. Mask credentials, one-time codes, payment fields, and tokens in visual observations; deny notification prompts by default.
- Fixed Main-owned structural inspection detects CAPTCHA, authentication, two-factor, password-manager, payment-confirmation, and secure-desktop blockers. Page or Character text may not supply selectors, scripts, or bypass instructions. A blocker moves the session to `waiting-user`, releases input, and requires a fresh observation before resume.
- Browser Computer Use emits only bounded lifecycle and notable-observation events into Experience. Commentary continues through Behavior and Conversation Admission; active user conversation and audio remain authoritative. Session gaze is a typed Behavior presence projection, not Character State, and terminal or waiting states release only the matching browser session lease.
- Browser Control renderer diagnostics expose only the bounded typed status and current session projection. They never expose screenshots, DOM, accessibility dumps, coordinates, tab authorization scopes, Action IDs, or credentials.
- DSH remains the Desktop Control shell backend only. It never owns or plans browser work and cannot bypass Browser Control or Action Runtime.

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
- Browser Computer Use owns bounded multi-step visual planning through its Main-owned
  model Adapter. DSH remains shell-only and has no browser planning, session, page,
  observation, screenshot, mouse, keyboard, or input authority.
- Project evidence shown to users must originate from the exact Project Context
  Packet used for that turn. LLM-generated citations are never authoritative
  provenance.
- Project retrieval normalization and query planning belong to a dedicated
  Project Awareness query compiler, evidence ranking belongs to the selector,
  and Project Knowledge Store remains a persistence/query primitive.
- Character LLM is the sole semantic owner for deciding whether to answer directly
  or call available Project, Browser, Shell/Desktop, or Memory tools. Do not add
  phrase-, keyword-, regex-, filename-, symbol-, or locale-alias routing for these
  natural-language decisions. Before an explicit user turn may produce a terminal
  reply, the same Character LLM emits a typed Tool Requirement: direct answer,
  preferred source, required source, or explicit tool. This requirement is the
  minimum terminal obligation, not the turn-wide tool allowlist. A separate bounded
  initial Tool Plan is registered from the original request before external evidence.
  Runtime rejects a terminal reply while a
  required available source/tool remains unattempted; unavailable or failed required
  work produces an honest bounded response and may not be replaced by remembered
  knowledge.
- Runtime-owned Turn Tool Evidence records only bounded attempted/succeeded facts.
  Character may claim that a source was searched, checked, verified, or found only
  when current-turn evidence reports success. The immediately previous bounded
  summary may ground retrospective questions about actual tool use, but never
  satisfies a current-turn source requirement and never stores raw tool payloads.
- Main-owned typed assistant-turn metadata distinguishes Character prose from provider
  failures, Tool Requirement failures, and Runtime fallbacks. Non-Character failure
  presentations are excluded from later semantic Tool Requirement planning and are
  never identified by matching their text.
- Tool continuation context stays bounded and plan/requirement-relevant. Send only
  definitions selected by the initial Tool Plan plus the required or preferred source
  family, but do not remove them merely because the terminal requirement was satisfied.
  Preserve typed Action outcomes, but remove superseded Browser
  Observations so only the latest transient observation informs the next decision.
  A provider continuation failure must not be disguised as the presentation of an
  earlier Action result.
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
- Streaming speech uses one bounded Fish text-in/audio-out session per admitted
  turn. AudioPlayer owns playback and consumed source-sample position. ACK is
  transport credit, not audible completion. Cancellation invalidates queued PCM
  and cues and stops actual inference; no new turn overlaps unfinished cleanup.
- The ARDY experiment keeps its independent environment under
  `apps/desktop/motion`. Electron Main owns the Adapter/processes and validates
  bounded results; renderer Avatar Runtime owns retargeting and bone composition.
  Head/neck, eyes, jaw and facial channels are excluded from generated body input.
  Conversational body and delivery use AudioPlayer's consumed PCM cursor. Overlay
  consumes that same pose and never starts a second generator. LLM2Vec is ARDY
  conditioning, not the conversational LLM and cannot be replaced by chat text.
- ARDY body composition applies procedural contributions once per frame, uses
  model-oriented anatomical constraints and stable knee poles, and samples
  procedural fingers from the same body cursor. Overlay consumes the composed
  body/finger/chest projection with bounded interpolation; it never adds a second
  independent breathing or upper-body motion layer. Correction diagnostics expose
  bounded counts only, never raw poses.
- Facial acting binds are capability-gated and owned by AvatarExpressionMixer.
  Overlay consumes the primary composed acting and bilateral eyelid projection;
  it never starts a second randomized facial actor.
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
- Browser Control observation, computer-use loop, or input changes require the focused
  deterministic Browser Control repro plus the opt-in real-site qualification
  (`npm run desktop:browser-control:qualification`) before commit.
- When live validation is explicitly requested after Avatar Runtime changes,
  verify VRM loading, idle animation, `loadAnimation`, Debug Preview, Speaking,
  LipSync, Overlay, absence of A-pose, and Runtime Health. Animation Runtime
  changes additionally require idle, speaking, transitions, and preview checks.

## API service rules

`apps/api` is the independent FastAPI service that owns ASR and Fish Audio S2 Pro.

Architecture and ownership:

- The API service owns speech recognition and synthesis.
- It does not own Electron playback, LipSync, or avatar state; those belong to
  `apps/desktop`.
- Preserve the existing HTTP API unless the task explicitly changes the contract.
- Resolve service assets relative to the service root using `Path(__file__)` /
  `apps/api`, never from the monorepo working directory.
- FastAPI runs on port `8000`. ASR uses faster-whisper with Silero VAD. TTS owns
  one cancellable real Fish S2 Pro inference worker. No F5 fallback is allowed.
- HTTP `2.1` and `/tts/stream` protocol `2` are a coordinated breaking change.
  `/synthesize` is removed. Typed metadata/binary pairs describe mono Float32 LE
  PCM at 44.1 kHz, exact sample counts and cumulative source offsets. Queues,
  backpressure, cancellation, busy and disconnect are bounded and validated.
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
  `/health`, `/voices`, `/emotions`, `/tts/warmup`, `/tts/stream`, `/recognize`
  and `/ws/asr`; synthesis checks confirm real early PCM before finish-input.
- `/health` reports actual Fish/ASR readiness, pinned revisions, compile mode,
  warmup and bounded failure. Loading or local mute never proves inference abort.

Voice registry and references:

- Canonical semantic emotion, bounded delivery and VRM/body mappings derive from
  the versioned contract under `contracts/`. Fish rendering uses square tags;
  internal voice-style markers never reach provider text or visible history.
- `app/tts/emotion.py` removes normalized emotion tags and maps them to TTS
  emotions and VRM expression weights.
- `app/tts/voice_registry.py` owns logical voice IDs and immutable references.
  Fish conditioning is derived, checksum/revision-bound data, not a new reference.
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
- Keep Fish device/compile/session policy server-owned. Remove F5-only settings,
  dependencies and installation rules as part of the explicit migration.
- The separate speech API test page keeps its lightweight web stack; Spectrum 2
  is mandatory for Electron UI. The API page owns no ARDY or VRM renderer.
- Never commit model caches, secrets, generated audio, or the local virtual
  environment.

## 2. Architectural boundaries

- Desktop and API are independent applications.
- They communicate only through the HTTP API contract.
- Desktop must not import or read API implementation files directly.
- API must not depend on Desktop source code.
- Do not merge their runtime lifecycles.
- Runtime ownership and component responsibilities must remain consistent with
  the governing architecture. Apply the change-control policy below to conflicts.

### Architecture Change Control

`ARCHITECTURE.md` is the protected canonical architecture consolidation and is
READ-ONLY by default for AI agents. The original architecture documents remain
authoritative for architectural meaning, according to the Shio Runtime
Documentation Editing Policy.

For ordinary feature implementation, bug fixes, refactoring, optimization,
testing, and qualification:

1. Read `AGENTS.md` and the relevant `ARCHITECTURE.md` sections.
2. Identify the applicable architecture invariants.
3. Verify the proposed implementation against them before changing code.
4. Implement only within the existing architectural boundaries.
5. Do not edit `ARCHITECTURE.md` as part of ordinary development.
6. Record implementation details, evidence, and the implementation plan in
   separate work-item reports. These reports do not define architectural meaning.

Architecture-first means REVIEW FIRST, not EDIT FIRST.

If the requested implementation conflicts with the architecture:

- Identify the exact conflicting invariant or section.
- Stop only the conflicting portion of work; continue independent compliant work.
- Explain the conflict and available alternatives.
- Do not rewrite architecture to legitimize the implementation.
- Request separate, explicit user authorization for the architectural change.

Only a direct user request specifically authorizing modification of architectural
documentation permits such changes. General permission to implement a feature
does not authorize architectural-document modification. Editorial changes also
require that authorization, must preserve architectural meaning, and must follow
the Shio Runtime Documentation Editing Policy.

Agents must never modify `AGENTS.md` merely to bypass these rules. A governance
change requires a direct user instruction authorizing that change.

The final Architecture Review identifies the applicable invariants and reports
compliance or exact conflicts, including Runtime ownership and the Desktop–API
contract where relevant. It does not require an architecture file edit. Keep any
separately authorized architectural-document change and intentional Runtime
behavior change in separate Work Items.

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
npm run desktop:test:fast
npm run desktop:test:regression
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
  typecheck, `npm run desktop:test:regression`, and any applicable opt-in qualification.
- Before committing API changes → `npm run api:lint`, `npm run api:test`, plus the
  applicable endpoint checks.
- Before committing cross-boundary changes → validate both applications and run an
  integration smoke test.

If a check run for the current work cannot be completed, say so explicitly in the
final report. A commit must not be created if its required validation has not passed.

Do not launch the application or run a live smoke test unless the user explicitly
requests live validation for the current Work Item. Static checks, builds, typechecks,
and focused deterministic tests remain required where applicable. When live validation
was not requested, state this directly in the final report; its absence does not block
a commit.

Permanent deterministic Desktop tests use Vitest and live below `apps/desktop/tests`,
organized by level and owning domain. Use `test:fast` for unit, contract, and architecture
guards, and `test:regression` for the complete deterministic suite. The managed-Chrome
fixture is deterministic regression coverage; public-site Browser checks, real Electron,
long-running soaks, live-provider checks, and benchmarks remain standalone qualification
runners. New bug repros are temporary, issue-scoped artifacts; migrate the regression case
into `tests` and remove the repro after the fix. The unfinished Continuous Listening harness
is the only temporary legacy `repro:*` exception and is excluded from regression until that
feature is ready. See `docs/DESKTOP-TESTING.md` for the taxonomy and command surface.

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

Apply Architecture Change Control in section 2. `ARCHITECTURE.md` and the original
architectural specifications are protected documents, not implementation logs.
Original documents remain authoritative for architectural meaning under the Shio
Runtime Documentation Editing Policy; the canonical consolidation does not grant
an agent authority to reinterpret them.

Ordinary development updates separate implementation/work-item reports with RCA,
tests, qualification evidence, limitations, and an Architecture Review. It must
not update protected architectural documents or agent governance automatically.

If implementation and architecture diverge, report the exact divergence and
propose compliant alternatives. Do not automatically edit either specification
to match implementation. Follow section 2 for the conflicting portion of work
and for separate, explicit authorization of architectural-document changes.

When the user specifically authorizes editorial work, follow the Shio Runtime
Documentation Editing Policy and preserve architectural meaning. Restructuring,
deduplication, cross-references, terminology consolidation, and wording changes
may not introduce new concepts or layers, rename Runtime/domain responsibilities,
reassign ownership, or alter contracts, behavior, boundaries, or guarantees.
Editorial convenience never overrides architectural accuracy, and editorial
authorization does not authorize an architectural decision change.

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
   Update installation, troubleshooting, and requirements documentation when the
   release changes those areas. Protected architectural-document edits remain
   subject to the separate, explicit authorization required by section 2.
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

- Review relevant architecture invariants before implementation; keep protected
  architecture documents read-only unless specifically authorized under section 2.
- When the user explicitly requests live validation after refactoring, do not stop at
  a passing build; run the required live smoke test when runtime behavior is involved.
- Do not move helper methods without checking all call sites.
- Do not change architecture and behavior in the same Work Item.
- When fixing bugs, collect evidence first.
- Do not consider a problem solved only because compilation succeeds.
- Do not silently remove or weaken debug, telemetry, diagnostics, or Runtime Health.
