# Desktop test infrastructure

Desktop verification uses one deterministic TypeScript runner plus explicit standalone
runners for checks that require a real application, browser, provider, or extended runtime.
The split prevents environment-dependent qualification from being mistaken for ordinary
regression coverage.

## Permanent deterministic tests

Vitest owns files below `apps/desktop/tests`:

- `unit` — one owner or policy in isolation;
- `integration` — cooperation between bounded runtime owners;
- `renderer` — rendered behavior, accessibility, and user interaction;
- `contracts` — stable typed and protocol behavior;
- `architecture` — AST/import ownership and security boundaries;
- `support` — shared clocks, deferred promises, event collectors, temporary resources,
  and domain fixtures.

Test names describe the owning domain and observable behavior. Historical Epic labels,
`hardening`, and numeric suffixes are not permanent taxonomy.

Run the stable command surface from the repository root:

```text
npm run desktop:test
npm run desktop:test:fast
npm run desktop:test:regression
npm run desktop:test:architecture
```

Use a Vitest path or name filter instead of adding a package script for every domain:

```text
npm --prefix apps/desktop run test -- memory
npm --prefix apps/desktop run test -- speech
```

`desktop:test:fast` covers unit, contract, and architecture tests. The complete
credential-free deterministic suite is `desktop:test:regression`; it is a single Vitest
run. Browser Control's local fixture uses the Shio-managed Chrome context and belongs to
this regression tier. The public-site Browser qualification remains opt-in.

## Qualifications and benchmarks

Standalone runners remain appropriate when a check needs real Electron, real Chrome,
a public site, live LLM or speech infrastructure, a long soak, or performance measurement.
Their stable root commands use the `desktop:qualify:*` or `desktop:benchmark:*` prefixes.
They do not run as part of deterministic regression.

## Temporary reproducers

New reproducers belong below `apps/desktop/repro/issue-<id>` and require a README stating
the issue, root cause, owner, expected failure, creation date, and migration target. After
the fix, move the durable regression case into the owner's deterministic suite and remove
the temporary reproducer.

The former permanent `apps/desktop/scripts/*-repro` suites have been migrated into Vitest.
Continuous Listening is the sole temporary exception: its feature is not ready, its legacy
harness stays outside `test:regression`, and it must not be migrated or treated as current
coverage until the feature work resumes.

## CI tiers

| Tier | Purpose | Contents |
| --- | --- | --- |
| Fast | Every change | Unit, contracts, architecture |
| Regression | Before merge | All deterministic integration and renderer tests |
| E2E | Merge candidate | Electron smoke |
| Qualification | Relevant opt-in changes | Real Chrome, speech service, public-site checks |
| Soak | Nightly or major runtime changes | Extended lifecycle and leak checks |
| Live | Manual | Real providers and credentials |
| Benchmark | Manual or nightly | Latency and performance |

Browser Control shares scenario helpers between a deterministic local-fixture Vitest suite
and the opt-in public-site qualification. The qualification is never discovered by Vitest.
Continuous Browser Control adds a dynamic local Canvas fixture to the deterministic regression
tier and a separate real-Chrome qualification/soak command:

```text
npm run desktop:qualify:continuous-browser
```

The qualification reports frame backpressure, tracking/input latency, re-anchor/plan counts,
held-input cleanup, Worker memory, and process-memory samples. Set
`SHIO_CONTINUOUS_BROWSER_SOAK_MS` to shorten a local diagnostic run; the release qualification
default remains 30 minutes.

## Test architecture audit — 2026-10-27

Scope: Desktop Vitest, ARDY CPU/contract tests and Fish/API tests. This audit applies the existing test-architecture section of ARCHITECTURE.md; it adds no runtime owner, dependency, test runner, command, CI rule or release gate. Live qualification and production acceptance flags are unchanged.

### Decisions and isolation

- Moved real-rig retargeting, Avatar coordination/preview, Main ARDY process lifecycle, SDK transports, disk persistence and the emitted-asset subprocess check to integration. Motion and Character tool wire schemas belong to contracts. Permission policy, prompt allocation and snapshot invariants belong to unit. CSS presentation belongs to renderer.
- Pure policy tests may import constants or use minimal bones without becoming integration tests. A unit test does not become a rendered UI test just because its subject is a renderer-side helper. Conversely, a real SDK, filesystem store or cooperating runtime owners are explicit integration dependencies.
- Global WebAudio/window replacements use Vitest stubs; the runner restores mocks, globals and environments. Audio fixtures track intervals, contexts, sources, worklet ports and teardown. Deferred motion work is settled after invalidation; playback owners detach and await cancellation. Real-rig geometry is disposed even after an assertion fails. Source reads are relative to import.meta.dirname. The asset-verifier child is bounded and its temporary output is removed in finally.
- Shared fixtures are deliberately small: motionFixtures owns MotionLease/Plan/Chunk and the start/next/stop transport fake; minimalVrm owns only a flat normalized skeleton; pcmClock owns the consumed-sample projection; audioEnvironment owns the WebAudio boundary. greenFoxRig remains a separate actual hierarchy/geometry fixture. Scenario-specific poses, seed rerolls, delayed chunks and failure responses remain explicit in their tests.
- avatar-visual-motion now has independent responsibilities. Desktop security is separated into AST ownership, IPC contract and resource/navigation integration. Desktop UI source assertions are replaced by actual renderer behavior and PostCSS layout contracts. speech-playback now asserts the real AudioPlayer lifecycle rather than logging a comparison with a copied broken implementation.
- character-tool-requirement remains one cohesive file: its 25 independently selectable scenarios cover one tool-requirement protocol using local fixtures. It had no single main() wrapper. Splitting it would duplicate provider protocol setup without improving scenario isolation. Other coherent legacy lifecycle harnesses retain their assertions; this is not an automatic rewrite of every test.
- Python startup readiness now isolates the HealthState, ASR/TTS owner dictionaries and Fish engine reference with monkeypatch. ARDY uses monkeypatch/tmp_path and CPU tensors for backend accounting. Fish WebSocket cases use synthetic engines, context-managed sockets and explicit cancellation/session assertions. None proves successful model inference or visual quality.

### Architecture assertion disposition

| Category | Retained responsibility and evidence |
| --- | --- |
| A — ownership | Existing import/process/facial-writer guards remain. IPC registrations are read from AST and matched to the canonical channel inventory and authorization. Window security, Overlay IPC allowlist, Main schema validation, removed loaders/dependencies, Spectrum primitives and feature-style ownership remain structural guards. |
| B — behavior/contract | Caller/payload rejection is in contracts/ipc-authorization; navigation prevention and opaque assets are in integration/desktop-security. Applied-pose HUD projection is in integration/avatar/overlay-motion-hud; rendered HUD updates and teardown are in renderer/overlay-motion-hud. Shell/health, microphone, screen picker, Plugins, capabilities, memory confirmation, setup, Tasks and project evidence use React Testing Library. Responsive containers and theme tokens use renderer PostCSS contracts. |
| C — incidental syntax | Removed exact local variable/callback names, JSX text spellings, file-length thresholds, class-name placement, exact padding/min-height/tooltip delay, icon helper names and exact Russian copy. The corresponding user actions, semantic regions, state presentation and localization key parity remain covered. No assertion about visual naturalness is inferred from these checks. |

### Per-file Desktop inventory

Paths below are relative to apps/desktop/tests. The path prefix is the test level. Dependencies name the production owners used directly (type-only imports omitted); external dependencies and test doubles are stated separately. New focused tests are included. Concurrent animation tests remain listed without rewriting their scenarios.

#### unit (31 files)

| File | Subject / behavioral responsibility | Production dependencies | Mock boundary |
| --- | --- | --- | --- |
| action/action-experience-bridge.test.ts | Action Experience bridge | ActionExperienceBridge | In-memory fixtures and injected ports |
| action/permission-guard.test.ts | Action Permission Guard | action, actions | In-memory fixtures and injected ports |
| alive/ambient-presence.test.ts | Ambient Presence policy | AliveStore, AmbientPresencePolicy | In-memory world/mood/settings; AliveStore imported for defaults only |
| avatar/generated-body-safety.test.ts | generated body anatomical safety | GeneratedBodySafety, motion | In-memory fixtures and injected ports |
| avatar/motion-library-availability.test.ts | motion library owner availability | GeneratedBodyPlayback, motion | Fake Main status; single owner availability, no motion generation |
| avatar/overlay-procedural.test.ts | Overlay procedural body ownership | ProceduralMotionController | In-memory fixtures and injected ports |
| avatar/overlay-publication.test.ts | Overlay body publication | OverlayRuntime | window |
| avatar/phase-execution.test.ts | phased motion execution lifecycle | MotionPhaseExecution, motion | In-memory fixtures and injected ports |
| avatar/phase-hand-score.test.ts | execution-bound hand score | GeneratedHandPose, motion | In-memory fixtures and injected ports |
| avatar/planted-motion.test.ts | keeps the knee on its anatomical side when generated extension crosses zero | plantLeg | In-memory fixtures and injected ports |
| avatar/presence-continuity.test.ts | continuous presence composition | AvatarMotionLayer, BreathController, ProceduralMotionController, motionTuning | In-memory fixtures and injected ports |
| avatar/semantic-motion-selection.test.ts | standing semantic motion selection | AvatarBehaviorResolver, motion | In-memory fixtures and injected ports |
| avatar/speaking-cadence.test.ts | speaking scheduling attempts | AvatarSpeakingGestureScheduler, runtime | In-memory fixtures and injected ports |
| avatar/speech-head-motion.test.ts | speech-driven head motion | AvatarFacialRuntime, HeadMotionRuntime | Scoped spies on owner ports; in-memory inputs |
| browser-control/structured-model-response-parser.test.ts | StructuredModelResponseParser | StructuredModelResponseParser | In-memory fixtures and injected ports |
| browser-held-input-registry.test.ts | BrowserHeldInputRegistry | BrowserHeldInputRegistry | In-memory fixtures and injected ports |
| character-response/gesture-literal-containment.test.ts | gesture literal containment without execution authority | character-response, character-stream, emotion | In-memory fixtures and injected ports |
| character-response/internal-reasoning-containment.test.ts | internal character reasoning containment | character-response, character-stream | In-memory fixtures and injected ports |
| character-response/phased-embodiment.test.ts | versioned semantic embodiment | CharacterPrompt, CharacterRequestComposer, EmbodimentAvailabilityPrompt, ResponsePolicyPrompt, character-response, character-stream, motion | In-memory fixtures and injected ports |
| desktop-control/shell-risk-policy.test.ts | Shell risk policy | character-tools, desktop-control | In-memory fixtures and injected ports |
| playwright-cdp-frame-stream.test.ts | PlaywrightCdpFrameStream | PlaywrightCdpFrameStream | In-memory fixtures and injected ports |
| prompt-budget.test.ts | character prompt budget | CharacterRequestComposer | In-memory fixtures and injected ports |
| renderer/capability-navigation.test.ts | Capability navigation | capabilityNavigation, plugins | In-memory fixtures and injected ports |
| renderer/chat-quick-actions.test.ts | chat quick actions | chatQuickActions, localization | In-memory fixtures and injected ports |
| renderer/first-run-state.test.ts | First-run state | configDefaults, projectStatusPresentation, ControllerStore, firstRunState | In-memory fixtures and injected ports |
| renderer/pcm-worklet.test.ts | PCM worklet resampling | pcmStreamWorklet.js | VM AudioWorkletProcessor/registerProcessor/port; actual worklet source |
| renderer/runtime-health.test.ts | Runtime Health projection | runtimeHealth | In-memory fixtures and injected ports |
| renderer/screen-context-attachment.test.ts | screen context attachment settlement | useScreenContextAttachment | In-memory fixtures and injected ports |
| runtime-invariants.test.ts | runtime state invariants | RuntimeStateInvariantValidator | In-memory fixtures and injected ports |
| speech-polish.test.ts | speech text normalization | text-normalization, emotion | In-memory fixtures and injected ports |
| support/test-kit.test.ts | Desktop test kit | ManualClock / Deferred / TempDirectory / EventCollector | In-memory fixtures and injected ports |

#### contracts (7 files)

| File | Subject / behavioral responsibility | Production dependencies | Mock boundary |
| --- | --- | --- | --- |
| browser-computer-use-continuous.test.ts | continuous browser computer-use contracts | browser-computer-use | In-memory fixtures and injected ports |
| character-state-writers.test.ts | Character State domain writers | CharacterStateStore, EventBus | In-memory fixtures and injected ports |
| character-tools/character-tool-schemas.test.ts | canonical Character tool schemas | CharacterToolRegistry, CharacterToolSpecifications, character-tools | Schema/registry inputs only; no LLM or tools |
| config-migration.test.ts | Desktop configuration migration | environmentConfig, config | In-memory fixtures and injected ports |
| ipc-authorization.test.ts | IPC caller and argument contract | IpcAuthorization | In-memory fixtures and injected ports |
| localization.test.ts | Desktop localization contract | localization | In-memory fixtures and injected ports |
| motion-contract-v2.test.ts | standing motion contract v2 | motion | In-memory fixtures and injected ports |

#### architecture (9 files)

| File | Subject / behavioral responsibility | Production dependencies | Mock boundary |
| --- | --- | --- | --- |
| desktop-security.test.ts | Desktop security architecture | IpcAuthorization | Read-only AST/import/CSS sources; no Runtime mocks |
| desktop-ui.test.ts | Desktop UI ownership | Read-only production source tree | Read-only AST/import/CSS sources; no Runtime mocks |
| generated-motion-migration.test.ts | generated-motion migration boundary | Read-only production source tree | Read-only AST/import/CSS sources; no Runtime mocks |
| memory-ownership.test.ts | Memory ownership boundaries | Read-only production source tree | Read-only AST/import/CSS sources; no Runtime mocks |
| ownership.test.ts | Desktop runtime ownership | Read-only production source tree | Read-only AST/import/CSS sources; no Runtime mocks |
| process-boundaries.test.ts | Desktop process boundaries | Read-only production source tree | Read-only AST/import/CSS sources; no Runtime mocks |
| renderer-stability.test.ts | Renderer structural stability | Read-only production source tree | Read-only AST/import/CSS sources; no Runtime mocks |
| security-boundaries.test.ts | Desktop structural security boundaries | Read-only production source tree | Read-only AST/import/CSS sources; no Runtime mocks |
| subprocess-boundaries.test.ts | Owned subprocess boundaries | Read-only production source tree | Read-only AST/import/CSS sources; no Runtime mocks |

#### integration (67 files)

| File | Subject / behavioral responsibility | Production dependencies | Mock boundary |
| --- | --- | --- | --- |
| action-runtime.test.ts | Action Runtime integration | action, workflow, actionRuntimePresentation, actions | In-memory fixtures and injected ports |
| action-verification.test.ts | Action verification and recovery integration | action, llm, orchestrator, actions | In-memory fixtures and injected ports |
| alive/autonomy.test.ts | Alive and Autonomy integration | AliveRuntime, AliveStore, AutonomyEnvelope, GoalAwarenessPrompt, CharacterToolDispatcher, CharacterToolLoop, CharacterToolRegistry, stream, memory, character-stream, latency | Temporary filesystem/database; bounded external adapters |
| alive/scheduler.test.ts | Scheduler Runtime | alive | In-memory fixtures and injected ports |
| alive/world-context.test.ts | World Context Runtime integration | AliveStore, SystemContextAdapter, WindowsSystemContextAdapter, WorldContextRuntime | In-memory fixtures and injected ports |
| avatar-visual-motion.test.ts | avatar visual motion | AvatarAnimationQueue, AvatarPlaybackCoordinator, AvatarGazeArbiter, LookAtRuntime, AvatarMotionLayer, BreathController, MicroMotionController, ProceduralMotionController, TailBehaviorRuntime, AvatarRendererQuality, motionTuning | In-memory fixtures and injected ports |
| avatar/conversational-gesture.test.ts | conversational gesture preparation and late admission | AvatarController, motion | Model/renderer ports; real coordinator lifecycle |
| avatar/embodiment-context.test.ts | Avatar embodiment context validity | AvatarController | Model/renderer ports; real coordinator lifecycle |
| avatar/generated-hand-pose.test.ts | phase-bound bilateral hand composition | GeneratedHandPose, motion | Real rig + geometry; synthetic source motion |
| avatar/generated-motion.test.ts | generated-motion diagnostic ownership | GeneratedBodyPlayback, GeneratedBodySafety, motion | Typed fake MotionApi, minimal bones; real playback/safety |
| avatar/model-replacement.test.ts | VRM replacement during streamed speech | AvatarController, runtime | Model/renderer ports; real coordinator lifecycle |
| avatar/motion-service.test.ts | Main-owned ARDY lifecycle | motion, ArdyMotionService | node:child_process, node:fs |
| avatar/overlay-motion-hud.test.ts | overlay motion HUD projection | Controller | audioPlayer, MicrophoneGateController |
| avatar/phase-playback-regressions.test.ts | generated phase timing regressions | GeneratedBodyPlayback, GeneratedBodySafety, motion | Deferred MotionApi, fake clocks, minimal bones; real phase/playback |
| avatar/preview-camera.test.ts | Preview hand camera | AvatarController, previewHandBounds, SceneManager, motion | Real rig + geometry; synthetic source motion |
| avatar/preview-playback.test.ts | manual generated-motion preview ownership | AvatarAnimationController, AvatarController, AvatarPlaybackCoordinator | Model/renderer ports; real coordinator lifecycle |
| avatar/preview-sequence-race.test.ts | preview sequence execution ownership | AvatarController | Model/renderer ports; real coordinator lifecycle |
| avatar/real-rig-clearance.test.ts | matches calibration through the production VRM loader and normalized hierarchy | GeneratedBodyCalibration, GeneratedBodyPlayback, GeneratedBodySafety, motion | Real bundled VRM loader/geometry; synthetic motion and texture loading; selected safety spies isolate coordinates |
| avatar/seeded-preview.test.ts | fixed Preview variation seeds and physical recovery | AvatarAnimationController, AvatarController, AvatarPlaybackCoordinator, MotionPhaseExecution, GeneratedBodyPlayback, motion | Typed fake MotionApi and seed-specific reroll; minimal bones |
| avatar/spatial-hand-goals.test.ts | clears moving-parent contact during a bounded change of hand workspace | GeneratedBodyPlayback, GeneratedBodySafety, motion | Real rig + geometry; synthetic source motion |
| avatar/vrm-composition.test.ts | composes procedural and secondary motion exactly once per rendered frame | AvatarFacialRuntime, VrmModel | Model/renderer ports; real coordinator lifecycle |
| browser-continuous-control.test.ts | Continuous Browser Control | ContinuousBrowserScenarios / reactive worker / input lifecycle | Local Canvas + real Chrome/CDP/worker; scripted model |
| browser-control.test.ts | Browser Control | BrowserControlScenarios / Playwright Adapter / Action Runtime | Local HTTP fixture + real managed Chrome; scripted model/Action ports |
| browser-control/structured-response-repair.test.ts | LlmBrowserVisualActionAdapter response repair | browser-control | In-memory fixtures and injected ports |
| browser-workflow.test.ts | browser workflow | workflow, llm, orchestrator | In-memory fixtures and injected ports |
| character-capability-awareness.test.ts | character capability awareness | capabilities, LegacyDirectiveContainment, CapabilityPromptProjection, orchestrator, plugins, project-awareness, web-search | Temporary filesystem/database; bounded external adapters |
| character-tool-requirement.test.ts | Character Tool Requirement | CharacterToolDispatcher, CharacterToolLoop, CharacterToolRegistry, memory, browser-computer-use | Scripted LLM and external tools; real loop/dispatch |
| conversation-threads/thread-runtime.test.ts | Conversation Thread Runtime | conversation-threads | In-memory fixtures and injected ports |
| desktop-reliability.test.ts | desktop reliability contracts | payloadSchemas, RendererProcessHealthTracker, rendererErrorDiagnostics, observePromise, AvatarRuntimeHealthTracker, OverlayRuntime, TransitionRecorder, character-response | window |
| desktop-security.test.ts | Desktop resource and navigation boundaries | VrmAssetRegistry, payloadSchemas, windowSecurity | Temporary filesystem/database; bounded external adapters |
| dsh.test.ts | DSH adapter | DshHarnessAdapter | Temporary filesystem/database; bounded external adapters |
| ear-behavior.test.ts | ear behavior | EmotionEmbodimentProfile, EarBehaviorRuntime | In-memory fixtures and injected ports |
| embodiment-polish.test.ts | embodiment polish | AvatarSpeakingGestureScheduler, EmotionEmbodimentProfile, PhraseEnvelopeController, SpeechPhraseTiming, VrmModel, runtime | In-memory fixtures and injected ports |
| embodiment-stream.test.ts | provider-neutral early embodiment transport | CharacterToolLoop, CharacterToolRegistry, llm, motion | In-memory fixtures and injected ports |
| failed-llm-turn.test.ts | failed LLM turn recovery | llm, request, InMemoryStore, orchestrator, ScreenContextService, CharacterResponsePort, ConversationRuntime, conversation | window |
| goal-runtime.test.ts | Goal Runtime | alive | Temporary filesystem/database; bounded external adapters |
| llm-compat.test.ts | LLM provider compatibility | config, errors, messageCompatibility, OpenAICompatibleClient, proxy, request, response, registry | In-memory fixtures and injected ports |
| llm-credentials.test.ts | LLM credentials | config, LlmCredentialStore, persistence | Temporary filesystem/database; bounded external adapters |
| llm/openai-sdk-transport.test.ts | official OpenAI SDK transport | request, stream | Injected fetch/SSE; real OpenAI SDK and transport adapter |
| main-application-services.test.ts | main application services | MainConversationTurnService, SpeechApplicationService | In-memory fixtures and injected ports |
| memory/procedural-evidence.test.ts | Procedural Memory evidence integration | alive, memory | In-memory fixtures and injected ports |
| memory/retrieval-habits-relationship.test.ts | Memory retrieval | memory | In-memory fixtures and injected ports |
| memory/semantic-memory.test.ts | Semantic memory integration | llm, request, response, memory, orchestrator | In-memory fixtures and injected ports |
| mind-layer.test.ts | Mind layer | alive | Temporary filesystem/database; bounded external adapters |
| network-diagnostics.test.ts | network diagnostics | createObservedFetch, NetworkRequestDiagnostics, observeAxiosNetwork, RendererNetworkObserver, IpcAuthorization | In-memory fixtures and injected ports |
| persistence/app-config-electron-store.test.ts | App config electron-store migration | AppConfigStore (dynamic import), electron-store | Electron userData + credential boundary; real electron-store in temporary directory |
| persistence/app-config-storage-failure.test.ts | App config storage failure containment | AppConfigStore (dynamic import), ElectronStoreLifecycleAdapter | Electron/userData and failing storage lifecycle; real AppConfigStore |
| persistence/validated-electron-store.test.ts | ValidatedElectronStore | ElectronStoreLifecycleAdapter, ValidatedElectronStore, ProjectAwarenessConfigStore | Electron userData/credential port; real temporary disk store |
| plugins/plugin-runtime.test.ts | Plugin Runtime integration | desktop-control, orchestrator, plugins, project-awareness, config | In-memory fixtures and injected ports |
| project-aware-actions.test.ts | Project-aware Action integration | orchestrator | In-memory fixtures and injected ports |
| project-awareness.test.ts | Project Awareness integration | project-awareness, GitHubProjectAdapter, SourceFilter, PackageManifestEvidence, ProjectEvidenceSelector, ProjectRetrievalQueryCompiler, localization | Temporary filesystem/database; bounded external adapters |
| project-awareness/github-project-adapter.test.ts | @octokit/request GitHub Project Adapter | GitHubProjectAdapter | Injected fetch; real Octokit request/response mapping |
| project-evidence.test.ts | Project reply provenance integration | orchestrator, projectEvidence, ControllerStore | In-memory fixtures and injected ports |
| project-freshness.test.ts | Project snapshot freshness integration | project-awareness | Temporary filesystem/database; bounded external adapters |
| renderer/speech-assets.test.ts | production speech assets | verify-speech-assets.mjs | Temporary emitted assets + bounded Node verifier subprocess; no real build |
| renderer/streaming-chat-message.test.ts | streaming chat message updates | ChatMessageUpdateCoalescer, ControllerStore | Fake timers; real coalescer and ControllerStore |
| runtime-health.test.ts | runtime health | plugins, project-awareness, runtimeHealth | Temporary filesystem/database; bounded external adapters |
| screen-context-race.test.ts | screen context races | ScreenContextService | In-memory fixtures and injected ports |
| semantic-character-tools.test.ts | semantic character tools | MemoryResultPresenter, CharacterToolDispatcher, CharacterToolRegistry, ToolInfluenceContext, browser-computer-use, character-tools | Scripted LLM and external tools; real loop/dispatch |
| speech-playback.test.ts | speech playback lifecycle | audioPlayer | Fake decode/WebAudio source and timer registry; real AudioPlayer |
| speech-reliability.test.ts | speech client reliability | SpeechClientManager | WebAudio/worklet or transport boundary |
| speech/pcm-stream-playback.test.ts | PCM stream playback | audioPlayer | Fake worklet/port and AudioContext; real AudioPlayer |
| speech/speech-output-port.test.ts | renderer speech output stream | speechStreamPort, SpeechOutputPort | Speech transport/AudioPlayer ports; real SpeechOutputPort |
| speech/streaming-tts.test.ts | streaming TTS integration | SpeechApplicationService, CharacterResponsePort, ConversationRuntime, character-stream, speech | Synthetic PCM/stream transport; real ConversationRuntime/SpeechApplicationService |
| speech/voice-style.test.ts | bounded Fish voice style | CharacterPrompt, CharacterRequestComposer, ResponsePolicyPrompt, SpeechOutputPort, character-stream, emotion | WebAudio/worklet or transport boundary |
| structured-embodiment.test.ts | structured embodiment | LookAtRuntime, motionTuning, ConversationPresentationPort, character-response, config | In-memory fixtures and injected ports |
| web-search.test.ts | Web Search Runtime | CharacterToolDispatcher, CharacterToolRegistry, ToolInfluenceContext, DuckDuckGoWebSearchAdapter, WebSearchPlugin, WebSearchRuntime | In-memory fixtures and injected ports |

#### renderer (13 files)

| File | Subject / behavioral responsibility | Production dependencies | Mock boundary |
| --- | --- | --- | --- |
| catalogs.test.tsx | Plugin status/toggle, capability filters/authority, Memory confirmation | PluginsView, CapabilitiesView, MemoryView, localization | jsdom; @react-spectrum/s2/style |
| chat/input-controls.test.tsx | Microphone recording/access state and Screen Context selection | ChatComposer, ScreenContextPicker, MicrophoneGateOverlay, localization | jsdom; @react-spectrum/s2/style |
| chat/markdown-message.test.tsx | Markdown message rendering | externalNavigation, MarkdownMessage, character-response | jsdom; jsdom, Main API callbacks; real React/Spectrum |
| chat/project-evidence.test.tsx | discloses exact turn provenance and marks stale evidence without discarding its sources | ProjectEvidenceBar, localization | jsdom; jsdom, Main API callbacks; real React/Spectrum |
| chat/streaming-chat.test.tsx | streaming assistant chat bubble | ChatMessageList, LocalizationProvider, localization | jsdom; jsdom, Main API callbacks; real React/Spectrum |
| layout-contracts.test.ts | responsive presentation contracts | Production stylesheet / shared helpers | PostCSS; no browser layout engine |
| overlay-motion-hud.test.tsx | Overlay motion HUD | App | jsdom; @react-spectrum/s2/style, Controller |
| settings/autonomy-settings.test.tsx | autonomy settings numeric fields | AutonomySettingsSection, LocalizationProvider, localization | jsdom; jsdom, Main API callbacks; real React/Spectrum |
| settings/model-combobox.test.tsx | ModelComboBox capability filters | ModelComboBox, LocalizationProvider, localization | jsdom; @react-spectrum/s2/style; IntersectionObserver |
| setup.test.tsx | Saved credentials, microphone cleanup, Plugin navigation, Overlay toggle | SetupCenter, localization | jsdom; @react-spectrum/s2/style, Controller |
| shell.test.tsx | Semantic shell, navigation, creator link, Runtime Health report | AppShell, RuntimeStatusIndicator, localization | jsdom; jsdom, Main API callbacks; real React/Spectrum |
| speech-banner-layout.test.ts | speech banner layout | Production stylesheet / shared helpers | PostCSS; no browser layout engine |
| tasks.test.tsx | Manual goal dialog and measurable progress | TasksView, localization | jsdom; jsdom, Main API callbacks; real React/Spectrum |


### ARDY and Fish/API inventory

Python suites remain in their existing runner/environment; levels below describe evidence, not new directories or commands.

| File | Level and responsibility | Dependencies / mock boundary |
| --- | --- | --- |
| motion/tests/test_worker.py | Contract: bounded identity, revisions, phase/continuity, trusted conditioning | Real protocol/catalog; copied request fixtures, no worker/inference |
| motion/tests/test_soma_backend.py | Component: native output shape, source frames and bounded history rollback | ArdyBackend, CPU torch/numpy; fake model step/inverse, monkeypatch device |
| motion/tests/test_conditioning_cache.py | Component: exact encoder/profile/revision cache identity and invalid-cache recovery | Real cache orchestration, tmp_path; CPU embeddings and encoder/module adapters |
| motion/tests/test_standing_constraints.py | Component: end-effector anchors and CPU index pairs | Real constraint helpers; CPU torch and scoped ARDY module doubles |
| motion/tests/test_research.py | Unit/contract: safe archive extraction and pinned source/encoder inputs | In-memory ZIP, tmp_path; no downloads or inference |
| api/tests/test_tts_stream.py | Component/contract: ready/PCM ordering, validation, duplicate/busy admission, cancellation and terminal flush | Real FastAPI/WebSocket route; synthetic streaming engines; sockets/tasks closed and sessions checked |
| api/tests/test_fish_incremental_decode.py | Component: incremental token/PCM preservation and decoder revision rejection | Real streaming decode hook; fake CPU decoder/token generator |
| api/tests/test_voice_conditioning.py | Component: immutable references, conditioning identity, delivery, cancellation and readiness | Temporary voice files; synthetic queues/worker/conditioning boundary |
| api/tests/test_startup_readiness.py | Component: reachable health during model loading and bounded startup failure | Real lifespan/TestClient; event-controlled model loader; isolated owner state restored by monkeypatch |
| api/tests/test_streaming_asr.py | Component: pause/final/partial ordering, no inference on silence | Real ASR session; fake VAD and Whisper |
| api/tests/test_voice_warmup.py | Component/contract: selected voice warmup through stream API | Real route/delivery intent; patched synthetic engine and voice lookup |
| api/tests/test_voice_dataset_revision.py | Component: pinned revision precedence and cached sync metadata | Temporary dataset/manifest; patched repository access/environment |
| api/tests/test_voice_repository_paths.py | Component: service-relative references with junction-backed assets | Temporary filesystem/junction subprocess with context cleanup |
| api/tests/test_model_prefetch.py | Component/contract: import bootstrap and pinned cache completeness | Temporary cache + bounded Python CLI invocation; no model download |
| api/tests/test_doctor_strict.py | Contract: canonical service environment selection | Temporary paths; existing launcher contract unchanged |
| api/tests/test_release_health.py | Contract: stable identity and explicit model readiness | Existing health contract tests; release checks unchanged |

### Required regression map

All Desktop paths below are relative to apps/desktop/tests. These are logical or component
checks with synthetic motion/PCM. They do not qualify inference or animation appearance.

| Required scenario | Deterministic evidence |
| --- | --- |
| Chunk on time; first horizon readiness | integration/avatar/generated-motion: preparation remains pending until the exact execution receives its first horizon |
| Late chunk; delayed phase; obsolete result | integration/avatar/phase-playback-regressions: late opening preparation, pending initial preparation at speech end, delayed horizon without replay of elapsed speech |
| Source cursor underrun and frame continuity | integration/avatar/generated-motion: consumed PCM holds body/fingers on buffering; integration/avatar/phase-playback-regressions: exact forecast boundaries/coarse cursor updates; motion/tests/test_soma_backend.py: source frame/history rollback |
| Stale generation, model replacement, cancellation | integration/avatar/motion-service: stale lease/seed, replaced model, worker cancellation/deadline; integration/avatar/model-replacement: active analyser retained; integration/avatar/generated-motion: queued poses invalidated and adapter cancellation awaited |
| Gesture interruption and recovery | integration/avatar/preview-playback and preview-sequence-race: superseded executions and delayed readiness; integration/avatar/real-rig-clearance: bounded contact/root/arm recovery |
| Profile transitions | integration/avatar/generated-motion: applied profile during replacement, hand recovery before delayed semantic execution; integration/avatar/seeded-preview: fixed seed and existing-lease reroll |
| Incremental PCM, buffering and consumed sample clock | integration/speech/pcm-stream-playback: position vs transport ACK, underrun hold, completion; unit/renderer/pcm-worklet: interpolation across packets |
| Completion, interruption and stale playback events | integration/speech-playback: source-ended completion, retained old callback, manual stop, decode/readiness cancellation; integration/speech/pcm-stream-playback: queued old worklet events ignored after replacement |
| Backpressure and cleanup | integration/speech/pcm-stream-playback: bounded blocked append, oversize reframing, synchronous cancellation; both AudioPlayer suites assert closed contexts, disconnected nodes and cleared timers/listeners |
| PCM before motion readiness; motion arrives during speech | integration/avatar/phase-playback-regressions: audible preparation readiness budget and forecast while playing; generated-motion: PCM joins existing body session |
| Short speech before stroke; cancellation invalidates pending motion | integration/avatar/phase-playback-regressions: speech ends without a nonterminal clock, cancelled speech removed from body queue, stop rejects queued request and ignores late horizon |
| Recovery after speech completion | integration/avatar/phase-playback-regressions: speech stroke released without replanning behind accepted forecast; conversational-gesture: terminal PCM cannot admit a late gesture |
| Fish protocol and actual abort semantics at component level | api/tests/test_tts_stream.py: ordered Float32 PCM, cancellation after finish-input, repeated cancel cycles, receiver race tasks; test_voice_conditioning.py: cancellation submits no more synthetic GPU work |

Real qualification remains in qualifications/speech-motion (Electron, ARDY, real Fish,
VRM, audible/visual review and shared GPU contention) and motion/research qualification
tools. Passing these deterministic tests must never set visualAcceptance to passed.
The existing qualification README is the authority for live prerequisites and results.

### Remaining boundaries

The refactoring does not establish visual naturalness, actual GPU cancellation latency,
audible phoneme synchronization or public-provider availability. Those require the
existing opt-in live runs. The initial full Desktop run observed one Browser Control
local-Chrome closed-target race; its isolated rerun and subsequent full run passed.
No production retry, timeout, skip or assertion relaxation was added to hide it.

### Validation of this refactoring

Completed on 2026-10-27 against the current working tree (including separately authored
animation changes already present during the task):

- desktop:test:fast — 47 files / 172 tests passed.
- desktop:test:regression — 127 files / 582 tests passed.
- Changed test files with shuffled file/test order — 58 files / 323 tests passed for
  each seed, 20261027 and 20261028.
- motion:research:test — 46 passed; api:test — 58 passed.
- desktop:check, desktop:format:check, desktop:imports:check, typecheck,
  api:lint, api:format:check and build passed. Biome reported only the three existing
  informational useTemplate suggestions in qualifications/motion-ab/run.cjs.
- No live Electron/ARDY/Fish qualification was performed for this test-only change.
  No inference/visual acceptance result is claimed.
