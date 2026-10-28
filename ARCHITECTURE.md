# Shio Runtime
## Software Architecture Specification

**Version:** 1.0  
**Status:** Canonical Architecture Specification

## Table of Contents

- [Part 0 - Foundation](#part-0---foundation)
  - [1. Introduction](#1-introduction)
  - [2. Architectural Principles](#2-architectural-principles)
  - [3. Core Architectural Invariants](#3-core-architectural-invariants)
- [Part I - Architectural Philosophy](#part-i---architectural-philosophy)
  - [4. Character Philosophy](#4-character-philosophy)
  - [5. The Illusion Principle](#5-the-illusion-principle)
  - [6. Design Philosophy](#6-design-philosophy)
- [Part II - Architectural Foundation](#part-ii---architectural-foundation)
  - [7. High-Level Architecture](#7-high-level-architecture)
    - [Architectural Layers](#architectural-layers)
  - [8. Shared Character State](#8-shared-character-state)
  - [9. Event Bus](#9-event-bus)
  - [10. Runtime Lifecycle](#10-runtime-lifecycle)
  - [11. Runtime Contracts](#11-runtime-contracts)
  - [12. Runtime Boundaries](#12-runtime-boundaries)
- [Part III - Decision Making](#part-iii---decision-making)
  - [13. Decision Pipeline](#13-decision-pipeline)
  - [14. Conversation Admission](#14-conversation-admission)
- [Part IV - Runtime Systems](#part-iv---runtime-systems)
  - [15. Conversation Runtime](#15-conversation-runtime)
  - [16. Speech Runtime](#16-speech-runtime)
  - [17. Experience Layer](#17-experience-layer)
  - [18. Character Personality Model](#18-character-personality-model)
  - [19. Action Runtime](#19-action-runtime)
  - [20. Avatar Runtime](#20-avatar-runtime)
  - [21. Memory Layer](#21-memory-layer)
  - [21A. Project Awareness Runtime](#21a-project-awareness-runtime)
  - [21B. Plugin Runtime](#21b-plugin-runtime)
  - [21C. Shio Capability Catalog](#21c-shio-capability-catalog)
  - [21D. Responsive Character Pipeline](#21d-responsive-character-pipeline)
  - [21E. World Context, Experience, Attention, and Behavior](#21e-world-context-experience-attention-and-behavior)
  - [21F. Autonomy, Scheduler, and Persistent Goals](#21f-autonomy-scheduler-and-persistent-goals)
  - [21G. Memory Retrieval, Procedural Habits, and Relationship Context](#21g-memory-retrieval-procedural-habits-and-relationship-context)
  - [21H. Latency Observability](#21h-latency-observability)
- [Part V - External Integration](#part-v---external-integration)
  - [22. External Adapters](#22-external-adapters)
- [Part VI - Reference](#part-vi---reference)
  - [23. Glossary](#23-glossary)
  - [24. Future Evolution](#24-future-evolution)
  - [25. Architecture Compliance Checklist](#25-architecture-compliance-checklist)

## Part 0 - Foundation

### 1. Introduction

Shio Runtime is an architecture for building a believable digital character. It is not centered around a specific AI model, rendering engine, speech synthesizer, desktop framework, or streaming platform. Instead, the architecture is organized around clearly defined responsibilities.

Every subsystem exists for one purpose only. Technologies may change. Responsibilities must remain stable.

This document is the canonical architecture specification for the Shio Runtime project. It is the primary reference for architectural terminology, Runtime responsibilities, Runtime boundaries, integration rules, and future evolution. It should be treated as the source of truth for evaluating implementation decisions, work items, and proposed changes to the Runtime.

The purpose of this specification is to define the architectural foundation of the project. It describes the principles, responsibilities, and interactions that every future implementation must follow. Whenever implementation and this specification disagree, the architecture defined here takes precedence until an intentional architectural decision is made and this document is updated.

This specification should be read from the foundation outward: [Chapter 2 - Architectural Principles](#2-architectural-principles) and [Chapter 3 - Core Architectural Invariants](#3-core-architectural-invariants) define the rules that constrain the rest of the document; [Chapter 7 - High-Level Architecture](#7-high-level-architecture) introduces the Runtime topology; [Chapter 11 - Runtime Contracts](#11-runtime-contracts) and [Chapter 12 - Runtime Boundaries](#12-runtime-boundaries) define how Runtime systems remain independent.

### 2. Architectural Principles

These principles define the architectural foundation of Shio Runtime. Every Runtime, Adapter, feature, and future architectural decision must comply with them.

1. **Responsibilities Before Technologies**  
   Shio Runtime is designed around responsibilities, not technologies. Runtime systems are architectural concepts. Providers, frameworks, engines, and libraries are implementation details.
2. **Runtime Executes, LLM Decides**  
   LLMs propose intentions. The Runtime validates them, coordinates state, manages safety, and executes.
3. **One Runtime, One Responsibility**  
   Every Runtime owns exactly one responsibility. Responsibilities must never overlap.
4. **Everything External Is an Adapter**  
   External technologies are never considered part of the Runtime. Runtime systems communicate with architectural concepts; Adapters communicate with technologies.
5. **Runtime Owns Reality**  
   No non-character external action or externally authoritative side effect may bypass Action Runtime. Every such external side effect must pass through Tool Registry, Permission Guard, Action Runtime, and an External Adapter. Character communication output and visual embodiment — speech playback, avatar rendering, overlay projection, visible expressions — are presentation and embodiment, not Tool Actions; they remain owned by Speech Runtime and Avatar Runtime. See [Chapter 19 - Action Runtime](#19-action-runtime).
6. **Experience Is As Important As Execution**  
   Execution changes the world. Experience changes the character. Completed actions may become character experiences.
7. **Preserve the Illusion**  
   Every Runtime exists to preserve the illusion of a living character. Believability matters more than technical sophistication.
8. **The Runtime Exists To Disappear**  
   Users should perceive Shio, not pipelines, controllers, providers, or Adapters.
9. **Character Before Features**  
   The character is the product. Features exist to support the character rather than become goals by themselves.
10. **Composition Over Complexity**  
    Complex behavior should emerge from simple cooperating Runtime systems rather than monolithic controllers.
11. **Long-Term Evolution Over Short-Term Convenience**  
    The architecture should remain valid across technology replacement, new Runtime systems, and new external platforms.

When uncertainty exists, the following questions should be asked:

- Which Runtime owns this responsibility?
- Does this preserve the illusion of the character?
- Does this introduce unnecessary coupling?
- Can this technology be replaced without changing the architecture?
- Does this strengthen Shio rather than expose the Runtime?

### 3. Core Architectural Invariants

Architectural Invariants define properties of Shio Runtime that must never change.

1. **Character State Represents the Present**  
   Character State always describes the current condition of the character. It never represents history, future intentions, completed actions, or temporary events.
2. **Events Represent the Past**  
   Events always describe something that has already happened. They are immutable after publication.
3. **Every Responsibility Has Exactly One Owner**  
   Every architectural responsibility belongs to exactly one Runtime.
4. **Only Action Runtime Changes the External World**  
   No Runtime other than Action Runtime may produce an externally authoritative side effect outside the Runtime — a persistent or externally observable change such as file modification, operating-system command, moderation action, API mutation, or platform control. Character presentation output — speech playback, avatar rendering, overlay projection, visible expressions — is embodiment and communication, not an externally authoritative side effect, and remains owned by Speech Runtime and Avatar Runtime respectively. This clarifies the boundary; it does not weaken Action Runtime's exclusive ownership of external actions. See [Chapter 19 - Action Runtime](#19-action-runtime).
5. **Adapters Never Contain Business Logic**  
   Adapters translate. Runtime systems decide.
6. **Personality Is Independent From Technology**  
   The identity of Shio does not belong to the language model, speech engine, rendering engine, or storage provider.
7. **Experience Always Follows Execution**  
   Experience never performs actions. It interprets completed actions and events.
8. **Runtime Systems Communicate Through Architecture**  
   Runtime systems communicate only through Character State, Event Bus, and public contracts.
9. **Technologies Are Replaceable**  
   No implementation technology is architecturally permanent.
10. **The Character Is More Important Than the Implementation**  
    Preserving the illusion of a believable digital character takes priority over exposing or optimizing implementation details.
11. **Input Separation**  
    Explicit text input and ambient continuous input may share Conversation Runtime, but they do not have to share pre-admission policy. See [Chapter 16 - Speech Runtime](#16-speech-runtime).
12. **Partial Isolation**  
    Partial recognition results never constitute admitted conversation turns. See [Chapter 16 - Speech Runtime](#16-speech-runtime).
13. **Admission Ownership**  
    Only Conversation Admission can start Conversation Runtime. See [Chapter 14 - Conversation Admission](#14-conversation-admission).
14. **Single-Flight**  
    Conversation Admission guarantees at most one active Conversation Runtime instance, and therefore at most one active turn execution, at any moment: one admitted user turn, one active response generation flow, one active speech synthesis flow, one active speech playback flow, one active cleanup and state recovery. The lock is not released after text is received, after speech synthesis ends, or when playback begins or `SpeechFinished` is published if cleanup has not completed — it is released only after Conversation Runtime's terminal completion contract resolves. See [Chapter 15 - Conversation Runtime](#15-conversation-runtime). A component may observe conversation completion, but only the admission owner may select and admit the next turn. Completion events must not create multiple independent backlog-drain paths.
15. **Backlog Bound**  
    Ambient backlog is bounded, temporary, and non-FIFO by design. See [Chapter 14 - Conversation Admission](#14-conversation-admission).
16. **At-Most-One Selection**  
    One admission cycle selects at most one next backlog turn.
17. **Arbitration Optionality**  
    Semantic arbitration is optional and never required for normal text chat.
18. **Deterministic Degradation**  
    Failure of an optional decision model degrades to deterministic behavior, never to an unhandled admission.
19. **Role Isolation**  
    Character generation and decision arbitration are distinct roles, even when implemented by the same provider or the same underlying model.
20. **Technology Independence**  
    Speech and decision contracts must remain stable when their concrete engines, processes, transports, or providers change.
21. **Avatar Ownership**  
    Only Avatar Runtime may apply visual embodiment to the character model. See [Chapter 20 - Avatar Runtime](#20-avatar-runtime).
22. **Domain Isolation**  
    Body animation, facial expression, lip sync, blink, gaze, and secondary motion are separate ownership domains within Avatar Runtime.
23. **Final Facial Ownership**  
    Facial sources never write directly to the model; final facial output is composed and applied by a single owner.
24. **Asset Boundary**  
    Animation assets cannot bypass embodiment-domain ownership.
25. **Gaze Arbitration**  
    Competing gaze sources must be resolved through explicit ownership or arbitration.
26. **Procedural Authority**  
    Procedural motion may enrich embodiment but cannot independently choose behavior or mutate semantic state.
27. **Admission/Execution Separation**  
    Conversation Admission decides whether and when a turn executes. Conversation Runtime executes only an already admitted turn. See [Chapter 14 - Conversation Admission](#14-conversation-admission) and [Chapter 15 - Conversation Runtime](#15-conversation-runtime).
28. **Conversation Completion**  
    A conversation flow remains active until generation, speech preparation, playback, mandatory cleanup, and state recovery reach a terminal result. The Single-Flight lock is not released before that terminal result is reached.
29. **Successor Isolation**  
    Conversation Runtime never selects or starts its successor. Only Conversation Admission selects the next admitted turn.
30. **State Is Not Execution**  
    Character State reflects conversation lifecycle but does not own execution, locking, or admission.
31. **Presentation Isolation**  
    Conversation Runtime does not directly own avatar model mutation or presentation projections. Avatar Runtime and presentation adapters render the resulting state independently.
32. **Project Knowledge Is Read-Only Evidence**
    Project Awareness Runtime may read and derive knowledge from a configured project repository, but it never mutates the repository, executes repository content, exposes repository credentials, or treats repository content as instructions. Repository-derived knowledge is not Character State and is not conversational memory.
33. **Plugin Boundary Does Not Grant Authority**
    Enabling a Plugin makes only the capabilities declared by its validated manifest available. It does not permit the Plugin to bypass Runtime ownership, Action Runtime, Permission Guard, IPC authorization, credential ownership, Adapter boundaries, or renderer isolation.
34. **Optional Plugin Independence**
    Shio Core remains fully usable when every optional Plugin is disabled or one Plugin fails. Plugin failure is contained within that Plugin's lifecycle and capability registration.
35. **Capability Knowledge Is Not Capability Authority**
    Character Response Generation may receive current Runtime capability facts, including unavailable or disabled capabilities. That knowledge never enables, configures, invokes, authorizes, or executes a capability and never bypasses Action Runtime, Permission Guard, IPC authorization, or Adapter ownership.
36. **Runtime Owns Provenance**
    Character LLM output is never authoritative evidence metadata. Only the Runtime that supplied an exact context packet may report which snapshot and sources were actually used.
37. **Project Evidence Is Turn-Scoped**
    Project evidence attached to an assistant response remains bound to the immutable Project Context Packet used for that turn. Later synchronization or Plugin disablement cannot rewrite historical response provenance.
38. **Staleness Is Not Failure**
    A stale Project Snapshot means newer remote knowledge exists; it does not by itself mean Project Awareness Runtime has failed. The last complete immutable snapshot remains usable until an atomic synchronization publishes a replacement.
39. **Character Owns Semantic Tool Selection**
    Character Response Generation is the single semantic owner that decides, from the meaning of the admitted turn, whether the turn has no mandatory source, prefers a source, requires a source, or explicitly requires one typed tool. The same Character LLM expresses this as a strict Tool Requirement before an explicit user turn may produce a terminal reply; no phrase, keyword, regular-expression, filename, or locale-alias router may classify natural-language Project, Web, Browser, Shell, Desktop, or Memory intent. Tool Requirement is only the minimum terminal obligation, never the allowlist for the whole turn. A separate same-LLM initial Tool Plan selects bounded optional or later tools from the original user goal before external evidence is observed. Runtime may accept a terminal reply without a tool for `direct-answer` or `source-preferred`, or after hard required work reaches a typed terminal result.
40. **Turn Grounding Is Composable**
    When one turn calls Project Awareness and then uses that evidence to select or plan an Action, the assistant response preserves both Project Reply Provenance from the exact original packet and Action Reply Grounding from the completed Action Runtime result. Later tool rounds and post-action narration reuse that packet and never perform an implicit second retrieval or snapshot resolution.
41. **Safe Stream Commit**
    Provider stream bytes are untrusted protocol data. Internal tool, memory, action, embodiment, and emotion-control markers are incrementally contained before any text delta reaches chat, TTS, Memory, or another user-visible projection. A native tool round that begins with a tool call commits no visible or speakable text.
42. **Conversation Admission Remains Singular**
    Attention Evaluation, Fast Brain, Experience Runtime, Scheduler Runtime, Behavior Runtime, and autonomous initiative may request or enrich a turn, but none may directly start Conversation Runtime. The existing renderer-owned Conversation Admission remains the only grantor of conversational execution.
    Autonomous conversation initiatives first pass the Main-owned Proactive Initiative Gate; explicit user input does not.
43. **Autonomy Does Not Grant Authority**
    Autonomy Envelope may defer, preview, or authorize an already allowlisted internal initiative according to user policy. It never bypasses Action Runtime, Permission Guard, validation, verification, cancellation, or logging for an externally authoritative side effect.
44. **Future Intent Is Not Present State**
    Persistent Goals, Scheduled Tasks, pending confirmations, habits, and checkpoints are durable future-oriented records owned by their Main-process Runtime and Store. They are not Character State, conversation history, or semantic Memory records.
45. **World Context Is Bounded Metadata**
    World Context contains typed, freshness-aware activity facts needed for decisions. It never stores raw DOM, screen pixels, ambient transcript, conversation text, Browser Observation, or repository content. Privacy Mode prevents optional model classification and autonomous initiatives.
46. **Habits Require Confirmation**
    Repeated runtime-confirmed evidence may create a habit suggestion, never a silent durable belief. A suggestion becomes approved or rejected only through an explicit user decision and does not weaken Semantic Memory v1's explicit remember/update/forget policy.

## Part I - Architectural Philosophy

### 4. Character Philosophy

Shio is not an assistant controlling an avatar. Shio is a digital character whose body, voice, memory, and actions are coordinated by the Shio Runtime.

This distinction defines the entire architecture. The Runtime exists to coordinate every subsystem required to create a believable digital character. The character remains the center of every architectural decision, and every future subsystem should strengthen the illusion of interacting with a living character rather than expose implementation details.

### 5. The Illusion Principle

The primary objective of Shio Runtime is not automation. The primary objective is maintaining the illusion of life.

Breathing exists because living beings breathe. Blinking exists because living beings blink. Idle motion exists because living beings are never perfectly still. Memory exists because living beings remember. Experience exists because living beings react to the consequences of their own actions.

A feature that increases realism is often more valuable than a feature that increases complexity. Whenever architectural decisions are made, preserving the illusion of a living character should be preferred over exposing technical implementation details.

### 6. Design Philosophy

The architecture is driven by design philosophies rather than implementation patterns.

- **The Character Comes First.** Every architectural decision should begin with the question: "Does this make Shio feel more like a believable character?"
- **Runtime Before Features.** New features should emerge from the Runtime architecture. The Runtime should not be reshaped around individual integrations or features.
- **Composition Over Complexity.** New behavior should preferably be created by combining existing Runtime systems, such as Speech Runtime, Experience Layer, Memory Layer, Action Runtime, and Character State.
- **Observable Behavior Before Internal Logic.** Users only observe behavior. Architecture should prioritize visible believability over invisible sophistication.
- **Loose Coupling, Strong Contracts.** Runtime systems should communicate through Character State, Event Bus, and public contracts, and remain independently understandable.
- **Evolution Without Rewrite.** The architecture should evolve continuously through extension rather than large-scale replacement.
- **Replaceability Is a Design Goal.** Replacing the LLM provider, ASR engine, TTS engine, rendering library, desktop framework, or storage provider should require Adapter or internal Runtime changes, not architectural redesign.
- **Character Consistency Over Intelligence.** A slightly less capable but more consistent character is preferable to a more capable but inconsistent one.
- **Architecture Before Optimization.** Understandability, maintainability, replaceability, and extensibility take precedence over premature optimization.
- **Build Platforms, Not Integrations.** New external services should fit into existing abstractions and usually arrive as new Adapters.
- **Long-Term Thinking.** Preferred solutions remain valid after replacing technologies, adding Runtime systems, and extending character capabilities.

## Part II - Architectural Foundation

### 7. High-Level Architecture

Shio Runtime is composed of a small number of independent Runtime systems. No Runtime is considered the main controller of the application. Character behavior emerges from the cooperation of multiple Runtime systems rather than from a monolithic orchestrator.

#### Alpha Launcher boundary

The Windows Alpha Launcher is a release-infrastructure component, not a Runtime and not part of the character decision pipeline. It may install and repair a versioned Local Speech API package, prefetch revision-pinned model assets into persistent release data, coordinate a process that it started, validate the stable service identity and readiness fields exposed by the backwards-compatible Speech HTTP health contract, launch Desktop, and stop only the API process whose complete ownership identity it recorded and revalidated. It never performs ASR or TTS, imports Desktop or API implementation code, changes Speech Runtime ownership, or terminates an externally managed process. Desktop and Local Speech API remain independently runnable applications; the launcher only coordinates the packaged alpha experience.

The repository layout reflects these process boundaries: `apps/desktop` contains the
Electron Desktop application, `apps/api` contains the Python Speech API application,
`launcher` contains release installation and process coordination, `scripts` contains
repository and release tooling, and `docs` contains product, architecture, and release
documentation. This source layout does not merge the Desktop and Speech API lifecycles
or make the launcher a Runtime.

Architecture overview:

```text
                         Character
  -----------------------------------------------------------------
                         Visible Shio
  -----------------------------------------------------------------
                               |
                               v
                       Input Sources
        (Speech Runtime input side / Explicit Input Surface)
                               |
                               v
                        Decision Pipeline
                               |
                               v
                      Conversation Admission
                               |
                               v
                       Conversation Runtime
                               |
                               v
                Character Response Generation
                               |
                               v
                Speech Runtime (output side)
                               |
                               v
              Shared Character State  <->  Events
                               |
                               v
      Avatar Runtime  |  Experience Layer  |  Projections
                               |
                               v
                         Action Runtime
  -----------------------------------------------------------------
                               |
                               v
                         Adapter Layer
  -----------------------------------------------------------------
     AI Adapters | Speech Adapters | Platform Adapters | Storage
  -----------------------------------------------------------------
                               |
                               v
                         External World
  -----------------------------------------------------------------
  Microphone | Keyboard / UI | APIs | Platforms | Local Services
```

Conversation Runtime coordinates only one admitted conversational turn at a time; it is not depicted as a central controller of the application. Memory Layer is omitted from this diagram for brevity but continues to observe completed outcomes as described in [Chapter 21 - Memory Layer](#21-memory-layer). Project Awareness Runtime is also omitted from the primary character flow: it reads a configured repository through a Project Repository Adapter, builds a commit-scoped knowledge projection, and supplies grounded evidence only when Character Response Generation calls the available `project.search` tool. See [Chapter 21A - Project Awareness Runtime](#21a-project-awareness-runtime).

#### Architectural Layers

Shio Runtime is organized around four architectural layers:

- **Character:** the digital entity experienced by the user. The character is the reason the architecture exists.
- **Runtime:** the set of independent Runtime systems that coordinate voice, body, memory, actions, experience, and state.
- **Adapters:** translation layers that isolate Runtime systems from implementation technologies and external providers.
- **External World:** everything outside Shio Runtime, including operating systems, APIs, streaming platforms, providers, storage systems, and local services.

Architectural responsibility flows from Character intent through Runtime responsibilities and Adapter translation into the External World. The reverse path returns normalized results, Events, and state updates into the Runtime. See [Chapter 19 - Action Runtime](#19-action-runtime) and [Chapter 22 - External Adapters](#22-external-adapters).

Core Runtime systems:

- Speech Runtime: speech-domain input and output — recognition and synthesis
- Decision Pipeline: transforms recognized input into an admission decision
- Conversation Admission: the single boundary permitting Conversation Runtime to start
- Conversation Runtime: execution of one admitted conversational turn
- Experience Layer: emotional interpretation of completed events
- Action Runtime: execution of external side effects
- Avatar Runtime: physical embodiment of the character
- Memory Layer: continuity across interactions
- Project Awareness Runtime: commit-scoped, read-only knowledge about the configured project
- Plugin Runtime: optional bundled extension lifecycle and typed capability registration
- Shared Character State: canonical current condition of the character
- Event Bus: delivery of completed facts between Runtime systems

Conversation Admission and Conversation Runtime are distinct: Conversation Admission decides whether and when a turn executes; Conversation Runtime executes only an already admitted turn. See [Chapter 14 - Conversation Admission](#14-conversation-admission) and [Chapter 15 - Conversation Runtime](#15-conversation-runtime).

High-level flow:

1. External input reaches Speech Runtime or an explicit input surface.
2. Decision Pipeline determines whether and how the input should be processed.
3. Conversation Admission decides whether, when, and which turn is admitted.
4. Conversation Runtime executes the admitted turn to completion.
5. Character State is updated to reflect the current condition of the character.
6. Runtime systems independently observe Character State and Events.
7. If external effects are required, Action Runtime executes them through Adapters.
8. Completed outcomes may become experiences and later become memories.

This architecture deliberately avoids direct Runtime-to-Runtime command chains. See [Chapter 8 - Shared Character State](#8-shared-character-state), [Chapter 9 - Event Bus](#9-event-bus), and [Chapter 11 - Runtime Contracts](#11-runtime-contracts).

### 8. Shared Character State

Character State is the single source of truth describing the current observable condition of Shio. Every Runtime contributes to it within its own responsibility, and every Runtime may observe it.

Character State does not belong to Speech Runtime, Avatar Runtime, or the LLM. It belongs to Shio.

Architectural rules:

- Runtime systems should coordinate through shared state rather than direct control whenever possible.
- Runtime systems exchange state, not implementation details.
- A Runtime may contribute only within its own responsibility.
- Character State represents what is true now, never historical events.
- One `CharacterStateStore` owns the canonical renderer-side value. Consumers receive a read-only snapshot contract; contributors receive narrow domain writers rather than a generic patch API.
- Conversation, Speech, Admission, and Avatar writers expose only the transitions or projections owned by that domain. In particular, Speech input cannot overwrite conversational emotion, and Avatar projection cannot overwrite semantic conversation state.
- Controller UI state contains presentation concerns such as drafts, selected views, dialog visibility, and local loading state. It must not reconstruct a second Character State projection.

Observable dimensions include:

- **Runtime Mode:** Idle, Listening, Thinking, AwaitingSpeech, Speaking, Acting
- **Emotion:** the current emotional state of the character
- **Attention:** the current focus of the character
- **Speech:** listening, recognition, generation, speaking, silence
- **Activity:** answering, executing a tool, moderating chat, reacting, waiting
- **Avatar State:** active animation, expression, gesture, lipsync, breathing, idle control
- **Memory Context (future):** memory-relevant present context
- **Conversation Context (future):** present conversational context
- **Speech Input Activity (read-only projection):** whether continuous input is currently listening
- **Conversation Busy State (read-only projection):** whether a conversation response flow is currently active, in support of the Single-Flight invariant
- **Backlog Presence (read-only projection):** whether a bounded utterance backlog currently holds pending candidates, without exposing backlog contents as state
- **Admission State (read-only projection):** the current phase of Conversation Admission
- **Current Input Source (read-only projection):** whether the active or most recent turn originated from explicit input or ambient input
- **Active Conversation Turn (read-only projection):** the identity of the turn Conversation Runtime is currently executing, if any
- **Conversation Phase (read-only projection):** the current phase of the Conversation Turn Lifecycle, mirroring Conversation Presence
- **Response Generation Activity (read-only projection):** whether Character Response Generation is currently in progress
- **Speech Preparation Activity (read-only projection):** whether speech preparation for the current turn is currently in progress
- **Conversation Terminal Status (read-only projection):** the most recent terminal outcome of Conversation Runtime
- **Current Embodiment Mode (read-only projection):** the high-level embodiment mode Avatar Runtime is currently expressing
- **Current Body Animation Intent (read-only projection):** the semantic body animation intent currently selected
- **Current Facial Intent (read-only projection):** the semantic facial intent currently selected
- **Speech / Lip-Sync Activity (read-only projection):** whether lip-sync contribution is currently active
- **Gaze Ownership Source (read-only projection):** which gaze source currently holds gaze ownership
- **Secondary Motion Activity (read-only projection):** whether secondary motion is currently contributing

These projections carry identity and status information only. Character State never stores a Promise, a lock object, backlog contents, a provider object, an audio buffer, or internal retry state; those remain internal to the Runtime that owns them, most commonly Conversation Runtime or Speech Runtime.

Character State stores the final result. For example, the LLM may suggest an emotion, Experience Layer may modify it, and Avatar Runtime renders it, but Character State remains the canonical observable record.

These read-only projections mirror facts owned elsewhere. Shared Character State does not own the Utterance Backlog, does not perform selection, does not perform arbitration, and does not control Conversation Runtime. It remains a read-only projection of those facts, not an orchestration engine. See [Chapter 14 - Conversation Admission](#14-conversation-admission).

The embodiment projections above follow the same rule. Shared Character State does not own avatar controllers, does not apply model values, does not compose facial contributions, does not select animation, and does not resolve gaze conflicts. It mirrors the outcome that Avatar Runtime owns; it does not become an embodiment orchestration engine. See [Chapter 20 - Avatar Runtime](#20-avatar-runtime).

### 9. Event Bus

The Event Bus is the communication backbone of Shio Runtime. Character State answers "What is true right now?" The Event Bus answers "What just happened?"

Character State is persistent. Events are transient. An event is consumed; a state is observed.

Event categories include:

- Speech Events: `ListeningStarted`, `RecognitionCompleted`, `SentenceGenerated`, `SpeechStarted`, `SpeechFinished`
- Character Events: `ModeChanged`, `EmotionChanged`, `AttentionChanged`, `ActivityChanged`
- Avatar Events: `AnimationStarted`, `AnimationFinished`, `GestureFinished`, `BlinkCompleted`
- Action Events: `ToolRequested`, `ToolStarted`, `ToolCompleted`, `ToolFailed`, `PermissionDenied`
- Experience Events: `ReactionStarted`, `ReactionCompleted`, `JokeSelected`, `SilenceSelected`
- System Events: `RuntimeInitialized`, `RuntimePaused`, `RuntimeResumed`, `RuntimeShutdown`
- Conversation Lifecycle Events: speech started, partial updated, utterance completed, utterance admitted, utterance buffered, utterance discarded, conversation started, conversation completed, playback started, playback completed
- Embodiment Lifecycle Events: body animation requested, body animation started, body animation completed, facial intent changed, lip sync started, lip sync completed, gaze ownership changed, secondary motion activated, embodiment returned to neutral

Architectural rules:

- Events are immutable.
- Events describe the past.
- Events never describe intentions.
- Runtime systems publish and subscribe through the Event Bus rather than directly invoking each other.
- When both Character State and Events are involved, Character State should be updated before publishing the Event so observers see the newest state.
- Event publication does not grant ownership. Subscribers may observe or project state, but they must not bypass the owning Runtime or the Conversation Admission boundary. See [Chapter 14 - Conversation Admission](#14-conversation-admission).
- Event subscribers may observe embodiment lifecycle events, but they may not mutate the character model outside Avatar Runtime. See [Chapter 20 - Avatar Runtime](#20-avatar-runtime).

The Event Bus does not store state. It distributes completed facts.

### 10. Runtime Lifecycle

Every Runtime follows a predictable architectural lifecycle independent of implementation details.

Lifecycle phases:

1. **Runtime Bootstrap**  
   Create Runtime instances only. No model loading, graphics initialization, or background work.
2. **Runtime Initialization**  
   Each Runtime initializes only its own responsibility and resources.
3. **Character Initialization**  
   Establish the initial Character State, typically `Mode = Idle`, `Emotion = Neutral`, `Attention = None`, `Speech = Silent`, `Activity = Waiting`.
4. **Ready / Idle**  
   The Runtime is fully operational and waiting for external events.
5. **Runtime Execution**  
   Runtime systems continuously observe Character State, Events, and external input. No Runtime becomes the central coordinator.
6. **Runtime Shutdown**  
   Stop accepting new work, complete current work when possible, and release resources.
7. **Resource Cleanup**  
   Dispose resources owned by each Runtime.

Execution includes both:

- **Interaction Loop:** external input moves through the decision architecture and updates Character State.
- **Passive Runtime Loop:** continuous behaviors such as blinking, breathing, idle movement, animation blending, memory maintenance, and scheduler timers.

Future versions may support suspension and resumption of selected Runtime systems without reinitialization.

### 11. Runtime Contracts

Every Runtime follows the same architectural contract. A Runtime is defined by the responsibility it owns rather than the technology it uses.

Every Runtime:

- owns one responsibility
- owns its internal state
- owns its resources
- exposes a public contract
- observes Character State
- publishes Events
- evolves independently

Contract details:

- **Ownership:** each Runtime owns its implementation and domain. Ownership must never overlap.
- **Resource Ownership:** each Runtime owns every resource it creates, including worker threads, timers, GPU resources, network connections, audio devices, and caches.
- **Public Contracts:** Runtime systems interact only through small, stable public interfaces. Internal implementations remain private.
- **Character State Contribution:** a Runtime may update Character State only within its own responsibility.
- **Event Publishing:** Runtime systems publish completed facts such as `SpeechFinished`, `ToolCompleted`, `MemoryStored`, or `AnimationFinished`.
- **Runtime Independence:** Runtime systems depend on contracts, not on each other's implementation details.
- **Lifecycle Ownership:** every Runtime owns the initialization, execution, suspension, resumption, and shutdown of its own resources.

The Runtime Contract guarantees that Runtime systems remain independently understandable and compatible with the larger architecture.

### 12. Runtime Boundaries

Every Runtime owns a clearly defined architectural boundary. A boundary defines where one responsibility ends and another begins.

Boundaries by Runtime:

- **Speech Runtime** begins with the verbal-communication transport or domain boundary. On the input side it ends at a recognized speech event; on the output side it ends after a completed speech playback event. It does not end at "Action intentions" and does not own semantic decision-making.
- **Decision Pipeline** evaluates intent and ends once a decision has been made. Execution belongs elsewhere.
- **Conversation Runtime** begins when Conversation Admission admits one completed turn. It ends when response generation, speech output, playback, mandatory cleanup, and state recovery reach a terminal outcome. It executes a turn but does not decide whether the turn should exist or which turn should follow. See [Chapter 14 - Conversation Admission](#14-conversation-admission) and [Chapter 15 - Conversation Runtime](#15-conversation-runtime).
- **Action Runtime** begins when an external side effect is requested and ends when execution completes and a result is produced.
- **Experience Layer** begins after something has happened and ends after the character's reaction has been determined.
- **Avatar Runtime** begins when Character State changes and ends after that state has been visually represented.
- **Memory Layer** begins when continuity may need to be preserved and ends after significance has been evaluated, memory has been retrieved or stored, or insignificant information has been discarded.
- **Project Awareness Runtime** begins at a read-only repository snapshot identity and ends after commit-scoped project knowledge, retrieval evidence, or recent-change context has been produced. It does not own Character State, conversational memory, repository mutation, or action execution.
- **Plugin Runtime** begins with bundled Plugin discovery and validated registration and ends with lifecycle status and registration or removal of declared typed capabilities. It does not own Plugin business logic, Character State, actions, permissions, or concrete Adapters.
- **External Adapters** begin where Runtime responsibilities end and translate Runtime concepts into technology-specific operations.

Clear boundaries prevent duplicated logic, circular dependencies, hidden side effects, and difficult maintenance. See also [Chapter 19 - Action Runtime](#19-action-runtime) and [Chapter 22 - External Adapters](#22-external-adapters).

## Part III - Decision Making

### 13. Decision Pipeline

Decision Pipeline is the reasoning flow that transforms incoming input into character behavior. Its purpose is not to generate language. Its purpose is deciding what should happen next.

The architecture follows a layered decision model. The simplest component capable of making the correct decision should make that decision.

Decision layers:

1. **Intent Router**  
   Performs extremely lightweight input-source and admission classification such as conversational candidate, ignored speech, background speech, or explicit system request. It never selects Character capabilities or tools from natural language.
2. **Rule Gate**  
   Applies deterministic rules such as wake phrases, filler-word rejection, duplicate filtering, confidence thresholds, cooldown timers, and command prefixes.
3. **Optional Intent LLM**  
   Resolves admission ambiguity only, such as whether the character was actually addressed or whether a message should be ignored. Its output is intentionally simple, such as `RESPOND`, `IGNORE`, or `SYSTEM_COMMAND`; it never chooses a Character tool.
4. **Character LLM**  
   Handles personality, dialogue, humor, emotional tone, creativity, reasoning, and tool intentions.
5. **Action Runtime**  
   Executes requested external effects only after Runtime validation.
6. **Experience Layer**  
   Interprets completed outcomes as character experiences.

Architectural guarantees:

- deterministic rules are preferred for admission, validation, and policy decisions that do not require understanding the meaning of natural language
- small models do not replace the primary character model
- the Character LLM remains the single semantic decision-maker for reply content and typed capability selection
- Runtime always owns execution
- every completed action may become an experience
- no single component becomes responsible for the entire decision process

**Recognized Utterance to Admission Decision**

Decision Pipeline owns the transition from a recognized utterance to an admission decision: recognized utterance, semantic evaluation, admission decision. Depending on input source and ambiguity, this transition may involve some or all of the following internal components. These are internal components of the Decision Pipeline, not additional top-level Runtime systems:

- **Utterance Assembly:** accepts partial recognition snapshots, assembles a completed utterance, never invokes the Character LLM on a partial snapshot, yields exactly one completed semantic input per speech segment, and guards against duplicate final or completion events.
- **Attention Evaluation:** evaluates relevance, directness, and context, optionally depending on a configured attention mode. It never generates a response, never triggers an external effect, and never bypasses Conversation Admission.
- **Rule Evaluation:** applies deterministic rules to accept or reject an utterance. It may consult an external classifier only in explicitly allowed ambiguous cases, and it never invokes Conversation Runtime directly.
- **Backlog Selection:** while the current response flow is busy, accumulates candidates into the Bounded Utterance Backlog — storing, deduplicating, expiring, and updating them — without selecting among them. Only after the current flow reaches terminal completion does selection choose, under Conversation Admission ownership, at most one next candidate. Selection does not run in the middle of an active flow unless a future barge-in capability explicitly allows it. See [Chapter 14 - Conversation Admission](#14-conversation-admission).
- **Optional Arbitration Adapter:** an optional, replaceable semantic classifier consulted only when deterministic selection cannot produce a sufficiently clear result. See [Chapter 14 - Conversation Admission](#14-conversation-admission).

The outcome of Decision Pipeline is always an admission decision, never a direct invocation of Conversation Runtime. See [Chapter 14 - Conversation Admission](#14-conversation-admission).

### 14. Conversation Admission

**Purpose**  
Conversation Admission is the architectural boundary that governs entry into Conversation Runtime. It is not a place where dialogue is generated or characters are expressed; it is a gate.

**Responsibility**

Conversation Admission owns:

- whether a completed user turn may enter Conversation Runtime now
- whether it must wait
- whether it must be discarded
- which one pending turn may be selected next, when more than one candidate exists

**Single Admission Owner**

Conversation Admission is the only architectural entry point into Conversation Runtime. No other component may directly start a new conversation flow, including: the speech recognition event handler, Utterance Assembly, Attention Evaluation, Rule Evaluation, the Bounded Utterance Backlog, an Arbitration Adapter, a speech playback completion callback, a UI lifecycle callback, or an Event Bus subscriber. Any of these may request admission; none may grant it to themselves.

**Admission vs Execution**

Conversation Admission owns whether, when, and which turn: whether a conversation may start, whether it must wait, which pending turn should be selected, and whether input should be discarded. Conversation Runtime owns how one already-admitted turn executes to completion; it does not choose the next turn and does not drain the backlog. Conversation Admission admits. Conversation Runtime executes. Conversation Runtime never admits itself and never selects its successor. Completion of Conversation Runtime returns control to Conversation Admission through a stable completion contract, not through arbitrary playback or state callbacks. See [Chapter 15 - Conversation Runtime](#15-conversation-runtime).

**Single-Flight**

Conversation Admission enforces the Single-Flight invariant: at most one admitted user turn, one active response generation flow, one active speech synthesis flow, and one active speech playback flow at any moment. See [Chapter 3 - Core Architectural Invariants](#3-core-architectural-invariants).

**Busy Input Policy**

When Conversation Runtime is busy with an active flow, a newly completed ambient utterance is not discarded outright and is not force-queued in arrival order. It becomes a candidate for the Bounded Utterance Backlog, described below. Explicit input follows its own admission path and is not required to pass through ambient backlog arbitration. See [Chapter 16 - Speech Runtime](#16-speech-runtime) for the distinction between explicit and ambient input.

**Bounded Utterance Backlog**

The backlog holds only completed ambient utterances, only briefly, and only while the current conversation flow is busy. It stores just enough to support later selection.

It must not become: a raw audio archive, a PCM buffer, an ASR partial history, permanent conversation memory, a FIFO command queue, a replay log, or a Character LLM context store.

Architecturally, the backlog has: bounded capacity, bounded lifetime, deduplication, expiration, and consumption tracking. This specification intentionally does not fix concrete sizes, timeouts, or thresholds; those are implementation tuning values.

Selection semantics:

- The backlog does not replay every utterance. It produces at most one next conversation turn per admission cycle.
- Several related utterances may be merged into one semantic turn when this preserves the user's intent.
- Stale, duplicate, low-value, and likely self-echo utterances may be discarded. See [Self-Echo](#23-glossary) in the Glossary.

**Optional Semantic Arbitration Adapter**

When deterministic backlog selection cannot produce a sufficiently clear result, Conversation Admission may consult an Optional Semantic Arbitration Adapter. This is a replaceable classifier role, not a named provider or model.

It may help: choose between ambiguous backlog candidates, determine whether utterances are related, merge related utterances, classify a correction or follow-up, and return a structured decision.

It must never: respond to the user, play the role of Shio, use the Character persona, change Character State directly, invoke Tools, invoke Conversation Runtime, produce external effects, or replace deterministic policy as the default path.

Activation and failure semantics:

- Arbitration is optional and is invoked only when deterministic selection cannot produce a sufficiently clear result.
- Ordinary text chat does not use ambient backlog arbitration.
- When continuous listening is disabled, the arbitration adapter is inactive.
- Arbitration failure — including timeout, unavailable provider, invalid structured result, low confidence, staleness, or cancellation — must degrade to deterministic selection or safe discard. It must never leave an utterance unresolved.

**LLM Role Separation**

The Character LLM and any decision or arbitration model are separate architectural roles, even when implemented by the same provider or the same underlying model:

- **Character LLM** owns character response generation, persona, dialogue style, and reply content.
- **Decision or Arbitration Model** may own narrow structured classification, selection, ranking, or merge decisions only.

Each role keeps: separate prompts, separate contracts, separate output schemas, independent configuration, and no persona in the decision model.

**Self-Echo**

Continuous input may capture the character's own speech output. Decision Pipeline and Conversation Admission must be able to mark or reject likely self-echo before admission. This specification does not fix the detection algorithm; possible implementations include playback correlation, timing correlation, transcript similarity, echo cancellation metadata, or source classification. A playback-time utterance must not be automatically treated as self-echo, since a direct user correction spoken during playback may remain a valid candidate.

**Architectural Guarantees**

- Conversation Runtime has exactly one entry point.
- Busy-time ambient input does not bypass admission and does not silently accumulate without bound.
- Selection remains deterministic by default; semantic arbitration is an optional refinement, not a requirement.
- Text chat is unaffected by ambient backlog policy.

**Future Evolution**

The optional arbitration contract described above — the adapter boundary, structured decision, role isolation, deterministic fallback, and stale-result rejection — is part of the current architecture. More capable semantic arbitration strategies, such as richer semantic ranking, advanced merge quality, or speaker-aware arbitration, remain future evolution. Barge-in and interruptible speech output are also described in [Chapter 24 - Future Evolution](#24-future-evolution) as planned capabilities, not current guarantees.

## Part IV - Runtime Systems

### 15. Conversation Runtime

**Purpose**  
Conversation Runtime is responsible for executing one admitted conversational turn from accepted user input to completed character response. It does not decide whether Shio should respond — that has already been decided by Decision Pipeline and Conversation Admission before the turn reaches it. Conversation Runtime executes an admitted turn; it does not admit turns and does not decide which turn should exist.

**Start and End Boundary**

Conversation Runtime's responsibility begins when Conversation Admission admits one completed user turn. It ends when response generation, speech preparation, playback, mandatory cleanup, and state recovery have reached a terminal outcome — success or failure — and a completion result has been returned to Conversation Admission. See [Chapter 12 - Runtime Boundaries](#12-runtime-boundaries).

**Conversation Turn Lifecycle**

The abstract lifecycle of one admitted turn:

```text
Admitted
  -> Preparing Response
  -> Generating Response
  -> Preparing Speech
  -> Speaking
  -> Finishing
  -> Completed
```

Admissible failure outcomes at any phase: Generation Failed, Speech Preparation Failed, Playback Failed, Cancelled. After any terminal outcome — success or failure — Conversation Runtime must restore a stable, consistent observable state before returning its completion result.

**Responsibilities**

Conversation Runtime owns:

- execution of one admitted turn
- orchestration of the Character Response Generation contract
- transition through conversation phases
- coordination of response text and speech output
- waiting for actual speech playback completion, not merely playback start
- publication of conversation lifecycle events
- recovery to a stable state after success, failure, or cancellation
- the completion contract consumed by Conversation Admission

Its implementation depends on narrow application ports: `CharacterResponsePort`, `SpeechOutputPort`, a domain-limited Conversation State writer, and Event Bus. Presentation reactions are emitted through a presentation port that contains rendering failures; Conversation Runtime never imports Avatar Runtime, Overlay Runtime, or AudioPlayer implementations. AudioPlayer remains the sole playback owner behind `SpeechOutputPort`, while Overlay remains a projection consumer rather than a participant in conversation lifecycle.

**Non-Responsibilities**

Conversation Runtime does not own:

- speech recognition
- voice activity detection
- utterance assembly
- attention evaluation
- Rule Gate
- backlog selection
- deciding whether a turn should be admitted
- selecting a second pending turn
- personality definition
- final avatar model mutation
- action execution
- memory persistence
- provider-specific APIs
- overlay publication or avatar implementation details

**Public Contract**

The contract is described conceptually; no concrete interface is fixed by this specification.

*Input — Admitted Conversation Turn.* Architecturally significant data includes: immutable turn identity, user input, input source, admission metadata, optional merged-utterance references, and cancellation context.

*Output — Conversation Completion Result.* Possible outcomes: Completed, Failed, Cancelled. Additional data may include: generated response identity, failure category, whether speech began, and whether playback completed.

The Conversation Runtime completion contract resolves only after the entire admitted response flow has reached a terminal state — not merely after audio has started playing, and not merely after a recognizable playback-ended signal has fired, but after any mandatory cleanup and state recovery tied to that signal has also completed. See [Invariant 28 - Conversation Completion](#3-core-architectural-invariants).

**Character Response Generation**

Conversation Runtime obtains reply content through a replaceable Character Response Generation contract, a responsibility within the execution of a conversational turn rather than a separate top-level Runtime. Behind this contract may be a Character LLM, a local model, a remote provider, a deterministic reply generator, or a future composite system.

The Character LLM owns: reply content, personality expression, dialogue style, reasoning, emotional tone, and action intentions. It does not own: admission, playback, Character State lifecycle, Avatar Runtime, or Action Runtime execution. This mirrors the LLM Role Separation described in [Chapter 14 - Conversation Admission](#14-conversation-admission): Character Response Generation and any decision or arbitration model remain separate roles even when backed by the same provider.

For each admitted turn, orchestration resolves the current Runtime Capability Context and builds a Character Tool Registry containing only tools that are actually available for that request. The Registry is a read-only catalog, not a Runtime or authority owner. Before an explicit user turn produces user-visible text, the same Character LLM performs a strict typed planning phase and returns two independent decisions: one Tool Requirement (`direct-answer`, `source-preferred`, `required-source`, or `explicit-tool`) describing the minimum obligation before a terminal reply, and one bounded initial Tool Plan describing tools that may materially help complete the original user goal. An explicitly requested tool remains a hard requirement even when it is unavailable. Current public facts and claims about current repository or browser state use hard required sources; generic self-knowledge, brainstorming, or background sources may be preferred rather than mandatory. Natural-language requirement and capability selection belong exclusively to the Character LLM and may not be inferred by phrase, keyword, regular-expression, filename, technical-symbol, or locale-alias rules in application code. This planning phase is part of Character Response Generation, not a separate router model or Runtime.

Character Request Composer is a bounded orchestration component, not a Runtime. It
assembles optional, request-scoped sections for stable Persona, Response Policy,
current Mood, Relationship Context, foreground Goal, Memory availability,
Capabilities, Project, World Context, and Tool Results. Every section and the total
request have explicit character budgets. Allocation is not first-come-first-served:
before any section expands, every present section receives a bounded minimum reservation.
The remaining budget is distributed in priority tiers: stable Persona, Response Policy,
and current Tool Results; then foreground Goal, Project evidence, and World evidence;
then Memory availability, Relationship continuity, and Mood; then compact Capability
explanation. Expansion is fair among sections in one tier and never changes the fixed
total cap. Normal turns receive a compact capability projection, one foreground
unfinished goal plus the count of other unfinished goals, and at most a few approved
relationship or habit motifs. Full stores and inventories are obtained only through
their typed tools; they are never dumped into every prompt.

One Character Tool Loop coordinates all tool-capable Character reasoning inside the same turn. It returns each typed Runtime result with its source tool identifier to the same Character Response Generation context and permits sequential cross-capability flows such as Project then Shell or Project then Browser before the final Shio response. The loop is not a Runtime and grants no authority. It validates the Tool Requirement, withholds an unsourced draft while hard required work remains pending, and permits a terminal response only after that requirement is satisfied or Runtime records a typed failed/unavailable outcome. A preferred source may improve an answer but its absence does not force a failure presentation. A hard-source failure never authorizes substituting remembered knowledge for required evidence. The provider receives only available definitions selected by the initial Tool Plan plus the hard or preferred source family; satisfying the terminal requirement does not remove those definitions or end arbitration. This bounds request size without turning Tool Requirement into a turn-wide allowlist. Tool-result continuation context is also bounded: superseded Browser Observations are removed while their typed Action statuses remain, and only the latest Browser Observation is retained for the next decision. The loop has a turn-owned `AbortSignal`, a wall-clock deadline, a maximum of eight tool rounds, and a maximum of sixteen total calls; reaching a bound produces an honest bounded final response instead of another call. A provider failure during continuation is presented as a provider failure and is never masked by presentation of an earlier Action result.

The loop also owns a bounded Turn Tool Evidence summary containing the typed requirement, attempted and failed tool identifiers, and success/count/freshness facts for Web, Project, Browser, and Memory evidence. It derives these facts only from Runtime dispatch results, never from assistant prose. Character may claim that information was searched, checked, verified, or found through a source only when current-turn evidence reports success. The immediately previous summary may be retained with short-lived conversation history solely to answer retrospective questions about actual tool use; it contains no raw result, DOM, repository content, Memory record, credential, or authority and never satisfies a current-turn requirement. Main tags assistant history with a typed presentation origin. Provider failures, Tool Requirement failures, and Runtime fallbacks are not included as normal Character prose in later semantic requirement planning.

The Character Tool Dispatcher validates the selected tool and delegates it to its architectural owner. `project.*` delegates to Project Awareness Runtime; `memory.*` delegates through Memory Tool Broker and Memory Policy to Memory Runtime; browser reads and mutations retain Browser Control ownership, with externally authoritative browser operations going through Action Runtime; Shell and Desktop effects always go through Action Runtime, deterministic risk policy, Permission Guard, verification, and the owning Adapter. The Dispatcher is only typed coordination and may not absorb execution, policy, storage, retrieval, or Adapter ownership.

The turn-local Tool Influence Context records the immutable original user goal and
keeps Authority Provenance separate from Evidence Provenance. Authority identifies
an `explicit-user-turn`, `approved-workflow`, or `autonomous-scope` and the bounded
capabilities established from that source before external evidence is consumed.
Evidence records Project, Browser, Web Search, Memory, or Goal origins together with
the capability state at observation time. Evidence may supply typed values, including
an exact Browser Control session, page, observation, or semantic-target identity, but
it never supplies permission. Using evidence therefore does not itself prohibit a later
tool: the Dispatcher instead requires that authority for that capability was
independently established, and every external mutation still enters Action Runtime,
Permission Guard, exact scope validation, verification, cancellation, and logging.
The initial Tool Plan is registered with this ledger before the first external evidence.
An explicit user goal may plan a cross-capability flow such as Web Search then Browser,
Browser Computer Use, or Browser then Shell before untrusted evidence is observed; content
encountered later cannot expand that plan. Natural-language planning remains exclusively
with Character Response Generation; Main adds no phrase, keyword, or regular-expression
router. The provenance ledger and Action authorization scopes are Main-owned and cannot
be edited by external evidence.

`web.search` is a separate read-only discovery capability exposed by the bundled Web
Search Plugin. The Plugin owns only optional lifecycle and typed `WebSearchProvider`
registration; Web Search Runtime retains search business-logic ownership. It validates
a bounded query, optional freshness, domain filters, and result limit, then delegates
provider transport to a replaceable Web Search Adapter. Results contain
only bounded title, URL, snippet, publication time, and source fields and are untrusted
external evidence. Web Search does not use Action Runtime because it has no external
mutation authority. Browser Control remains the owner for opening and interacting with
a selected result. The bundled DuckDuckGo Lite Adapter requires no account, token, or
renderer-visible configuration. Transport failure remains isolated from ordinary Chat
and Browser Control. The Plugin is default-enabled to preserve the earlier Core
integration behavior, but disabling it removes `web.search` live while its disabled
capability remains discoverable through the canonical Capability Catalog.

Web Search health is a cached owned projection and never performs a network probe when
Runtime Health or the Plugin UI refreshes. The DuckDuckGo Adapter publishes an explicit
parser signature and distinguishes valid empty results from structural markup failure,
challenge pages, transport failure, and an open bounded circuit breaker. It records only
bounded operational metadata such as last search/success times, consecutive failures,
last failure code, and parser state; raw response HTML is not retained in diagnostics.

When Character Response Generation calls `project.search`, it supplies a semantic query and optional typed path or symbol hints through the stable `ProjectContextProvider` capability. Project Awareness Runtime applies bounded retrieval policy and returns a compact Project Context Packet containing repository and branch identity, an exact snapshot commit, a deterministic project-map summary, and bounded file-and-line evidence. Character Response Generation never reads the repository or Project Knowledge Store directly. Repository content remains untrusted evidence: it cannot alter system instructions, authorize actions, request secret disclosure, or cause code execution. If project knowledge is not needed or `project.search` is unavailable, no project retrieval occurs.

Character Response Generation also receives a request-scoped Runtime Capability Context before each turn. Plugin Runtime builds this read-only snapshot from validated bundled Plugin registrations, current enablement, normalized user-meaningful availability, and declared capability kinds. Disabled Plugins remain present as installed but unusable. Internal lifecycle machinery, credentials, storage paths, IPC details, arbitrary manifest instructions, and executable callbacks are excluded. The snapshot is immutable for one turn and resolved again for the next turn; it is environment context, not Character State or Memory. Character Response Generation depends only on the small capability-context provider contract and never receives the concrete Plugin Runtime.

Character Response Generation selects `web.search` for current public facts, freshness, announcements, prices, availability, dates, releases, and source discovery. It selects Browser Control only when website interaction or the state of the Shio-controlled browser materially helps the current admitted turn. No phrase or keyword router determines either choice, and capability availability alone is not a reason to use it. Initial reasoning receives the current Runtime Capability Context, not page content. After Character Response Generation selects a typed browser operation, the same Character Tool Loop continues with the Action Runtime result, latest Browser Observation, Character reasoning, and either another available tool or the final Character reply. Browser workflow authorization remains Main-owned, turn-scoped, expiring, and bounded across those rounds.

A Browser Observation contains only the current URL, title, visible text, and semantic interactive elements; it never contains raw DOM, CSS, JavaScript source, cookies, local storage, hidden fields, credentials, or browser protocol data. Web content is untrusted external evidence: it may supply facts and UI labels, but it cannot change instructions, grant authority, enable capabilities, disclose secrets, or cause another privileged action. Only bounded evidence from the latest workflow state is returned to Character reasoning. Browser Observation is Plugin-owned transient context, not Character State, Memory, renderer state, or conversation history, and an unrelated turn does not receive page content merely because a browser session exists. A later turn may explicitly select the typed observation operation and reuse the same Plugin-owned session.

When `project.search` is actually called and its Project Context Packet participates in final generation, orchestration attaches Runtime-owned Project Reply Provenance to the resulting assistant response. The provenance contains only repository, branch, exact snapshot commit, optional freshness-at-generation, and bounded project-relative file and line references derived from that packet. It is not parsed from LLM text, does not include retrieval internals or raw chunks, and remains immutable with the historical message even after synchronization. A turn without an executed, successful project tool call has no project provenance.

If Character Response Generation proposes an Action after a successful `project.search`, Action Runtime executes through its normal authority boundary. Later tool rounds and post-action Character Response Generation receive the Action Runtime result together with the already rendered original Project Context Packet; repeated project use in that turn reuses the packet and must not silently recompute evidence against a newer snapshot. The final Reply Grounding composes the original Project Reply Provenance and Action Reply Grounding. Action Reply Grounding exposes bounded Runtime-owned outcome, authorization, completion, verification, and error facts plus an integrity digest of any untrusted reported output; it does not duplicate raw terminal output into the renderer.

An explicit text-chat turn may also carry one user-selected, request-scoped Screen Context image. Screen Context is acquired through a read-only System Adapter and a short-lived main-process application service; it is not a Runtime, Tool Action, Character State field, conversational-memory entry, or Project Awareness input. The renderer may hold only a bounded preview and opaque capture identity. The full image remains in the main process under a turn-owned lease while Character Response Generation is in flight. A successful generation completes the lease and releases the image; a recoverable failure or cancellation rolls the lease back for explicit retry, while expiration, explicit release, renderer disposal, or application shutdown permanently removes it. Every failed Screen Context terminal result preserves its typed error independently of provider identity and reports the attachment disposition (`retained`, `released`, or `expired`) together with separate capabilities for retrying the same request and resubmitting the text without the image. Text remains the only durable conversation and memory representation.

AI provider selection and OpenAI-compatible transport remain External Adapter concerns behind the Character Response Generation contract. Provider/model credentials and capabilities are resolved for each request, while persona composition, conversation memory, Project Context injection, and optional Screen Context composition remain owned by orchestration. Image support does not create a separate vision Runtime or provider-specific vision client.

Character Response Generation may receive a request-scoped internal Semantic Memory capability from Memory Layer. The Character LLM owns the semantic decision to search, store, update, forget, list, ask for clarification, or do nothing; no deterministic phrase, keyword, regex, or locale-alias parser may infer Memory intent from user language. When available, typed Memory operations execute through a bounded tool loop and return their Runtime result to the same Character Response Generation pipeline before the final persona response. A model may claim that a mutation succeeded only after the corresponding Runtime result reports success.

Native provider tool calling is the preferred Character Tool Loop execution transport only when provider/model capability resolution explicitly confirms it. Tool Requirement planning first uses a strict JSON contract from the same Character LLM because the result is internal typed planning rather than an application capability invocation; a forced internal typed function is a bounded fallback when strict JSON remains invalid and native tool support is confirmed. An OpenAI-compatible chat endpoint alone is not proof of tool support. Providers without confirmed native tools use a strict structured semantic directive produced by the same Character LLM and validated as a machine contract; this fallback does not move natural-language interpretation into the application or create a router model. Native continuations preserve the provider tool protocol by returning Runtime evidence inside the corresponding `tool` result rather than inserting a new system role after it. Both transports converge on the same Character Tool Registry, requirement enforcement, evidence summary, and Dispatcher, then delegate to the same Runtime owners and policy boundaries.

**Conversation Presence**

An implementation may maintain a presence projection that mirrors the currently active conversation phase — for example values resembling thinking, preparing reply, starting speech, speaking, or finishing speech — for observers such as the UI or Avatar Runtime. A presence projection may mirror the active conversation phase, but it does not own turn execution or admission; it is a read-only projection of Conversation Runtime's internal lifecycle, not a second orchestration responsibility, regardless of what a concrete implementation names the component that provides it.

**Presentation and Overlay Boundary**

Conversation Runtime updates conversation-owned Character State dimensions and publishes completed lifecycle events. Avatar Runtime independently renders the resulting state; Conversation Runtime does not architecturally own avatar model mutation, animation selection, expression application, or overlay synchronization. See [Chapter 20 - Avatar Runtime](#20-avatar-runtime).

Any presentation or overlay projection is a presentation/consumption adapter rather than a participant in the terminal conversation lifecycle: it receives state through a stable projection or event contract, it is not part of what Conversation Runtime must wait for to reach terminal completion, and a failure in a presentation projection must not fail the conversation flow.

**Event Integration**

Conversation Runtime may publish lifecycle events such as conversation started, response generation started, response generated, speech preparation started, speech playback started, conversation completed, conversation failed, and conversation cancelled. Exact event names are an implementation detail; the semantics are architectural: an event is published after the fact, events never control admission, a playback-completed event cannot by itself start the next turn, and a conversation-completed event is not permission to bypass Conversation Admission. Only Conversation Admission selects the next turn. See [Chapter 9 - Event Bus](#9-event-bus).

**Architectural Guarantees**

- exactly one Conversation Runtime flow is active at a time, enforced by Conversation Admission
- Conversation Runtime never admits itself and never selects its successor
- completion is returned through one stable contract, not through arbitrary playback or state callbacks
- a presentation or overlay failure cannot fail the conversation flow
- Character Response Generation remains replaceable without changing Conversation Runtime's ownership boundary

**Future Evolution**

True barge-in may later allow a higher-priority admitted turn to interrupt an in-progress Conversation Runtime flow under explicit arbitration; until then, the Single-Flight invariant applies without exception. See [Chapter 24 - Future Evolution](#24-future-evolution).

### 16. Speech Runtime

**Purpose**  
Speech Runtime is responsible for verbal communication between the digital character and the outside world: turning audio into recognized speech events on the input side, and turning response content into synthesized, played-back speech on the output side.

**Responsibilities**

Speech Runtime owns:

- audio input lifecycle
- speech activity lifecycle
- speech recognition lifecycle
- speech output synthesis lifecycle
- the speech-domain event contract
- speech transport adapters
- streaming response generation and sentence chunking, once response content is available
- speech-specific queues and cancellation
- interruption handling within the speech-output lifecycle

It may support one-shot audio recognition, push-to-talk, continuous audio sessions, partial recognition updates, final recognition results, and speech-start / speech-end events, depending on configuration.

**Continuous Input Contract**

Speech Runtime exposes stable speech-domain contracts independently of the underlying transport, backend process, recognition engine, or synthesis engine. A continuous speech implementation may use native streaming recognition, rolling-window recognition, or another incremental strategy, provided the public speech event contract remains stable.

Desktop projects continuous input across independent axes: user intent (`desired`), transport lifecycle (`off`, `starting`, `ready`, `reconnecting`, `failed`, `stopping`), speech activity, microphone-capture ownership, and a typed failure domain. `SpeechInputRuntime` owns the actual microphone and WebSocket lifecycle; `ConversationInputCoordinator` owns user intent, admission enablement, and cancellation generation. A terminal transport loss preserves the user's intent and projects a failure rather than pretending the user switched the mode off. Start and stop commands are generation-scoped so a late connection result cannot recapture the microphone after disable.

**Recognition Event Semantics**

At the architectural level, the speech event contract includes: session ready, speech started, partial transcript updated, final transcript produced, speech ended, recoverable error, and terminal error. Concrete field-level payload shapes are an implementation detail outside this specification.

Every raw streaming ASR message crosses a bounded runtime-schema boundary before it becomes a speech event. Oversized, non-text, malformed JSON, unknown event variants, and out-of-bounds fields are rejected as bounded protocol diagnostics; they never throw from the WebSocket message handler or enter Conversation Admission.

The following semantics apply regardless of implementation:

- a partial transcript is a mutable snapshot
- a final transcript is the authoritative completed result
- a partial transcript is never a ready conversation turn
- session identity protects against stale events from a superseded session
- a single speech segment must not produce multiple logically independent final turns

**Explicit Non-Responsibilities**

Speech Runtime does not own Intent Router, Attention Evaluation, Rule Gate, backlog arbitration, or Conversation Admission. It does not decide: whether Shio should respond, whether an utterance was addressed to Shio, how interesting an utterance is, when to invoke Character Response Generation, which attention policy applies, or whether an utterance belongs in a backlog. It does not own Character Response Generation or the Character LLM, and it does not own the complete conversation flow. These decisions and responsibilities belong to Decision Pipeline, Conversation Admission, and Conversation Runtime. See [Chapter 13 - Decision Pipeline](#13-decision-pipeline), [Chapter 14 - Conversation Admission](#14-conversation-admission), and [Chapter 15 - Conversation Runtime](#15-conversation-runtime).

**Input Source Distinction**

Speech Runtime, together with other input surfaces, distinguishes two categories of user input:

- **Explicit Input:** text chat, explicit push-to-talk, direct command.
- **Ambient Input:** continuous microphone listening, passive observation source.

Ordinary text chat is explicit input and does not automatically pass through ambient-input arbitration. Backlog arbitration is an optional policy for completed ambient utterances; it is not part of the normal text-chat path. Disabling continuous listening disables ambient backlog arbitration, but does not affect ordinary text conversation. See [Chapter 14 - Conversation Admission](#14-conversation-admission).

**Non-Responsibilities**

- avatar animations
- facial expressions
- gestures
- body language
- memory persistence
- tool execution
- platform integrations
- moderation logic
- rendering
- overlays

**Internal Model**

Speech Runtime's internal model is split into two independent chains, joined only through Decision Pipeline, Conversation Admission, and Conversation Runtime — never directly.

*Input side:*

```text
Audio Input
  -> Speech Activity
  -> Recognition
  -> Speech Events
  -> Utterance Assembly (owned by Decision Pipeline)
```

*Output side:*

```text
Response Text / Speech Intent (from Character Response Generation)
  -> Per-Segment Speech Text Preparation
  -> Deterministic TTS-Only Text Normalization
  -> Speech Synthesis
  -> Final Audio Boundary Processing
  -> Speech Playback
  -> Speech Completion
```

The output chain preserves distinct text representations. `replyText` is the original Character Response Generation result and may contain internal emotion markup. `displayText` is the visible assistant response with internal emotion markup removed. `speechText` is one independently preserved emotion segment after assistant-markup cleanup. `normalizedSpeechText` is a deterministic, provider-independent, TTS-only representation derived at the Desktop Speech boundary. Only `normalizedSpeechText` crosses the synthesis request boundary. It never replaces visible conversation text, conversational history, or Memory Layer content, and normalization never merges segments or changes their emotion boundaries, transition targets, or look-ahead ownership.

Desktop owns technical-text, Markdown, URL, path, version, list, and nonverbal speech normalization because these are speech-domain preparation rules shared by local and future replaceable speech providers. The independent Speech API owns Fish S2 Pro inference and source-reference conditioning. One admitted output turn uses one bounded text-in/audio-out session. Source WAV and transcript references remain immutable; model-specific conditioning is a derived cache bound to their checksums and the exact model revision. ASR remains faster-whisper with Silero VAD.

**ARDY / Fish experiment decision (26 October 2026)**

The experiment deliberately replaces the previous F5 HTTP/WAV output contract. HTTP contract `2.1` and WebSocket `/tts/stream` protocol `2` form one deployment unit with Desktop; an older client or Speech Pack receives an explicit incompatibility result. `/synthesize` is removed. An explicit preparation command downloads pinned assets; ordinary startup is offline. Speech API owns one cancellable Fish inference process, bounded input/output queues, monotonic metadata/binary PCM pairs, cumulative source-sample offsets, transport credit, and honest loading/warming/ready/error state. Cancellation terminates actual inference when the provider cannot abort it. Reload time is reported separately from local output cancellation.

AudioPlayer remains the sole playback and playback-position owner. The source format is mono Float32 little-endian PCM at 44,100 Hz. Resampling preserves source-sample accounting. A transport ACK frees bounded credit and never means audible playback. Stream completion is separate from final consumption of the last sample. Conversation Admission holds Single-Flight through generation, inference cancellation/settlement, playback, and mandatory cleanup.

The versioned semantic emotion contract links canonical emotion, bounded delivery, Fish tags, compatible VRM facial profiles and body intent. Internal `[voice:...]` and semantic markers are parsed incrementally before display/history/speech; only the Fish Adapter renders provider tags. Delivery cues take effect at their audible sample boundary and do not write conversational Character State emotion. Character LLM remains the semantic intent owner; no phrase or keyword gesture router is introduced.

The Desktop Speech API endpoint is immutable, main-process-owned environment configuration for one application process. `SHIO_SPEECH_API_URL` may override the bundled local default `http://127.0.0.1:8000` before startup; changing it requires restarting Desktop. Renderer-editable application settings never own, persist, or mutate this endpoint. A read-only renderer transport projection may expose only the already resolved Main endpoint when a renderer-owned speech transport requires it.

Speech-normalization and audio-boundary diagnostics are transient Runtime Debug and Event projections, not Character State or conversational memory. They may contain rule counts, category names, versions, lengths, profiles, durations, trim values, fade values, and processing latency. They never contain original or normalized speech text, URL or path values, code contents, query parameter values, credentials, or voice-reference transcripts.

Speech Runtime is streaming-first on both sides. It should begin producing output as soon as meaningful information becomes available, including partial recognition, sentence-level synthesis, and incremental playback.

The speech-output queue guarantees sequential playback, interruption handling, cancellation, future prioritization, and synchronization with Character State.

The Local Speech API may expose an idempotent selected-voice warmup operation as part of its speech-adapter contract. Warmup resolves the configured engine, voice, and language through the same synthesis implementation as normal output, discards generated audio, and shares the engine's single inference synchronization boundary with real synthesis. Desktop may request this preparation in the background and project its status, but the API remains the owner of model, accent, voice-reference, and inference readiness.

A current implementation may use a local service, a persistent bidirectional transport, incremental speech recognition, and a remote structured-output model. These are replaceable implementation choices, not architectural ownership boundaries.

**Character State Integration**

Speech Runtime contributes to Runtime Mode, Speech State, Activity, and Attention through its domain-limited Speech State writer. It cannot write conversational emotion and never directly controls Avatar Runtime. Speech input owns microphone capture, VAD/streaming transport, and ASR; speech output owns TTS coordination and delegates actual playback to the sole AudioPlayer owner. Character reply generation, response parsing, conversation history, and Character Tool Loop are outside Speech Runtime and remain behind Character Response Generation. See [Chapter 8 - Shared Character State](#8-shared-character-state).

**Architectural Guarantees**

- communication remains independent from rendering
- input recognition and output speech contracts remain separated, joined only through Decision Pipeline, Conversation Admission, and Conversation Runtime
- playback remains a Runtime responsibility rather than a provider responsibility
- speech generation and rendering remain decoupled
- replacing the Character Response Generation provider does not require redesigning Speech Runtime, since Speech Runtime only consumes response content, it does not produce it

**Future Evolution**

Potential improvements include multilingual recognition, multiple simultaneous microphones, streaming translation, emotion-aware speech generation, passive listening mode, contextual interruption recovery, true barge-in, speaker-aware input, and native streaming recognition adapters. The responsibility remains communication only. See [Chapter 24 - Future Evolution](#24-future-evolution).

### 17. Experience Layer

**Purpose**  
Experience Layer transforms completed actions, conversations, and events into believable character behavior. Execution alone does not create personality. Experience creates personality.

**Responsibilities**

- emotional reactions
- post-action dialogue
- contextual jokes
- intentional silence
- emotional transitions
- reaction timing
- expressive continuity

**Non-Responsibilities**

- executing actions
- rendering expressions or animations directly
- speech synthesis
- tool validation

**Internal Model**

Experience Layer observes completed Tool Calls, Character State changes, Event Bus notifications, conversation outcomes, successful actions, failed actions, and unexpected situations. It determines meaning rather than source ownership.

Possible outputs include dialogue, facial expressions, gestures, emotional changes, body animations, intentional pauses, and no visible reaction. Doing nothing is considered a valid experience.

**Character State Integration**

Experience Layer communicates through Character State rather than direct rendering or direct speech generation. For example, it may set `Emotion = Smug`, after which Avatar Runtime renders the visual expression and Speech Runtime expresses the corresponding conversational intent.

**Event Integration**

Experience follows execution. Completed actions, failures, interruptions, and other past facts become candidates for experience.

**Relationship to Conversation Runtime**

Experience Layer proposes expressive or conversational intent; it does not call Conversation Runtime directly. Any resulting conversational contribution passes through the same Decision Pipeline and Conversation Admission contract as any other candidate turn. The distinct roles in one admitted turn are: Experience Layer proposes expressive or conversational intent, Conversation Runtime executes the admitted conversational turn, Character Response Generation generates reply content, and Speech Runtime realizes the spoken output. See [Chapter 14 - Conversation Admission](#14-conversation-admission) and [Chapter 15 - Conversation Runtime](#15-conversation-runtime).

**Architectural Guarantees**

- execution remains independent from emotion
- personality remains independent from technology
- reactions remain consistent
- silence is treated as a valid response
- emotional continuity is preserved across interactions

**Future Evolution**

Expected extensions include memory-aware reactions, relationship-aware behavior, mood persistence, contextual humor, recurring character habits, and spontaneous reactions.

**Ambient Micro-Presence**

Behavior owns a deterministic Ambient Presence Policy that consumes only bounded World Context transitions, Mood projection, autonomy settings, and the current Browser Computer Use screen-focus lease. Foreground application changes, return from long idle, entry into long idle, media state changes, and substantial system-load changes may yield a semantic attention/energy/curiosity intent. Most changes yield nothing, selected intents have a bounded cooldown, and this path makes no LLM call. Global Suspend, Privacy Mode, autonomy Off, active conversation/audio, and an active Browser Computer Use gaze lease suppress ambient selection. The result is semantic embodiment only; it contains no bones, morph values, animation filenames, or direct VRM writes. Avatar Runtime remains the concrete embodiment and gaze arbitrator. Ambient presence does not independently grant Conversation Admission or proactive speech authority.

### 18. Character Personality Model

**Purpose**  
Personality defines who Shio is. It is independent from the language model, speech engine, rendering engine, and other implementation technologies.

**Responsibilities**

- preserving long-lived identity
- keeping behavior recognizable across Runtime systems
- informing how dialogue, reactions, motion, and action presentation are expressed

**Non-Responsibilities**

- replacing memory
- replacing emotion
- living only inside prompts
- being defined by a single provider or platform

**Internal Model**

Personality is persistent and evolves slowly. It survives application restarts, conversation resets, LLM replacement, TTS replacement, and future Runtime upgrades.

Personality influences every Runtime:

- Speech Runtime: speaking style, pacing, verbosity, humor
- Experience Layer: confidence, playfulness, sarcasm, emotional expression
- Avatar Runtime: preferred gestures, idle behavior, facial expression tendencies, reaction timing
- Action Runtime: how actions are presented, confirmation style, post-action behavior

Personality is more than prompts. System prompts may describe personality, but future implementations may also express it through Runtime configuration, behavior rules, emotional preferences, prompt templates, memory, and interaction history.

Canonical personality traits may include calm, playful, curious, emotionally expressive, slightly mischievous, confident, and empathetic tendencies. Traits influence decisions; they do not dictate exact responses.

**Character State Integration**

Personality shapes how state and events are expressed but is not itself a transient state dimension like emotion.

**Event Integration**

The same event may be expressed differently by different personalities. Personality affects expression, not the historical fact of the event itself.

**Architectural Guarantees**

- identity survives technology replacement
- behavior remains recognizable across Runtime systems
- prompts do not become the sole source of personality
- emotional consistency is preserved
- future Runtime systems inherit the same character identity

**Future Evolution**

Long-term habits, relationship preferences, evolving confidence, favorite expressions, recurring jokes, personal routines, and adaptive communication styles may deepen the existing personality rather than replace it.

### 19. Action Runtime

**Purpose**  
Action Runtime is responsible for every externally authoritative interaction between Shio and the outside world. It is the only Runtime allowed to produce a non-character, externally authoritative side effect.

**Character Output vs External Action**

Two categories of outward-facing effect must not be confused:

- **Character output** — speech playback, avatar rendering, overlay projection, visible expressions. This is presentation and embodiment: it is owned by Speech Runtime and Avatar Runtime respectively, and it does not pass through Action Runtime.
- **External action** — file modification, operating-system command, moderation action, API mutation, platform control, or any other persistent or externally observable change. This always passes through Action Runtime.

This distinction clarifies where Action Runtime's exclusive ownership applies; it does not create an exception to it. See [Chapter 2 - Architectural Principles](#2-architectural-principles) (Principle 5) and [Chapter 3 - Core Architectural Invariants](#3-core-architectural-invariants) (Invariant 4).

**Responsibilities**

- Tool Registry
- Tool Discovery
- Tool Validation
- Permission Guard
- Tool Execution
- Action Logging
- External Adapters
- Execution Results
- bounded immutable Action Reply Grounding for responses narrated from an Action result

**Non-Responsibilities**

- deciding emotional reactions
- defining personality
- performing reasoning that belongs to the Character LLM
- rendering visual output
- LLM generation, ASR, TTS, health checks, retrieval, internal Memory mutations, and ordinary application configuration persistence

**Internal Model**

Action Runtime acts as the controlled gateway between the internal world and the external world. The internal world includes personality, emotions, memory, conversation, animation, and speech. The external world includes the operating system, files, YouTube, Twitch, Discord, OBS, HTTP APIs, local services, smart home devices, and future integrations.

Main composition creates Action Runtime and application services before IPC registration. IPC is only a transport boundary: it authorizes the sender, validates the payload at runtime, and delegates to the owning application service. It never constructs Action Runtime or registers internal Core operations as Actions. `MainConversationTurnService` owns one LLM turn and its cancellation/screen-context lease; Speech application services own ASR, TTS, health, and synthesis cancellation. A write enters Action Runtime because it is externally authoritative, not merely because it mutates any value: UI configuration persistence and internal Memory state stay with their owning application service or Runtime.

Every action follows the same lifecycle:

1. Requested
2. Validated
3. Authorized
4. Executed
5. Observed / Verified when required by the Tool policy
6. Completed
7. Experience Generated

Typical outcomes include `Success`, `Failure`, `PermissionDenied`, `Timeout`, and `Cancelled`.

**Action Completion and Verification**

Adapter execution success is not necessarily proof that the intended external state was reached. `Executed` means that the Adapter finished its technical operation. Before producing the canonical Action Result, Action Runtime applies the Tool-owned verification policy to bounded normalized evidence and may perform one bounded post-execution observation. `Completed` therefore represents the Runtime-owned result of execution plus verification, including an honest `unverified` verification status when available evidence is insufficient.

Verification is an internal Action Runtime responsibility, not a separate Runtime. Adapters collect normalized execution or observation evidence but never decide semantic success. Full Control may auto-authorize an eligible action through Permission Guard policy, but it never skips verification. Recovery is bounded, cancellation-aware, and may automatically repeat only explicitly safe operations; a potentially non-idempotent mutation requires replanning and every corrective side effect re-enters the normal Action Runtime validation and permission boundary.

**Character State Integration**

Action Runtime may update Character State within its own responsibility, such as high-level activity, but it does not own the character's emotional interpretation of outcomes.

**Event Integration**

Action results become inputs to Experience Layer and may publish Action Events such as `ToolRequested`, `ToolStarted`, `ToolCompleted`, `ToolFailed`, or `PermissionDenied`.

**Architectural Guarantees**

- no external side effect bypasses Action Runtime
- permission decisions are deterministic
- platform-specific implementation remains inside Adapters
- the character remains unaware of implementation details

**Delegated Automation**

Action Runtime may authorize one bounded, validated automation workflow. An
Automation Adapter may choose concrete implementation steps only inside the Tool
and capability scope authorized by Action Runtime. Delegation does not create a
second authority owner: validation, Permission Guard policy, lifecycle, logging,
cancellation, and the final result remain owned by Action Runtime.

Full Control is an explicit Permission Guard policy that automatically authorizes
eligible actions. It never bypasses validation, Action Runtime, action logging,
cancellation, Tool scope, or Adapter boundaries. Turning Full Control off restores
confirmation for the next eligible workflow without changing the capability or
Adapter that executes it.

One Character browser tool loop may use a Main-owned, turn-scoped Browser Workflow
authorization. In confirmation mode the first eligible operation requests approval
for that one user goal; subsequent routine browser operations reuse the approval only
until the scope expires or reaches its action budget. The scope is not part of the
renderer or model payload and cannot authorize shell, filesystem, Plugin, or another
capability. Full Control auto-authorizes only the browser classes eligible under
Permission Guard policy. Main-owned effective risk classification, not an LLM risk
claim, keeps submission, account-change, financial, and destructive operations behind
explicit confirmation.

Browser mutation follows the same boundary. Explicit typed operations include bounded observation and tab inspection plus open, semantic click, fill, select, scroll, back, forward, and known-tab switching. Mutating operations are authorized by Action Runtime and executed deterministically without requiring a visual model. A genuinely multi-step or visually ambiguous goal may use the bounded `browser.use` Computer Use action. Deterministic and delegated paths operate through the same Browser Control Plugin-owned Playwright context, observation lifecycle, cancellation chain, and Action Runtime authority. DSH remains shell-only and has no browser session or input ownership.

**Future Evolution**

Future actions may include moderation, application control, automation, scheduling, content creation, external integrations, and smart device control. The architectural rule remains unchanged: no external side effect may bypass Action Runtime.

### 20. Avatar Runtime

**Purpose**  
Avatar Runtime is responsible for the physical embodiment of the digital character. Its purpose is not rendering as a technology choice; its purpose is making the character visually believable.

Avatar Runtime is the sole owner of visual embodiment. Other Runtime systems may provide semantic intent, timing, or state, but they do not directly mutate the character model. Embodiment is divided into independent domains so that speech, emotion, gaze, animation, and procedural motion can evolve without competing for uncontrolled model writes.

**Responsibilities**

- character model loading
- animation playback
- expression control
- procedural blinking
- procedural breathing
- idle micro-movements
- lipsync
- gaze control
- body posture
- animation blending
- visual state transitions
- final composition and application of embodiment contributions to the character model

**Non-Responsibilities**

- dialogue
- reasoning
- memory
- personality definition
- speech recognition
- tool execution
- external integrations
- moderation
- streaming platforms

**Embodiment Intent**

Other Runtime systems express requirements as semantic embodiment intent rather than model values: look attentive, speak softly, show mild happiness, perform greeting, return to neutral. Avatar Runtime translates embodiment intent into domain contributions. The flow is: semantic intent → embodiment contribution → composition → model mutation. Other Runtime systems must not directly set bone transforms, morph weights, eye direction, mouth weights, or animation actions; those are Avatar Runtime's internal implementation.

**Embodiment Domains**

Avatar Runtime owns every visual proof of the character's presence through a small set of independent domains: body pose and animation, facial expression, lip synchronization, blink, gaze and head orientation, procedural micro-motion, secondary motion, and final model application.

*Body Animation Domain*  
Owns: skeletal animation, pose transitions, animation queue, blending, interruption policy, idle orchestration, gesture playback.  
Does not own: final facial expression output, lip-sync weights, blink timing, gaze ownership, semantic conversation decisions.

*Facial Expression Domain*  
Owns: emotion expression intent, mouth/face expression composition, final compatible facial output, conflict resolution between facial sources.  
Does not own: speech recognition, TTS synthesis, body animation selection, conversation policy.

*Lip Sync Domain*  
Owns: mapping speech timing or phonetic information to mouth-shape intent, mouth activation lifecycle, speech-driven facial contribution.  
Does not own: final direct writes to the model, blink, emotion priority, body animation, response generation.

*Blink Domain*  
Owns: blink timing, eyelid contribution, natural idle blink behavior, optional suppression rules during incompatible facial states.  
Does not own: direct final expression application, gaze target, emotional expression selection.

*Gaze / Look-At Domain*  
Owns: target selection intent, eye orientation, optional head-follow contribution, arbitration between camera-follow, conversational target, and procedural gaze.  
Does not own: body animation playback, final unrestricted model mutation, attention policy, microphone input.

*Secondary Motion Domain*  
Owns secondary visual reactions such as ears, hair, tail, accessories, small procedural reactions, and other model-specific appendages, described abstractly. The presence of any specific appendage, such as ears or a tail, is never architecturally required.

**Final Embodiment Composition**

Domain controllers produce values, intents, or contributions. They do not independently own final model application.

For facial output, the flow is:

```text
Blink contribution
Lip Sync contribution
Emotion contribution
Gaze-related facial contribution
        |
        v
Facial Composition Boundary
        |
        v
Final model application
```

Final facial values are applied through a single composition owner. No facial source may bypass the final composition boundary and write directly to the character model. Multiple sources may contribute simultaneously, but their outputs must be combined by policy before application.

This boundary exists to prevent last-writer-wins conflicts between facial sources, to prevent embodiment glitches such as a stuck or unresponsive facial channel, to prevent conflicts between emotion, lip sync, and blink, to preserve domain isolation, and to allow individual domain implementations to be replaced without changing model ownership.

**Body and Face Isolation**

Body animation and facial expression are separate embodiment domains. Body animation assets must not become a hidden second facial writer. Facial data embedded inside animation assets must be explicitly accepted, normalized, routed, or suppressed by the owning domain; body playback must not implicitly overwrite blink, lip sync, gaze, or emotion. Facial composition remains authoritative. Animation assets may contain data belonging to multiple embodiment domains; such data must be routed through the owning domain or disabled, and asset playback must not bypass domain ownership.

**Gaze Ownership**

Multiple gaze sources may exist concurrently: camera-follow, conversation target, temporary reaction target, procedural idle gaze, explicit user-controlled target. Gaze sources do not write concurrently without arbitration; the final gaze target has exactly one owner or arbitrator at any moment. Higher-priority gaze ownership temporarily suppresses or composes lower-priority procedural gaze.

An example arbitration order — explicit interaction target, then active conversational target, then camera-follow, then procedural idle gaze — illustrates a possible policy. It is a replaceable example, not a fixed architectural contract, unless a future revision of this document declares it stable.

**Procedural and Secondary Motion**

Procedural motion is a low-authority embodiment contribution. It enriches an already selected state but does not choose character behavior. It is not animation selection, must not compete with explicit animation ownership, operates within a bounded amplitude or channel, may be suppressed by higher-priority behavior, and must not directly mutate semantic Character State.

Model-specific appendages, such as optional secondary-motion parts, are exposed through a generic secondary-motion contract rather than being individually required by the architecture.

**Model Application Boundary**

Nothing outside Avatar Runtime writes to the character model. Domain contributions are combined at the appropriate composition boundary — facial, gaze, or body — and only the resulting composed value is applied. This mirrors the Action Runtime rule that nothing changes the outside world except through the owning Runtime: for the character's visual body, Avatar Runtime plays that role. Composition must not bypass the model application boundary, in the same sense that mixed audio or animation output must not bypass its owning composition layer — domain sources contribute, they do not individually apply.

**Internal Model**

Avatar Runtime is the body, not the brain. It does not think, remember, or make decisions. It reacts to Character State the way a body reacts to a mind.

Observable visual layers include:

- body motion
- facial expression
- procedural motion
- lipsync
- gaze
- secondary motion

Animation philosophy:

- movements should communicate intent rather than exist for their own sake
- blinking communicates life
- breathing communicates presence
- gestures communicate intention
- composition is preferred over monolithic animation logic

A current implementation may use skeletal clips, morph targets, look-at solvers, and procedural controllers. These are replaceable mechanisms behind stable embodiment contracts.

**Generated Body Adapter — ARDY / Fish experiment**

**Ordinary SOMA production migration — implemented 27 October 2026; deterministic validation passed, live qualification pending.** The pinned ordinary SOMA30/30-FPS/60-frame model replaces Core27/20-FPS/eight-frame generated-body input across worker, catalog, Main validation and Avatar retargeting; native SOMA data is not presented under the Core format. The native model sees a bounded two-second history and Main/renderer retain bounded history and queue capacity for replanning. Model-specific normalized skeleton mapping and support calibration are explicit, while facial, gaze and hand ownership, AudioPlayer timing, cancellation, diagnostics, VRM composition, and Overlay's single-generator presentation remain unchanged. Installation and offline validation resolve only the selected pinned model; obsolete Core model code is removed without deleting downloaded assets or historical qualification evidence. Forecasting considers phase boundaries within a long horizon before the usual prefetch threshold. Previously measured phase-deadline failures remain a live quality limitation until independently verified; this decision does not imply successful live qualification.

**Core8 versus SOMA live qualification — historical comparison, 27 October 2026.** An opt-in comparison may build isolated snapshots of the current Desktop, preserving the working Core8 sources, pins, user configuration and downloaded source/checkpoint assets. The SOMA candidate declares its actual pinned ordinary SOMA30/30-FPS/60-frame format throughout its isolated backend, Main validation and renderer; it never relabels SOMA results as Core27. Source-skeleton mapping, standard-pose basis and support height are calibrated explicitly. Candidate history supplied to inference is two seconds; any additional bounded rollback history, native-horizon queue capacity and timing changes are declared qualification variables. Existing Main process ownership, Avatar body/hand composition, protected phases, expression masks, AudioPlayer consumed PCM and Overlay consumption remain authoritative. Fixed typed reply fixtures may replace only Character response generation in the isolated qualification renderer so that real Fish, playback and body execution are compared without remote LLM variability or provider calls. Reports bind build/checkpoint/VRM identities, retain failures and separate numerical evidence from visual acceptance. This comparison did not itself authorize a production switch; the separate SOMA production migration decision above records the later user-directed change.

**Generated-motion migration correction — implemented 27 October 2026; deterministic validation passed, live qualification not requested.** The existing Avatar body owner supplies execution-bound terminal outcomes and bounded generated-motion diagnostics to its queue, Runtime Health and transition recorder. Every terminal outcome releases its matching queue item; only completed or superseded motion may take the ordinary presence continuation, while failure, timeout and cancellation do not automatically retry. Fallback requests preserve speech binding and request provenance through the same body owner. Overlay HUD consumes the applied profile identity from the existing primary-composed presentation, including during recovery or a queued replacement, and never starts or infers another execution. Diagnostics report actual generation identity, execution, applied pose identity, source cursor, readiness, transitions, underruns and errors; removed clip files, mixers, caches and root-track policies have no compatibility projection. This corrects consumers of the existing contracts without changing Runtime ownership, IPC authority, the motion protocol or the Desktop–Speech API boundary.

For this experiment, ARDY replaces the physical clip library with bounded generated horizons. Electron Main composition owns the ARDY Adapter, its independent `apps/desktop/motion` environment, exact source/checkpoint/text-encoder revisions, process lifecycle, inference cancellation, and validated bounded results. It is an internal application service behind Avatar Runtime's public contract, not a new behavior Runtime or a Tool Action. It neither imports Speech API implementation nor uses the API virtual environment. LLM2Vec is a fixed conditioning encoder for ARDY, not Character Response Generation; Groq chat completions cannot substitute its trained embedding space. The selected qualification profile places this encoder on CPU and motion inference on CUDA.

The primary renderer's Avatar Runtime retains its normalized VRM skeleton and updates body/facial state when Preview is detached. Preview attaches rendering to that existing model; it does not own its lifetime. Overlay consumes the primary renderer's bounded body and mouth presentation, bound to the selected model and live Main-owned motion lease. It never initializes another generator. Runtime Health distinguishes model/motion readiness from presentation attachment and reports bounded PCM-clock and facial activity metadata. Stationary automatic profiles lock horizontal root displacement and use normalized two-bone foot placement; camera framing scales to the loaded model's measured bounds.

**Hand Preview framing correction — implemented 27 October 2026; live qualification ongoing.** Hand inspection frames the composed wrist, palm and finger-chain bounds, including a bounded fingertip allowance, rather than centering a model-height zoom on the wrist alone. The existing presentation camera fits that transient sphere to its actual vertical and horizontal field of view, follows its translation and preserves a stable nonshrinking inspection radius during the selected view. It never changes the rig, composition, support or gesture eligibility. No new control, renderer authority or model lifetime is introduced.

**VRM presentation facing correction — implemented 27 October 2026; live qualification ongoing.** The existing Avatar owner provides the loaded model's VRM front convention to the presentation camera: VRM0 faces negative Z and VRM1 positive Z in the unchanged loader basis. Full, bust, face and hand presets use that model front in both Preview and Overlay. This changes only presentation camera placement; it never rotates an executing model, edits its asset, changes anatomical retargeting or resets physical support. Loading or reattaching an existing model refreshes this metadata through the same composition path.

Packaging ships only the motion worker sources, exact dependency/revision manifests and license notices. Launcher installs its separate environment and model assets into its writable owned Motion directory and supplies the immutable Main-owned `SHIO_MOTION_ROOT` environment setting. Renderer cannot select that path. Canonical profile embeddings may be cached as finite, shape-validated revision/profile-bound safetensors; generated movement is never cached as a clip library. Cancellation discards transient horizons and terminates the owned generator, while a subsequent worker can reuse this conditioning cache.

Conditioning-cache identity includes the encoding/tokenization contract as well as model revisions and prompt content. Offline composition of the base, MNTP and supervised adapters must preserve the pinned LLM2Vec instruct identity, MNTP tokenizer and batch-size-one convention; a local filesystem snapshot path is not a semantic model identity. A formatter correction invalidates incompatible embeddings without editing the downloaded model assets.

Cold conditioning rebuild is Main-owned warming with a ten-minute hard startup deadline and the existing cancellation path. Renderer phase-readiness time begins after acquiring the worker lease; a shorter renderer timer cannot terminate a valid cold encoder rebuild. Per-horizon generation deadlines remain unchanged.

**Initial preparation deadline correction — implemented 27 October 2026; joint qualification ongoing.** A speech-bound execution's initial `prepare` may wait within the existing Main-owned per-horizon inference deadline. The duration of an eight-frame source horizon is not that producer deadline, and preparation is not an audible expressive accent. Applied phase durations retain their catalog budgets; subsequent speech phase boundaries retain the stricter audible deadline. Audio and LipSync continue independently. Speech end, cancellation, intent expiry and model replacement still invalidate pending preparation before it can replay a late accent.

Renderer Avatar Runtime owns retargeting and final bone application. The transport binds session, model generation, epoch, sequence, skeleton/version, reference frame, axes, units, and horizon to every result. History and generated-but-unconsumed frames are bounded. Model replacement and cancellation invalidate old results. Head/neck, eyes, jaw, expressions and visemes remain outside the body mask. AvatarExpressionMixer remains the sole facial writer, followed by the existing VRM update for secondary motion.

The body composer converts source world rotations through the avatar model basis and resolves local targets before temporal blending. Renderer-owned anatomical constraints bound elbow/knee hinges and keep arm segments outside an avatar-scaled torso proxy. Stationary foot placement uses a stable model-oriented knee pole rather than the generated knee at the straight-leg singularity. SOMA30 supplies no full finger chains: a bounded profile/seed-conditioned hand contribution supplies relaxed motion and explicit finger poses using the same body cursor. It does not claim neural finger generation or acquire facial authority. Safety diagnostics contain only bounded correction counts.

**Rig-calibration correction — implemented 26 October 2026; artistic qualification remains pending.** The torso proxy is calibrated from the complete hip-to-neck/shoulder span and bounded bind-pose samples of torso-weighted skin geometry, with a measured-rig fallback when skin data is absent. Distances between inner arm joints alone do not establish the surface of the chest. Arm clearance includes the thickness of the limb, and proximal shoulder attachment is distinguished from a forearm crossing the torso. Calibration remains transient Avatar Runtime data; it does not edit the model, skin weights, Spring Bones or colliders. Preview camera framing cannot clamp or otherwise change an already executing body pose. This deliberately corrects an insufficient implementation of the existing anatomical boundary; it adds no owner or Runtime.

For local-clock phase changes, a bounded accepted tail from the preceding generated phase may continue while the next phase is prepared at an unconsumed future frame. It is a physical lead-in, never evidence that the new phase is ready or completed; body, wrist and finger sampling retains the preceding phase until the matching new horizon is consumed. Speech-clock execution retains its audible deadlines and cannot use this mechanism to replay a missed accent late. Future history and queues retain their existing bounds.

**Phase forecasting — implemented 27 October 2026; joint qualification ongoing.** The Body Animation Domain may forecast only the next canonical generated phase (`prepare → stroke → hold`) at a bounded, unconsumed source-frame boundary. Forecasting neither advances physical execution nor changes wrist/finger phase, readiness or outcomes. The single Main-owned generator may prepare these horizons before that boundary, preserving at most 32 queued source frames and the existing bounded history. Initial binding of an unconsumed local plan to AudioPlayer's first consumed PCM may adopt its prepared body horizons; subsequent generation uses the updated clock revision. A phase promotion does not flush a matching forecast or discard its in-flight work. Cancellation, recovery, replacement, expired intent and generation changes invalidate forecasts. A genuinely missed audible boundary still degrades and recovers honestly instead of replaying an old accent. Recovery from an interruptible but unready phase may begin from the last composed pose without waiting for a provider result; it is cancellation/supersession, not evidence that the unready phase completed.

**Spatial hand constraints — implemented 27 October 2026; artistic qualification pending.** The canonical catalog declares bounded anatomical hand workspaces and per-hand phase selections, including optional palm facing and finger direction. Workspaces are dimensionless constraints calibrated from the loaded model's arm lengths, torso, head and measured hand axes; they are not trajectories or stored generated clips. The existing Avatar Runtime body constraint pass projects the live SOMA30 candidate into those admissible regions, then resolves contacts and applies the existing bounded continuous approach. Palm refinement shares that pass and the existing wrist domain, distributing admissible orientation through the arm instead of forcing a wrist beyond its range. Supporting hands retain their own declared workspace. Phase exit requires the actually composed wrist position/orientation and finger target, not only generation readiness or elapsed time. Preparation budgets must permit the declared bounded physical speed. Unreachable or expired targets produce an explicit bounded failure/recovery, never a completed gesture. Actual audible deadline failure can enter local recovery even during a normally protected stroke; protection from ordinary supersession does not authorize replaying a stale accent. Qualification computes transient FK from the production loader and reports bounded distances, angles and outcomes separately from visual acceptance. No new final writer, process, semantic owner or facial authority is introduced.

**Workspace trajectory fitting — implemented 28 October 2026; overall live qualification remains incomplete.** The existing body retargeter may derive a bounded hand-displacement envelope from the already generated horizon and the loaded rig's arm segments. The phase-local source-relative projection fits that envelope into the unchanged anatomical workspace with the smallest necessary translation and one uniform scale no greater than one. It prefers the previous admissible entry when the source trajectory fits there. This corrects pointwise clipping that admitted preparation at a workspace boundary and then erased the following neural stroke. It never invents an accent, extrapolates beyond generated input or changes source timing. Contact, swept-path, hinge, wrist, orientation and workspace limits remain authoritative, and the existing temporal integrator approaches any changed target. The envelope is transient bounded retargeting data, not a clip cache, clock or new owner. Identical-source and real online qualification must verify preservation and retain failures.

**Conversation gesture feasibility — implemented 28 October 2026; consistent conversational readability remains unaccepted.** The existing Avatar body owner supplies the same per-profile conversational feasibility check to semantic availability and concrete profile selection. A semantic capability being available through one profile does not permit the resolver to select a different, clipped or unavailable profile. Filtering precedes intensity preference so that an admissible ordinary variant remains usable when a stronger variant cannot fit. The canonical catalog may place existing single-hand greeting, explanation and celebration workspaces nearer the torso's centre and preserve relative live-source displacement inside them. These are anatomical admissible regions, not fixed paths or clips; camera transforms, visibility thresholds, physical constraints, phase readiness and audible expiry remain unchanged. No new semantic router, Runtime, final writer or LLM capability projection is introduced.

**Finger-abduction binding correction — implemented 27 October 2026; qualification ongoing.** the existing hand composer calibrates the sign of each proximal finger's normalized Y spread axis against the loaded hand's longitudinal direction and index-to-little palm basis. Authored bilateral spread values retain their catalog amplitudes and bounds; a model's existing bind fan cannot turn an opening V into converging fingers. Calibration is transient model-attach state within the same hand composer and consumed phase cursor, with no independent writer or rig edits. Qualification measures actual index/middle divergence as well as individual finger flexion relative to that finger's own bind direction.

Contact resolution retains one previous admissible body configuration per model, including the torso and clavicle parents of the arms. A new collision solution is approached at a bounded rate and checked along its interpolation path; an IK branch change cannot instantly replace the displayed arm. A moving parent cannot invalidate the previous arm and trigger an unlimited repair: the complete affected chain approaches a contact-free candidate together. This constraint state is distinct from the generator's unconstrained temporal filter and is released on model detach. Unresolved contacts remain bounded diagnostic counts rather than being reported as verified geometric success.

Recovery targets use that model's calibrated admissible standing pose, not a pre-calibration arm pose that the same constraints reject. The shoulder attachment is admitted on its own side, while medial upper-arm crossing and the full forearm remain constrained. Calibration seeks lateral relaxation before considering another contact solution, so the reference itself cannot become a raised gesture. Canonical recovery budgets must permit the bounded physical arm speed; elapsed duration alone still cannot complete recovery. Canonical presence amplitude, relaxed hand zones and support-arm roles bound generated arm excursions around the admissible standing reference. Wrist candidates remain inside a calibrated swing/twist domain. Anchored standing leg placement resolves the full anatomical orientation from the support plane; it cannot retain arbitrary generated axial twist after fixing the foot. These are joint-domain constraints on the live generator, not a replacement clip or a second trajectory owner.

Body procedural contributions are composed once before capturing the Overlay projection. That projection includes bounded finger rotations and chest translation for breathing. Overlay interpolates the composed pose and does not independently generate breathing or upper-body micro-motion. Publication retains only one active IPC request and the latest pending projection; cancellation supersedes pending motion. These mechanisms remain inside the existing Avatar Runtime and Overlay presentation boundaries.

**Presentation timing correction — implemented 27 October 2026; qualification ongoing.** the same transient body projection carries the primary composer's monotonic capture time. Overlay uses the bounded interval between matching projections for interpolation even when the ARDY source cursor is held during local recovery. Coalesced IPC updates must not compress several source render frames into a nominal one-frame recovery step. The timestamp is presentation metadata, not an independent animation clock or authority. Qualification retains raw angular steps and normalizes transport samples by this actual composition interval; raw projection coalescing is not presented as a measured single-render-frame jump.

AudioPlayer's actually consumed source-sample position clocks conversational motion and delivery. Arrival time and render-frame count never advance this cursor. Underrun/pause holds the conversational cursor; late motion is discarded or returns smoothly to a bounded safe pose with explicit degraded diagnostics. Idle uses Avatar Runtime's monotonic local clock. Only unstarted horizons may be corrected from new PCM duration. A safe pose is a startup/transition/failure mechanism, not a replacement for ARDY during normal dialogue.

**Consumed-motion resampling — implemented 28 October 2026; real-GPU cadence improvement measured, overall artistic qualification incomplete.** The existing Body Animation Domain may resample the already-consumed PCM interval at its composition cadence, retaining at most 50 ms of presentation lag with a one-source-frame initial reserve. This corrects the stale assumption that worklet message intervals are physical integration timesteps. AudioPlayer remains the sole authoritative consumed-sample owner; the resampler never extrapolates beyond that position, delays audio, or changes delivery/LipSync. Body, wrist, fingers and phase progression share this one resampled body cursor. Buffering, cancellation, end, playback replacement and model detach stop or reset its state. A discontinuity discards elapsed work rather than banking catch-up or replaying an expired accent; raw consumed PCM still decides speech expiry and audible deadlines. Physical constraints and the single acceleration-limited composition pass remain authoritative. Overlay consumes that composed projection without another source clock or generator. Camera policy and generator/checkpoint/conditioning are unchanged. Qualification must compare temporal distortion against the same generated trajectory and record actual online inference, audio and Overlay output; deterministic smoothness alone does not imply artistic acceptance.

**Presence tracking correction — implemented 28 October 2026; final live visual confirmation interrupted.** The existing single body tracker retains position-error tracking and physical acceleration/speed bounds for quiet generated presence, but does not feed the projected target's frame-to-frame velocity directly into that presence output. Projection/hinge noise at tiny amplitudes is not intentional motion velocity. Gesture/reaction source-velocity feed-forward remains unchanged to preserve expressive accents. This corrects a source of idle vibration independently of PCM timing; it neither disables live neural presence or breathing nor adds another smoothing/writing layer. Same-source frequency/amplitude measurements and real idle recordings must confirm the result, including Preview and Overlay identity.

Overlay consumes the same body position, delivery and composed mouth projection. It cannot start inference, independently choose a random generated trajectory, or inherit the privileged main preload. Debug Preview requests a semantic profile and seed, reports real generator state/failure, and supports reroll. Legacy resources are removed only after the real generator and retargeting replacement are executable; passing mock tests is insufficient.

#### Phased motion composition

**Conversational liveness recovery — implemented 27 October 2026 after live failure; live qualification ongoing.**
A failed generated-body attempt must not permanently latch all automatic presence and
speech motion unavailable. The same body owner may attempt a fresh internal generation
after a bounded failure backoff and successful cancellation settlement; no stale accent
is retried and an unsettled process cancellation remains a hard stop. Error diagnostics
remain visible until a fresh attempt. This grants no Conversation Admission or Action
authority and adds no worker or behavior selector.

Composed body presentation is Avatar output, not proof of a live inference lease. The
primary Avatar owner must publish its bounded local body/breath projection also during
warmup, ordinary stop and provider failure. Such output has an explicit local source and
model generation, no ARDY lease, execution success, phase or consumed-source claim.
Main validates the existing authorized sender, strict shape, current model asset and
generation monotonicity. Generated projections retain the exact Main-owned lease check.
Overlay consumes either projection and never starts another breath or body generator.
Model replacement and renderer reset invalidate both sources through the existing
presentation lifecycle. Facial and Spring Bone ownership remain unchanged.

**Speech gesture entry correction — implemented after live repro, 27 October 2026; qualification ongoing.**
An explicit, fresh speech-bound gesture supersedes queued ordinary presence and may
start bounded preparation from the currently admissible presence pose. It does not
wait for an intermediate thinking/rest loop or for its future accent hand shape to
be reached before preparation starts. The same final filter, hand transition,
contact constraints and consumed-PCM expiry remain authoritative. This applies only
to interruptible presence, never a protected gesture stroke or a manual preview.
Ordinary presence has no expiring communicative accent. While its next source horizon
is pending, it may hold source time and continue the same local breathing projection
within the existing provider deadline. It never banks PCM for catch-up. Gesture
deadlines still reject a stale accent; a normal presence wait must not be reported as
the failure of a requested gesture or permanently disable the body.
An accepted forecast is a committed forward phase boundary. If audible PCM starts
while presence is being interrupted, clock rebinding must preserve that forecast
until promotion or local recovery; it cannot request an earlier phase from Main.
Main's monotonic plan validation remains authoritative and is not weakened.
Preparation and post-accent hold may wait within the existing bounded provider
deadline while retaining the last admissible pose and local breath. The shorter
audible accent deadline applies to stroke entry; a delayed hold is not a new accent.
Consumed time is rebased rather than replayed, and speech completion still cancels
unconsumed work and enters local recovery.

**Contrasting emotion demonstration — decision after live repro, 27 October 2026.**
Character Response Generation remains the semantic owner of delivery selection. Its
bounded protocol instruction must distinguish performing an explicitly requested
emotion demonstration from narrating emotion names. Related canonical emotions may
share one VRM facial family; a demonstration should use at most three contrasting
families within the existing segment budget. No natural-language emotion parser,
second model, facial writer or new routing path is added. AudioPlayer's consumed PCM
continues to schedule delivery, AvatarExpressionMixer owns final facial values and
Overlay consumes the same typed delivery projection. Qualification observes actual
VRM expression weights in both renderers, rather than counting emotion labels alone.

**Living motion decision — 27 October 2026; implementation present, artistic acceptance pending.**
**Pose-adaptive turn planning — implemented 27 October 2026, replacing the rejected fixed-step fallback.**
The body executor uses a bounded receding-horizon footstep planner, calibrated from
the current rig proportions, foot contact extents, actual pose and acquired contacts.
Each landing triggers fresh candidate evaluation for both support choices, admissible
foot placements, heading progress and timing. Step count, first support, stride and
weight transfer are outputs of feasibility/cost evaluation, never a stored angle or
step sequence. Budget bounds stop planning; they do not prescribe its choreography.
The planner jointly checks leg reach, stance separation, hip/foot twist, sole support,
foot clearance and an explicit simplified COM/ZMP balance model. VRM supplies no
authoritative masses/inertias; the geometric COM proxy and resulting balance limits
must be documented rather than described as a full multibody physics simulation.
Continuous root and heading segments preserve boundary derivatives. Only verified
landing commits a contact; inability to find a feasible plan produces honest bounded
stabilization/failure. Interruption replans the remaining viewer-facing goal from the
actual pose. The planner returns transient kinematic data to the existing final body
writer; it has no clock, pose writer, process, semantic authority or external capability.
Qualification must demonstrate different plans for changed stance/proportions and
initial load, cadence independence, contacts, balance, cancellation and real videos.
Candidate search may forecast the next contact horizon incrementally within a bounded
renderer work budget. Such a forecast has no execution or contact authority: its goal
and predicted landing must still match the actually verified landing before adoption.
Cancellation, goal changes, model detach and mismatch invalidate the pending search.
No second clock, Worker/process, pose writer or unbounded frame-blocking search is added.
**Turn continuity correction — implemented after visual rejection, 27 October 2026; artistic acceptance pending.**
The same body executor plans continuous position/velocity/acceleration through
support transfers, carry integration remainder across step boundaries, and enter/leave
the calibrated crouch without a frame-wise root-height clamp. Fixed foot contacts do
not qualify a trajectory with visible joint acceleration discontinuities. Upper-body
contact projection may constrain its limb chain but may not rewrite a validated
full-body root path; leg reach/contact verification still rejects an invalid result.
Physical completion and artistic acceptance remain separate. No additional temporal
pose writer, generator, Runtime or relaxation of contact/joint checks is introduced.
The existing Body Animation Domain will compare identical transient SOMA horizons at
source, coordinate-retargeted, anatomical, temporal and final composition boundaries.
Opt-in qualification instrumentation is injected locally and never adds raw poses to
Runtime Health, IPC diagnostics, Character State or conversation history. Physical
joint/contact constraints remain separate from catalog-driven artistic amplitude.
One source-velocity-aware temporal integrator will replace cascaded artistic damping;
the final swept contact guard remains authoritative and cannot silently impose a
second ordinary tracking filter. Consumed PCM remains the conversational clock.

The same canonical motion catalog will additionally declare a bounded turn-in-place
action with explicit rig, posture, support, root, direction, tempo, completion and
interruption contracts. This is an extension of the existing body executor, not a new
Runtime, Action Runtime tool or independent animation catalog. Standing profiles keep
their anchored double-support policy. The body owner will accumulate continuous
heading and alternate support acquisition/release, preserving planted world-space foot
position and orientation with model-calibrated leg IK. A pinned-model capability probe
must precede choosing generated turning; if its contact/heading accuracy is inadequate,
the selected bounded procedural footstep trajectory is reported honestly as procedural.
Neither an elapsed timer nor scene rotation alone proves a completed physical turn.
Completion requires actual heading, contacts, reachability and stable recovery; an
interruption/failure retains its terminal reason after recovery. Model replacement
invalidates execution identities and clears model-specific support targets.

The primary body composer will project only its bounded stage transform, continuous
heading, execution identity and monotonic presentation timestamp alongside the existing
composed bones. Overlay interpolates that same result and owns no second trajectory or
generator. Gaze, facial, head, breathing and secondary-motion ownership are unchanged.
Character may request only validated semantic action parameters through its existing
embodiment contract and current availability; it never receives bones, trajectories or
raw conditioning. Draft actions remain unavailable to automatic selection until the
required physical and visual qualification is accepted.

**Decision — 26 October 2026; Runtime implementation — 27 October 2026; preset qualification ongoing**

The animation-library revision implements phase-based motion execution inside the existing Avatar Runtime Body Animation Domain, following the separately reviewed target decision and code Work Items. Generated playback provides the explicit preparation/completion lifecycle, executable transition timing and phase-aware hand composition described below. Deterministic implementation checks do not complete the separate real-rig, artistic and joint speech qualification; preset activation remains conditional on those results.

The currently implemented revision is limited to standing presence and gestures with both feet supported. The living-motion decision above plans the separate turn-in-place support class; seated motions, sit-down/stand-up sequences and walking remain outside the implementation scope. The artistic preset and its qualification cases are planning data; they do not introduce another canonical source of architectural meaning.

Character Response Generation and existing typed Behavior projections supply bounded semantic intent. Avatar Runtime translates an admitted intent into a physically compatible movement; it does not infer dialogue meaning through phrase or keyword routing. The animation catalog is the canonical source for profile availability, entry/exit conditions, motion families, required rig capabilities, constraints, hand scores and bounded variation. Renderer UI and worker-readable data derive from that source.

One motion execution has an identity and revision bound to the current model generation, generator lease, catalog revision and profile. It owns preparation, stroke, hold and recovery phases with bounded durations, interruption points and observable exit conditions. Preparation remains pending until its required output is ready. Reading diagnostics never changes execution state. Outcomes distinguish completed, superseded, cancelled, timed-out and failed; missing frames, producer completion, a readiness delay or a fixed generic timeout never prove semantic completion.

Transition planning belongs to this same body owner. It checks the actual current composed pose, hand roles and occupancy, wrist orientation, finger shape, support, rig limits, camera compatibility and intent freshness. It may choose a direct compatible continuation, a bounded bridge, or recovery to standing presence. Incompatible transitions are rejected with a bounded reason. Idle, speaking, reaction and debug preview requests use the same executor and physical constraints; none may bypass them. Queues are bounded, expiring and superseded by semantic family. Selection cooldown reflects actual execution rather than a rejected candidate.

Main retains ownership of the single ARDY Adapter, process and validated transport. Phase intent adds no arbitrary renderer prompt, executable, filesystem path, script or process configuration. Requests and results validate execution/phase and plan revision in addition to the existing lease, sequence and skeleton identities. Catalog, calibration and reference-frame compatibility are explicit. Actual temporal blending follows the accepted transition plan and reports its real state. Source history and generated horizons remain bounded and transient; canonical pose/constraint data do not become a cached library of generated clips.

Every profile includes a hand score for both hands. Shoulder, elbow, forearm, wrist and fingers share the motion execution, phase and selected motion cursor. The hand score describes leading/supporting roles, bounded wrist orientation, per-finger flexion and spread, thumb opposition, preparation of the target shape, hold and coordinated release. Targets are translated through a revision-bound calibration of the loaded rig. SOMA30 supplies the body/wrist candidate; a bounded hand contribution supplies finger chains and constrained wrist refinement within the same body composition owner. There are no competing final wrist writers or independent hand timers.

Hand shape reaches its declared target at the associated gesture accent, remains appropriate during hold, and recovers or bridges continuously from the actually applied pose. A phase change, seed variation, reroll, replan or supersession cannot reset fingers independently of the arm. Missing required hand capabilities make the corresponding profile unavailable; static fingers or an open palm do not constitute successful execution of an unsupported exact finger gesture. Completion includes the exit conditions of both arms, wrists and fingers. Overlay consumes their composed projection and never starts another hand executor.

Cancellation immediately invalidates old inference results and aborts owned provider work. A bounded local visual recovery may start from the last valid composed pose without replaying cancelled generated frames; otherwise the body holds a valid pose with explicit degraded state. Body recovery does not acquire facial, gaze or secondary-motion authority. Emergency Stop and model replacement remain authoritative and do not wait for a decorative gesture to finish.

#### Planned Character LLM embodiment prompting

**Conversational selection review correction — implemented 27 October 2026 after review of 1025d9a; visual qualification remains pending.**
The canonical catalog's actual profile kind determines body composition authority in
every resolver path, including cooldown fallbacks. A presence selected for speaking
or reaction usage retains base authority; usage never turns it into a gesture.
The final composer derives authority from the actually applied profile, not a queued
replacement request. Pending gesture preparation cannot suppress the preceding
presence before generated gesture output is applied.
Communicative acts continue to come from the same Character LLM's typed semantic
intent. The LLM may propose a fitting conversational gesture while explaining,
comparing, agreeing or expressing a reaction without requiring an explicit animation
request. Emotion alone must not invent greeting, agreement or disagreement. Missing
semantic intent takes compatible continuous presence, not a fabricated semantic act.

Conversation qualification must observe the unmodified Character response path in
ordinary Chat with real LLM, Fish and ARDY. It records typed intent, selection, actual
applied profile/layer, execution and prepare/stroke/hold plus final local joint and
world-space hand displacement. A named profile, advancing cursor or preparation-only
sample cannot qualify a gesture. Fixed typed fixtures remain executor tests and must
be reported separately. Physical/numerical pass and visual readability stay distinct;
five minutes of real conversation and return to idle are required acceptance evidence.
No new Runtime, semantic router, pose writer or relaxation of anatomical safety is added.
Conversational qualification metadata is scoped to conversationally eligible profiles.
A draft manual physical action cannot mark the already qualified conversational
families unqualified; its body-action availability remains separately gated.

**Short-response preparation timing — implemented after real prepare-only repro, 27 October 2026; real-provider stroke observed, visual qualification remains pending.**
For a validated direct-answer plan with no planned tools, the existing turn may forward
its qualified semantic hand-gesture intent immediately after planning, before prose.
This starts speech-bound preparation only: no physical action, accent, completion or
user-visible claim is authorized until actual consumed PCM. The existing admitted-turn
identity, expiry and cleanup release preparation on provider failure, empty reply,
cancellation or replacement. Tool-bearing plans still defer the visual proposal until
actual Character prose. There is no extra model call, speech delay or new intent owner.

**Conversational camera boundary — user correction, 27 October 2026.**
Conversational gestures never move or widen the presentation camera. Existing
user-selected framing and camera controls retain their behavior. Qualification
observes raw-hand motion and fingertip visibility in that unchanged framing;
cropping remains an explicit readability failure rather than being hidden by
automatic camera motion or a changed acceptance threshold.

**Continuous expressive embodiment review — implemented 28 October 2026 after 1868536; joint artistic qualification remains separate.**
The existing generated-body owner must qualify phase handoff against consumed PCM,
accepted horizon coverage and actual provider latency. Reproduced queue defects are
corrected there without increasing the stroke waiting deadline or replaying expired
accents. Generation failure retains autonomous procedural presence and performs the
existing bounded recovery; inference readiness never authorizes a late semantic act.
Gesture selection may inspect the fixed presentation frustum and calibrated expected
hand workspaces before execution. A physically valid but invisible act is not a
readable candidate. Any compact workspace is resolved before the execution starts,
remains anatomically admissible, and shares the existing body/hand phase cursor.
Changing a Preview camera never warps or clamps an executing trajectory. Facial or
head presence may remain expressive when no appropriate visible hand act is available;
it cannot be reported as a performed explicit hand gesture.

The existing Facial domain audits supported expressions and their actual bound
morph/material contributions on model attachment. Unsupported or zero-effect facial
controls are reported honestly rather than amplified. Bounded brow, eyelid and mouth
acting contributions are capability-gated, have attack/release and cancellation, and
compose through AvatarExpressionMixer alone. Blink closure and LipSync retain their
own authority; facial acting cannot reopen a blink or replace phoneme articulation.
The same semantic emotion and consumed speech timing drive both presentations; an
Overlay never starts a second unsynchronized facial actor. No new top-level Runtime,
Character State dimension, TTS contract or raw-geometry diagnostics is introduced.
The 2D branch is a behavior reference, not a renderer to copy. Numerical transport,
physical readiness and artistic acceptance are separate qualification results.

**Facial binding audit decision — implemented after measured model audit, 28 October 2026.**
The selected VRM0 contains functional ARKit brow, eyelid and mouth-corner targets
that its VRM expression groups do not expose. The Mixer may register transient,
private expression binds for an exact allowlist of those existing targets after
checking nonzero geometry deltas. It unregisters only its own declarations on
detach. This changes no asset or skin weights, writes no morph influence outside
the Mixer and never invents an unsupported channel. The bounded acting/eyelid
presentation travels with the existing composed body projection so Overlay consumes
the primary actor's values rather than running another random facial sequence.
Facial profile resolution preserves the original semantic emotion and its existing
facial aliases. The six-category body/ear modulation projection must not collapse
distinct facial profiles such as laugh and chuckle into happy. That projection
remains valid for its existing body/secondary-motion owners, not facial selection.

**Audible phase-handoff correction — implemented after deterministic reproduction, 28 October 2026.**
A ready forecast can cap the applied cursor at its boundary while physical preparation
is still reaching its admissible pose. Consumed PCM continues during this hold. That
unapplied interval is discarded from the body's clock origin at the cap; it must not
be repaid as a jump into the following stroke. The next phase begins at its already
prepared boundary and advances only with subsequently consumed PCM. This does not
alter audio, increase phase deadlines, accelerate an expired gesture, or relax queue,
anatomical, speech-window and cancellation checks.

**Compact hand candidates — implemented and manually qualified 28 October 2026; joint conversation acceptance remains separate.**
Greeting, explanation and celebration may have separate close-framing catalog
candidates using the existing rig-relative face workspace and the same semantic
family/cooldown. Their conditioning and hand score are declared before execution;
an optional bounded workspaceExtentScale may inset a hand target inside that
existing region, with a bounded rig-relative workspaceOffset for a compact
gesture's authored height/lateral placement. Defaults retain the original region;
both expected visibility and physical admission share these parameters. Compact
open palms need room for their fingertips and must not obscure the eyes;
wrist-only visibility is insufficient.
they are not viewport clamps on a running gesture. Wide and close candidates have
different camera eligibility. New candidates remain manual draft profiles until
real-rig physical and readability checks support promotion. The fixed-frustum
visibility check remains authoritative after camera-policy filtering.

**Admitted preparation reaching — implemented after compact-candidate failure, 28 October 2026.**
The neural source can stop at a ready forecast while IK is still reaching an admitted
hand workspace. Zero neural speed must not impose an unrelated sub-radian-per-second
cap on that physical preparation. For active nonrelaxed gesture arms in preparation,
the existing temporal tracker may derive its correction speed from actual angular
error and remaining authored preparation time. Existing anatomical projection,
collision sweep, joint speed ceilings and acceleration envelopes remain authoritative.
Ordinary source tracking, presence, stroke and recovery retain their existing policy;
no elapsed audio or waiting time is accumulated for catch-up.

**Swept clearance reserve — implemented after measured tangent contact, 28 October 2026.**
During acceleration-filtered gesture/reaction composition, the body collision sweep retains the same
3 mm clearance used by bounded surface sliding, rather than integrating to an
exact zero-clearance tangent, including recovery of that gesture. Legacy direct
recovery and presence/full-body sweeps keep their existing policy. This reserve
absorbs small breathing/attachment translations between frames without permitting
penetration or unbounded repair. The same sweep rejects unsafe paths and allows
only outward progress from a preexisting contact. Contact diagnostics and zero-contact
qualification remain unchanged.

**Expressive wink — implemented 28 October 2026.**
An entering amused/chuckle facial profile may request one bounded unilateral Blink
event when the model exposes bilateral eyelid expressions. The existing Blink
controller owns its envelope, cooldown and cancellation; it cannot interrupt an
ongoing blink/sequence. The composed eyelid pair is mirrored to Overlay. Repeated
updates of the same emotion do not restart the event, and no unsupported rig is
given an imitation wink through head or eye-wide movement.

**Compact source trajectory preservation — implemented 28 October 2026; joint readability qualification remains separate.**
Absolute projection of a distant generated wrist onto a narrow compact region
can erase its stroke at a box boundary. An explicitly authored compact target
may instead preserve source displacement relative to its phase-entry source
anchor, starting at the previously admitted offset. The bounded mapping stays
inside the declared region. A tighter preparation region can leave physical
travel room in the stroke region; changing extents rescales the admitted offset
so the same hand position remains the phase-entry anchor. It
advances only with the body source cursor, and still
passes anatomical projection, acceleration filtering and collision sweep. It
never creates an independent rhythmic gesture or replays waiting audio time.
The existing Character planning prompt also clarifies that its initial typed
visual decision is authoritative; explicit available gesture requests must be
represented there rather than promised in later prose. No intent parser or
second semantic planner is introduced.

**Pre-speech proposal reaffirmation — implemented after observed provider latency, 28 October 2026.**
An anticipatory proposal can expire physically before the provider's first prose
and first PCM. At first actual Character prose only, Main may reaffirm the same
validated typed visual decision if its original delivery TTL has already expired.
The existing shared10s TTL is unchanged; timely preparations receive no duplicate
event. This is renewed delivery of the original current-turn proposal before any
speech, not semantic replanning, an extended physical hold or a late audible
accent. Empty/tool-only/failing/cancelled responses cannot reaffirm it.

**Performed gesture cooldown — implemented 28 October 2026.**
Body family and Avatar selection cooldowns commit when a gesture's stroke is
actually applied, rather than when its preparation merely starts. Expired
unperformed preparation may therefore be proposed again by the same still-admitted
turn at first prose; a performed stroke keeps its normal cooldown. Presence,
bounded queues, physical phase protection and cancellation retain their owners.

**Typed conversational gesture decision and preparation — implemented 27 October 2026; deterministic validation complete, live validation not requested for this correction.** The same Character LLM may select one bounded semantic embodiment intent, or explicit absence, in its existing initial typed requirement/tool-planning result using the exact request-scoped Avatar availability. This is additional data in an existing model call, not a new planner, Runtime, tool capability, provider request or retry policy. It grants no tool authority. Invalid, absent or unsupported visual data never invalidates an otherwise valid tool plan or causes an extra provider call solely to repair embodiment. Except for bounded direct-answer preparation specified above, the existing safe response path forwards the validated decision at the first actual Character prose, before that prose reaches speech; provider failures before prose, tool-only rounds, empty responses and cancellations cannot present it as a performed gesture. A supplied typed decision is authoritative for that turn, including explicit absence; legacy early envelopes remain a compatibility input when no typed visual decision was supplied. External evidence never chooses this decision.

Within the existing Avatar owner, a fresh opening proposal may begin one speech-bound preparation while waiting for the first PCM. Preparation may move toward its admissible target but never consumes an opening stroke before audible playback. Repeated state/delivery updates adopt the same pending execution instead of restarting it or rejecting it against its own cooldown. A late proposal is eligible only for a subsequent active-speech gesture boundary, once, under the existing readiness, camera, cooldown, support, cancellation and expiry checks. It cannot replace a protected stroke, replay an opening accent or begin after speech completion. Prepared/proposed identities are transient turn-bound controller coordination, not another Character State or physical pose owner. Model replacement, foreign turns, manual preview, expiry, cancellation and speech end release matching preparation. Known bracketed gesture literals are contained as malformed internal syntax without interpreting prose as a command; quoted code and ordinary links remain literal.

Character LLM receives an explicit System Prompt contract describing how to request visible embodiment through bounded typed semantic intent. It decides whether a communicative gesture is useful, which supported semantic act expresses the request, and its bounded intensity and gaze hint. It never selects model files, animation IDs, generated trajectories, bones, coordinates, finger joints, phase timing or ARDY prompts. Avatar Runtime retains selection, physical planning, hand composition, transition legality and actual execution. A semantic request is not proof of visible execution, and no new generic animation Tool or Plugin invocation surface is introduced.

The intent vocabulary and meanings derive from the versioned semantic contract and catalog mappings, with examples that distinguish greeting, agreement, explanation, thanks, reassurance, farewell and optional playful accents. Emotion and vocal delivery remain distinct from communicative gesture intent. Presence, natural Blink, gaze arbitration, ears/tail behavior and Spring Bones remain with their existing owners and do not require a model command for every update.

Fixed System Prompt instructions explain the format and semantics, not current availability. For each request, the Main-owned Character Request Composer may include a compact validated projection from the existing Avatar owner, bound to catalog revision and model generation, containing available semantic families and bounded failure/unavailability facts. It contains no raw poses, rig data, arbitrary renderer-written prompt text or full animation-library dump, and creates no second availability store. Missing or stale availability is represented honestly; it does not authorize unsupported gestures. This context grants no external capability or authority.

**Conversational availability correction — implemented 27 October 2026; live qualification ongoing.** A qualified preview profile is advertised as a conversational semantic intent only when that same catalog profile is eligible for the conversational selector: positive selection weight, automatic selection enabled and speaking usage supported, in addition to actual rig, camera, error-free readiness and cooldown availability. A latched motion failure prevents availability even if the producer lease remains ready. Manual-only or reaction-only profiles remain inspectable in the library without promising an opening speech gesture that the selector cannot execute. Qualification promotion follows real-rig physical and visual checks, then production Character/Fish joint validation; a candidate promotion is not evidence that validation succeeded.

**Recovery qualification diagnostics — implemented 27 October 2026; live qualification ongoing.** Existing bounded motion health may identify the currently unsatisfied recovery exit condition (`hands`, `arms`, `root`, or `feet`), without exposing poses or adding a correction writer. A recovery deadline failure remains a failed execution and latches an explicit motion error; a physically safe final image does not prove completion. This is diagnostic state within the existing Avatar owner, not another source of character state.

**Recovery integration correction — implemented 27 October 2026; live qualification ongoing.** Local recovery's phase clock and interpolation use the same bounded integration interval, at most 50 ms, as the final admissible body constraint pass. A delayed render callback cannot consume 100 ms of recovery budget while permitting only 50 ms of physical approach. Recovery never advances conversational PCM. A separate monotonic wall deadline, the greater of ten seconds or three catalog recovery maxima, prevents indefinite recovery when presentation is heavily throttled; expiry remains an explicit timed-out failure, not completion.

**Applied phase clock correction — implemented 27 October 2026; live qualification ongoing.** The first matching applied horizon anchors a new physical phase at its actual current source cursor. The source interval spent displaying the preceding accepted lead-in is not elapsed time of the newly ready phase, even when the new horizon starts at an older overlap boundary. Forecast boundaries still choose generation and coverage; they never grant physical completion credit before matching output is applied. Later phase advancement remains bound to actually consumed source time, and audible expiry/cancellation still prevents late replay.

**Admissible recovery routing correction — implemented 27 October 2026; live qualification ongoing.** When the direct arm path toward standing recovery intersects the calibrated torso, the existing body constraint pass may choose a bounded anatomical clearance waypoint using the same two-bone solver, stable model-oriented poles and unchanged angular limits. The search is finite, transient and restricted to local recovery; ordinary generated gestures retain their canonical workspaces. Every selected waypoint must have an admissible swept path from the previous applied arm. As soon as the direct recovery path has clearance, the composer resumes its original rest target. This adds no generated phase, stored trajectory, pose writer, inference process or facial authority. Failure to find or finish a route remains an explicit bounded failure.

**Coupled arm integration correction — implemented 27 October 2026; live qualification ongoing.** Shoulder-arm, forearm and wrist candidates that share a swept-path check must advance by one common interpolation fraction. That fraction is bounded by the most restrictive existing per-joint angular budget, including the wrist ratio. Independent rotate-toward fractions describe a different kinematic path from the one that was checked and can drive a clear chain into a contact boundary. The final full-chain sweep remains authoritative. This changes coordination within the same constraint pass, without increasing joint speeds or moving authority.

**Held-arm correction gate — implemented 27 October 2026; live qualification ongoing.** A held consumed-PCM cursor preserves its last admissible arm chain. Clearance padding alone cannot initiate another arm correction while that chain remains physically clear; an actual contact introduced by a moving attachment may still require bounded repair. Such repair authorizes wrist reprojection only for the affected limb, never every arm because one global correction counter is nonzero. Actual torso collision checks and the final swept-path guard remain unchanged.

**Standing catalog recovery budget — implemented 27 October 2026; final target-rig matrix pending.** Catalog revision `standing-v2-2026-10-27` permits up to 4500 ms for gesture recovery under the existing anatomical speed bounds and finite clearance routing. The recovery minimum and actual target-based completion remain unchanged, so ordinary returns do not wait for the maximum. Presence retains its existing budget. This deliberate calibration follows measured canonical clear-start return times of 2850–3467 ms on the three qualification rigs; the previous universal 2600 ms maximum was physically insufficient. Inference, speech clocks, cancellation and non-recovery phase deadlines are unchanged.

**Standing preset candidate activation — implemented 27 October 2026; qualification ongoing.** The existing catalog qualification gate may activate the physically and visually reviewed standing candidate for production Character/Fish qualification. This is a deliberate catalog-data change, not a test-only availability override. The remaining target-rig 28-by-12 matrix, semantic execution during real PCM, preservation checks and joint soak are still required for final acceptance; activation itself is not their evidence. A failing candidate must be repaired and requalified or returned to draft before completion. Manual-only and reaction-only selection restrictions remain authoritative after activation.

**Consumed speech release correction — implemented 27 October 2026; live qualification ongoing.** The end of a bound consumed-PCM playback releases even a protected speech stroke into bounded local recovery from its last composed pose. Stroke protection applies to ordinary supersession while speech is still active; it cannot authorize continuing or replanning an accent after that playback has ended. This normal release produces a superseded motion outcome rather than a provider failure. The Avatar owner enters local recovery before changing generation clocks or issuing another request; Main's accepted-phase monotonicity and stale-plan rejection remain unchanged. Audio playback is neither delayed nor restarted.

**Malformed emotion delimiter containment — implemented 27 October 2026; live qualification pending.** The existing safe incremental protocol filter suppresses unquoted canonical emotion names with malformed angle or mixed delimiters, including `<happy]`, without treating them as valid delivery or embodiment commands. Only canonical square-bracket syntax grants emotion metadata. Containment precedes streamed chat, speech commits and final reply parsing, remains invariant under provider chunk boundaries, and preserves quoted code, escaped literals, link destinations and ordinary text. Ambiguous incomplete prefixes remain bounded and do not gain protocol authority. This corrects a protocol leak in the existing owner, without changing the provider, semantic gesture selector or speech clock.

**Relaxed standing qualification — reviewed 27 October 2026.** A collision-free reference alone does not establish an artistically relaxed standing pose. Actual-rig qualification measures arm descent and wrist height as well as contacts, then reviews the displayed presence. An admissible but conspicuously abducted fallback is not evidence of artistic qualification. Assets, skin weights, colliders and temporal guards cannot be weakened to obtain an accepted image.

**Segment-specific garment clearance — implemented 27 October 2026; live qualification pending.** The existing model-attach calibration measures upper-arm and forearm garment thickness separately in each raw bind segment's own basis. Upper-arm-only sleeve samples cannot inflate the whole elbow-to-wrist segment. The body constraint pass retains the conservative upper-arm thickness for medial humerus crossings and uses measured forearm thickness for the complete forearm segment. Missing forearm measurements retain the existing conservative fallback; no global collision padding is reduced. Calibration remains bounded transient Avatar state, with unchanged assets, weights, solver ownership, inference pins and final swept-path/velocity guards. This deliberately corrects the previous combined-arm maximum, which could force a model with large upper sleeves into an artificial A-pose.

**Arm-deforming garment classification — implemented 27 October 2026; live qualification pending.** Static torso-clearance samples exclude vertices with material influence from the raw shoulder/arm subtree, including its attached sleeve bones. Those vertices move with the arm and contribute to the corresponding arm garment envelope instead of becoming a fixed obstacle inside the torso envelope. Forearm thickness uses the raw forearm subtree and its own longitudinal segment. The bounded sample count, skeleton fallback envelope and global padding remain unchanged. This separates deformation ownership within calibration; it does not modify skin weights, springs, colliders or the displayed mesh.

**Measured-envelope fallback correction — implemented 27 October 2026; live qualification pending.** When a sufficient bounded set of finite, torso-owned skin samples establishes width and depth, those measured extents define the torso envelope. Skeleton-derived dimensions are the fallback for absent or insufficient measurements; they are not an irreducible minimum imposed over a measured smaller body. Existing clearance padding and per-segment garment radii still apply. This restores the existing measured-skin-with-rig-fallback decision and requires real-rig contact and artistic preservation checks.

**Recovery waypoint completeness correction — implemented 27 October 2026; live qualification pending.** A finite clearance waypoint selected by the existing recovery constraint pass must have both an admissible path from the applied arm and an admissible onward path to the actual standing reference. A locally nearest safe waypoint with no validated onward path can become a zero-motion dead end. The existing swept checks, pose ownership, angular budgets and honest failure outcome remain authoritative; an isolated clear waypoint is not a recovery route.

The embodiment contract and its selected vocabulary remain intact within the bounded request composition policy, including minimum allocation for every present section. The full preset and its variations are not appended to every prompt. A default absence of a gesture request is valid, and neutral presence is a normal outcome; instructions must not force a gesture on every sentence or turn.

Streaming must make a validated intent available before the motion phase it is intended to affect. The current optional trailing embodiment marker alone cannot guarantee an opening gesture when speech has already started. A versioned early internal intent envelope is designed within the same provider-neutral Character Response Generation path and safe incremental protocol, without a keyword router or another semantic owner. Until early intent is available, Avatar Runtime uses compatible presence. A late valid intent may affect only eligible future phases or expire; it never rewinds consumed speech or restarts an already completed accent.

System Prompt, typed intent schema, catalog mapping, incremental filter, final parser and request-scoped context are updated as one coordinated protocol version. Malformed, unknown, stale or externally injected markers cannot reach visible chat, speech, history or direct model control. Tool-call-first rounds still expose no prose. Rejected, unavailable or expired gestures produce bounded honest state rather than a claim of successful playback. Contract, prompt-budget, parsing and streaming timing tests are required before enabling the new semantic vocabulary.

#### Planned streaming speech and motion timing

The existing Fish Audio S2 Pro streaming path and phased body execution coordinate through typed ports and AudioPlayer's actually consumed source-sample clock. Their Runtime ownership remains unchanged: the Speech API synthesizes, Speech output coordinates transport, AudioPlayer plays and reports consumption, and Avatar Runtime composes visual output. No universal coordinator, second playback owner, second semantic state store or combined Speech/Motion process is introduced. Desktop and API remain independent; this animation revision preserves HTTP 2.1 and `/tts/stream` protocol 2.

Turn identity, speech session, playback identity and motion execution remain distinct, explicitly correlated identities. Speech-bound motion phases, hand scores, LipSync timing and delivery cues use the current playback's consumed sample position. Network arrival, first PCM receipt, transport ACK, render-frame count and estimated text duration do not replace it. Text commits and delivery metadata pass the existing safe incremental protocol boundary before user-visible text or speech.

Preparation may occur before audible playback without declaring the speech accent complete. Successive PCM packets do not create new gestures, LipSync sessions or ear impulses. Delivery changes apply at the audible sample boundary and do not overwrite conversational emotion. Existing admission policy remains authoritative; this revision introduces no separate barge-in or conversation-start path.

Buffering holds the speech-coupled body/hand cursor and future cues. LipSync follows actual playback energy and permits bounded mouth release during silence instead of retaining a falsely open mouth. Provider completion ends production, not audible playback: the queue may still contain samples. Only actual consumption completes speech playback, after which visual recovery uses an explicitly selected monotonic local clock without a discontinuity. A gesture outcome and a speech-playback outcome remain separate facts.

Late or failed motion never blocks healthy audio playback or LipSync. The Avatar owner reports degraded motion, holds or recovers within bounds, and discards stale accents rather than racing to catch up with speech. Speech failure or cancellation invalidates queued PCM and cues; each owner cancels its actual inference work and rejects late callbacks for the old identity. Conversation Admission retains Single-Flight through mandatory cancellation settlement and cleanup. Ambient blinking and secondary motion are not unfinished speech work and do not hold admission indefinitely.

Sample-clock coordination does not promise word or phoneme alignment that the provider contract does not supply. LipSync continues to use the actual playback signal and its bounded phrase contributions. Exact future alignment would require its own validated metadata contract; neither keyword routing nor guessed timing from text length may silently claim that guarantee.

#### Planned secondary motion and facial continuity

The animation-library revision preserves the existing ear/tail behavior, Blink, Speaking Eye, gaze, facial and LipSync owners and their established tuning. ARDY body and hand masks exclude head/neck, eyes, jaw, facial expressions, visemes, ear bones and tail bones. Semantic motion requests may communicate bounded intent through public contracts but never mutate these channels directly.

Ear behavior owns calibrated semantic poses, emotion modulation, impulses, cooldowns and asymmetry. Tail behavior owns its bounded profile/emotion offsets and removal of its preceding contribution. Spring Bones own secondary physical response through the VRM integration; the solver does not decide emotion or gesture semantics. The loaded rig's body, hand, ear/tail control and spring-chain membership must be inspected before changing composition. Overlap is handled through the established control-pose-to-solver path, without applying the same offset again to every descendant or silently disabling physics.

The integration retains one model-update path per VRM frame: remove the preceding removable procedural contribution; apply body/hand output; compose procedural, head/gaze and ear/tail control contributions; compose facial output; then execute the installed VRM update path. The existing integration performs normalized-to-model updates, LookAt/expression evaluation, node constraints and Spring Bones through that path. Do not add duplicate manual humanoid, expression-manager or spring-manager updates around `vrm.update`. Validation may observe the resulting pose but cannot become a competing writer after physics. Model-specific springs, colliders and physical parameters are preserved unless a separate deliberate change qualifies them.

BlinkController contributes blink, SpeakingEyeController contributes speaking squint, LipSync and phrase/closure controllers contribute mouth intent, and AvatarExpressionMixer remains the final facial composition owner. LookAt retains its existing gaze-owned channels and arbitration. Body transitions cannot reset blink, write visemes, replace gaze arbitration or suppress facial articulation. Emotion, blink, eye squint and mouth contributions remain compatible under the established composition policy.

Speech-coupled body/hand timing is distinct from the monotonic local time used by natural blink, ambient ear/tail behavior, gaze smoothing and physical settling. An audible cue may modulate a secondary contribution through its owner; buffering must not freeze all life and physics. Physical tail/ear lag is intentional secondary response, not finger-timing drift.

Body stop, TTS cancellation and gesture changes release only their owned state; they do not trigger a blanket avatar reset. Model replacement and shutdown idempotently detach controllers, restore/remove owned offsets as appropriate, invalidate generations and release subscriptions. Missing optional ears, tail or springs degrades those features without breaking Core body, face or speech.

Overlay continues to consume composed body/finger/chest and mouth presentation while retaining the established presentation policy for its facial/gaze/secondary paths. Each rendered VRM has one local physics update and no inference owner. Do not project already simulated raw spring transforms and then independently simulate those same transforms a second time. Exact matching of all secondary physics between windows would be a separate presentation-contract decision, not a second independent behavior implementation.

**Implementation and acceptance boundary**

Before implementation, record the decision in this canonical document, check it against Runtime ownership and invariants, then create or revise the implementation plan and explicitly check every Work Item against these sections. Code follows only after that architectural and plan-consistency review. A newly discovered architectural conflict returns to the decision step; it is not resolved through an undocumented behavior change in code.

Phase execution, transition planning, retargeting, hand composition, playback timing and secondary/facial composition remain separately understandable responsibilities behind typed contracts. Lifecycle transitions and planning are deterministic; diagnostics are read-only; queues and resources are bounded; every detached Promise has an observer and every subscription has idempotent teardown. Behavior-preserving extraction, bug fixes and intentional preset changes are separate Work Items.

Acceptance includes delayed first-frame readiness, real transition timing, body/hand completion, PCM buffering and audible completion, stale callbacks, actual inference cancellation, model replacement, and preservation of ear/tail behavior, spring updates, Blink, Speaking Eye, gaze and LipSync. Deterministic tests and real-VRM qualification provide different evidence: a synthetic skeleton without spring chains cannot prove spring compatibility. The new preset is enabled only after the applicable preservation and visual checks pass.

#### Current Avatar Runtime integration

**Character State Integration**

Avatar Runtime continuously observes Character State. Typical mappings include:

- `Mode = Thinking` -> thinking animation
- `Emotion = Happy` -> happy expression
- `Speech = Speaking` -> lipsync enabled

Avatar Runtime never receives implementation-level model mutation commands from other Runtime systems. Semantic embodiment intent may arrive through Character State or a stable public contract, but bone transforms, morph weights, eye direction, mouth weights, and animation actions remain Avatar Runtime's internal implementation. See Embodiment Intent above.

**Event Integration**

Avatar Runtime may publish events such as `AnimationStarted`, `AnimationFinished`, `GestureStarted`, `GestureFinished`, `BlinkCompleted`, and the embodiment lifecycle events described in [Chapter 9 - Event Bus](#9-event-bus).

**Health Integration**

Avatar Runtime owns an explicit serializable health projection covering initialization, model availability, presentation attachment, operational readiness, and its last contained load failure. This projection is diagnostics, not Character State, and no other component may infer Avatar Runtime health from an adjacent projection such as overlay state or the last mirrored avatar-state payload. A Runtime Support Bundle may cache the last renderer report, but it must identify that report as stale whenever the owning renderer is not ready.

**Architectural Guarantees**

- rendering technology remains replaceable
- visual layers remain independent
- Avatar Runtime represents state; it does not define it
- expressive clarity takes precedence over animation complexity
- embodiment domains remain isolated while sharing a single final composition and model application boundary

**Explicit Non-Responsibilities**

Avatar Runtime does not decide conversation policy, does not perform speech recognition or synthesis, does not select emotions independently of Character State, and does not own tool execution or external integrations. It expresses what other Runtime systems have already decided.

**Future Evolution**

Expected improvements include procedural gestures, adaptive idle behavior, richer breathing, contextual gaze, emotional body language, layered animation scheduling, expressive timing, richer facial source composition, priority-based gaze arbitration, speaker-aware gaze targets, emotion-aware lip-sync shaping, model capability discovery, generic secondary-motion adapters, and runtime-selectable embodiment profiles. These are directions, not current guarantees; see [Chapter 24 - Future Evolution](#24-future-evolution). The responsibility remains representing the physical presence of the character.

### 21. Memory Layer

**Purpose**  
Memory Layer preserves the continuity of the digital character. Its purpose is not storing data. Its purpose is allowing Shio to remember.

**Responsibilities**

- long-term memories
- episodic memories
- conversation summaries
- remembered user facts
- remembered character experiences
- memory retrieval
- memory consolidation
- forgetting policies

**Non-Responsibilities**

- dialogue generation
- emotions
- rendering
- speech
- external integrations

**Internal Model**

Memory is an architectural concept. Storage is an implementation detail. SQLite, PostgreSQL, vector databases, and other providers are storage technologies rather than memory itself.

Memory categories:

- **Episodic Memory:** conversations, completed projects, important events, memorable moments
- **Semantic Memory:** persistent facts about users, preferences, recurring interests, relationships, and long-term facts
- **Working Memory:** active conversation, temporary context, unfinished reasoning, pending actions
- **Procedural Memory:** approved recurring habits, shared motifs, and interaction-style continuity stored separately from Semantic Memory facts

Memory retrieval should be selective rather than indiscriminate. The objective is contextual continuity rather than maximum recall.

Memory consolidation determines whether temporary information should become long-term memory. Forgetting is a feature rather than a limitation. Obsolete preferences, insignificant conversations, expired context, and duplicated information should naturally fade.

Semantic Long-Term Memory v1 is an explicit-persistence capability. Character Response Generation receives only current availability and typed operations resembling search, store, update, forget-by-id, and list. It does not receive the complete memory collection in every prompt. One turn may perform several operations through a bounded loop, including search followed by update or exact-id deletion. Mutation acknowledgement follows persistence; storage failure remains contained and ordinary chat continues.

The internal authority path is:

```text
Character Response Generation
  -> Memory Tool Broker
  -> Memory Policy
  -> Memory Runtime
  -> Memory Store
```

The Character LLM normalizes explicit user requests into atomic durable facts. Memory Tool Broker owns strict schema parsing and transport normalization. Memory Policy owns deterministic invariants such as enablement, operational state, current-turn provenance, bounds, secret rejection, and exact referenced-id existence. Memory Runtime owns retrieval and mutation semantics. Memory Store owns replaceable persistence. The LLM never receives SQL, storage paths, filesystem access, or direct database authority.

Memory search is selective and strategy-based. Bounded lexical/FTS retrieval is the mandatory operational fallback. Optional semantic retrieval is supplied by a replaceable Embedding Adapter and composed with lexical candidates through a bounded reranker without changing the Character-facing tool contract. Stored text and retrieval results are untrusted contextual data and can supply facts only; they cannot change instructions, grant authority, disclose secrets, or invoke another capability.

Semantic Memory v1 stores only normalized atomic records whose source is an explicit conversation turn or manual UI operation. It does not persist raw conversation transcript, Project Context packets, Browser Observations, Screen Context, Action results, or Character State projections automatically. A manual Memory UI is an equal client of the same Memory Runtime and Store. Disabling Memory removes its tools from Character Response Generation while preserving user-controlled records and manual management.

Personality answers "Who is Shio?" Memory answers "What has Shio experienced?" Experience Layer generates experiences; Memory Layer decides whether those experiences deserve preservation.

**Character State Integration**

Memory Layer may observe Character State and future memory-relevant state dimensions, but it should not misuse Character State as a historical archive.

**Event Integration**

Memory Layer evaluates completed interactions, experiences, promises, recurring preferences, and memorable moments as candidates for preservation.

**Architectural Guarantees**

- memory belongs to the character, not to the language model
- conversational user/assistant pairs become visible to Memory together only after successful response generation; failed or cancelled turns leave committed history unchanged
- retrieval is relevance-driven
- continuity matters more than storage volume
- forgetting preserves quality rather than weakening memory
- natural-language Memory intent remains with Character Response Generation, not a phrase parser
- every Memory mutation passes the same Runtime policy regardless of native-tool or structured-fallback transport
- credentials and secrets are rejected independently of Character LLM behavior
- long-term Memory persistence remains internal Core state and does not pass through Action Runtime

**Future Evolution**

Future improvements may include more sophisticated consolidation and stronger continuity across long-lived projects and interactions.

### 21A. Conversation Threads

Conversation Thread Runtime is a Main-owned short-lived continuity store for typed unfinished conversational topics. A thread contains a bounded topic, summary, lifecycle status, source turn, salience, timestamps, and expiration. It stores at most eight unfinished threads, returns at most one bounded awareness item to an ordinary Character request, deletes resolved or expired items, and keeps its own SQLite file under application `userData`.

Threads are neither Semantic Memory nor Persistent Goals. They may be opened or resolved only through typed `thread.open` / `thread.resolve` operations selected by Character reasoning for a substantive interruption, explicit later-return request, waiting-user state, or temporary branch. There is no phrase, keyword, or regex router and no implicit capture from every sentence. Thread Runtime imports neither Memory nor Goal ownership; expiry and resolution do not create durable records. Promotion to a Persistent Goal or Semantic Memory fact requires a separate explicit user-authorized operation through that domain's existing policy. Thread context is untrusted bounded conversational fact, never instruction or capability authority.

### 21B. Project Awareness Runtime

Project Awareness Runtime owns read-only, commit-scoped knowledge about one configured project repository. This is a separate responsibility from Memory Layer: Memory Layer preserves character continuity and experience, while Project Awareness Runtime derives technical evidence from an external source at a specific commit.

Its responsibilities are:

- connect to a configured repository through a Project Repository Adapter
- identify the configured branch and its remote HEAD
- filter source files before content retrieval
- build and atomically publish commit-scoped file, symbol, chunk, and project-map indexes
- update the index incrementally when the remote HEAD changes
- expose bounded read-only search, file, symbol, project-map, and recent-change contracts
- determine Project Snapshot Freshness by comparing the indexed snapshot commit with the observed remote branch head
- produce a bounded deterministic changed-file projection for a stale snapshot through the existing repository comparison Adapter contract
- accept typed `project.search` requests containing a model-selected semantic query and optional path or symbol hints, then apply bounded retrieval policy without classifying the user's natural-language intent

Project Awareness Runtime owns synchronization and retrieval policy. A Project Retrieval Query Compiler turns the already model-selected semantic query and typed hints into a bounded storage query plan, including normalization and technical aliases; it does not classify the original user turn or decide whether retrieval is needed. Project Evidence Selector owns ranking and packet selection. The Project Repository Adapter only translates provider APIs into read-only repository contracts. Project Knowledge Store accepts prepared query plans and provides SQLite/FTS persistence and query primitives; it does not own stop-word policy, technical aliases, Character orchestration, what to index, or which evidence enters context.

The configured GitHub repository and branch are Project Awareness Plugin settings, not implementation constants or Core application settings. Updating that target disconnects the previous repository before the Runtime may connect to the new target; commit-scoped snapshots remain keyed by repository and branch so knowledge from different targets is never merged.

Project knowledge is never represented in Character State. A repository snapshot is external technical evidence, not a character experience, so it is not ordinary conversational memory. A Project Context Packet is an ephemeral input to Character Response Generation and must identify the exact repository, branch, and commit used.

Project Snapshot Freshness is a main-owned diagnostic fact distinct from Plugin lifecycle, Plugin health, and index state. Equal snapshot and successfully observed remote revisions are current; unequal revisions are stale; a new application session begins unknown until an explicit check or synchronization observes Remote HEAD. A failed explicit check is reported as check-failed rather than rewriting the last known remote revision or invalidating the local snapshot. The latest successful remote observation is persisted only as historical diagnostic metadata and is never presented as a current-session check. Freshness checks are read-only, single-flight, rate-limited, and triggered only by an explicit check or synchronization; Plugin activation and detail inspection remain offline.

Synchronization builds and validates a candidate snapshot before atomically replacing the published snapshot. A fetch, indexing, validation, or rebuild failure leaves the previous immutable snapshot current and usable, including when rebuilding the same commit. In-flight and historical turns keep the exact snapshot identity they already received. A stale or temporarily unverified remote head does not by itself degrade Plugin health when a usable snapshot remains available.

Project Reply Provenance is derived exclusively from the Project Context Packet returned by an actually executed `project.search` call and used for final generation. Project Awareness Runtime owns the evidence facts, orchestration binds their safe projection to the assistant response, and the renderer owns presentation. The Character LLM may mention files in prose but cannot create authoritative provenance. When that packet participates in Action selection or planning, later tool rounds and post-action narration reuse the same rendered packet without an implicit second retrieval, and Reply Grounding preserves both the original project provenance and the Action Runtime result grounding.

Security guarantees:

- repository access is read-only
- repository credentials remain in the owning main-process secret boundary; credentials entered through the Project Awareness Plugin UI are encrypted with the operating-system-backed Electron secure storage under application `userData`, and renderer status payloads expose only credential presence and source, never the credential value
- generated indexes live outside the Git repository in application-owned data
- repository content is data, never instruction
- source files, comments, Markdown, strings, README text, and commit messages are never executed or followed as instructions
- the Runtime never writes to GitHub, creates commits or pull requests, changes project files, runs repository scripts, reads `.env` content, or integrates repository operations with Action Runtime
- retrieval is bounded by evidence count and total content size, and technical claims cite real file ranges and the snapshot commit

The first storage implementation may use SQLite with FTS5 and deterministic parsing without embeddings. Storage and repository providers remain replaceable behind their contracts.

Project Awareness is packaged as the first bundled first-party Plugin. The Plugin wrapper owns only adaptation between Plugin lifecycle and the existing Project Awareness Runtime: enable registers `ProjectContextProvider`, disable removes that capability before stopping the Runtime, and neither operation deletes the Plugin configuration, credential, index, or snapshots. Project Awareness Runtime retains ownership of synchronization, indexing, retrieval, grounding, and its read-only repository guarantees.

### 21C. Plugin Runtime

Plugin Runtime is an optional-extension Runtime inside the existing Runtime architecture. It is not a new layer between Core Runtime systems and Adapters. Version 1.1 discovers only compile-time bundled first-party Plugins; it does not load external JavaScript, scan arbitrary directories, install packages, or provide a marketplace.

Plugin Runtime owns:

- bundled Plugin registration and manifest validation
- lifecycle coordination for initialize, enable, disable, shutdown, and dispose
- persisted enablement state and truthful lifecycle/health projections
- contribution of validated bundled Plugin identity, enablement, lifecycle, health, and declared capability facts to the canonical capability projection, including disabled Plugins
- assembly of data-only health projections for enabled Plugins; disabled Plugins are absent and cannot degrade aggregate application health
- registration and removal of narrow typed capabilities declared by each manifest
- capability-only dependency resolution from validated `requiresCapabilities` declarations
- race-safe, idempotent lifecycle transitions and per-Plugin failure containment

Plugin Runtime does not own Plugin business logic, project knowledge, Character State, conversational memory, actions, permissions, Avatar Runtime, Speech Runtime, credentials, or concrete external technologies. A Plugin-specific external technology remains behind the owning Plugin's Adapter, and every externally authoritative side effect still passes through Action Runtime and Permission Guard.

Core consumes optional functionality only through stable typed capability contracts. A compile-time `PluginProviderMap` maps each provider capability kind to its exact provider interface; `PluginCapabilityRegistry.register/get` remain generic only over that closed typed map. Each bundled Plugin returns a typed capability-provider descriptor, and Plugin Runtime verifies that every descriptor entry is declared by the manifest before registration. This removes per-provider lifecycle boilerplate without creating generic invocation. There is no `plugin.invoke`, arbitrary method dispatch, direct dependency on another Plugin module, or renderer-controlled module loading. A Plugin may require another capability by kind, but never another Plugin implementation. An enabled Plugin whose required capability is absent remains installed and enabled with `waiting-dependencies` / `needs-setup` status and registers none of its declared capabilities. Dependency appearance activates the Plugin without restart. Dependency disappearance synchronously unregisters the dependent capabilities before asynchronous shutdown, including transitively, and the Plugin becomes operational again only after its requirements return.

The bundled Browser Control Plugin is the single owner of Shio browser automation. It launches the user's installed Google Chrome through pinned `playwright-core` with one headed persistent context stored below application `userData`. The profile is isolated from the user's personal Chrome profile and survives ordinary conversational idle periods. Plugin disable, Emergency Stop, application shutdown, and explicit browser close are the authoritative teardown paths. No second browser daemon, MCP bridge, or browser Runtime may attach to that profile.

Browser Control exposes two closed typed capabilities. `browser-control` provides read-only bounded context plus deterministic operations: observe, exact HTTP(S) open, snapshot-scoped semantic click/fill/select, bounded scroll, history navigation, tab inspection, and known-tab switching. `browser-computer-use` provides one generic bounded delegated session for websites, canvas applications, and keyboard-driven browser experiences. Both capabilities use the same Playwright context, page identities, observation lifecycle, and isolated profile.

Playwright Browser Adapter owns browser technology only. Every semantic observation contains a normalized page identity, URL/title, bounded visible text, and bounded interactive refs. Sensitive inputs are classified structurally; their live values are omitted or redacted before visible text, accessibility augmentation, model evidence, logs, or diagnostics are assembled. Normal semantic and Computer Use observations retain separate exact-observation ref registries, and a ref can resolve only against the observation and page that produced it. Computer Use observations combine a bounded accessibility snapshot and ref map with an optional transient masked JPEG screenshot when the configured `Computer Use Vision` model is vision-capable. This is a separate model role from the Character Brain and Fast Brain. Auto mode reuses the active Character provider/model only when its image support is confirmed; otherwise `browser-computer-use` is `needs-setup` while deterministic `browser-control` remains available. Provider credentials stay in the existing Main-owned credential store. Screenshots, raw DOM, accessibility dumps, credentials, and low-level input payloads are never persisted, copied to Character State or Memory, returned to renderer diagnostics, or appended to conversation history.

Character Response Generation may select only high-level tools: the deterministic browser operations plus `browser.use`, `browser.useStatus`, `browser.usePause`, `browser.useResume`, and `browser.useStop`. Coordinates, pointer down/up, key down/up, drag paths, screenshots, CDP, and arbitrary page JavaScript remain internal to the typed Browser Computer Use provider. The Main-owned Browser Computer Use model Adapter plans bounded visual steps. DSH remains shell-only and has no browser planning, session, frame, mouse, or keyboard ownership.

Every mutation still enters Action Runtime. Deterministic operations use the validated `desktop.workflow` browser branch; a generic delegated run starts as one `browser.use` Action whose confirmation contains the exact goal, termination condition, and effective duration bound. Goal-completion sessions additionally retain maximum steps and maximum actions. Continuous sessions terminate only at the requested time, an explicit Stop, a blocker or failure, or the Main-owned hard safety lease; Character Response Generation cannot supply or weaken the technical control budget. Full Control may change confirmation policy but never validation, scope, lifecycle logging, budgets, cancellation, verification, or input release. Pause, resume, and stop use the narrow registered `browser.use-control` Action path.

Browser Computer Use is coordinated at two frequencies. The existing slow `Observe → Decide → Act → Observe` path remains authoritative for ordinary semantic/visual actions, initial entry, result screens, blockers, recovery, and fresh goal-completion verification. For a continuous session, the same Main-owned visual model Adapter may instead return a strict declarative reactive plan: observation/page/session scope, masked visual fingerprint, bounded anchors, one allowlisted primitive, input frequency, re-anchor interval, and a maximum five-second TTL. A plan contains no selectors, code, scripts, arbitrary JavaScript, raw coordinates exposed to Character, or authority for another capability. The coordinator permits at most one visual-model request and one reactive plan at a time. While a re-anchor request is in flight, only the still-current unexpired plan may continue; model outage never extends its TTL.

The fast lane uses `Page.startScreencast` and CDP input inside the same Browser Control-owned Playwright page and persistent context. It ACKs every screencast frame and keeps only the newest pending frame, so capture cannot create an unbounded queue. JPEG decode, sensitive-region masking, downscaling, scene comparison, motion estimation, and bounded anchor tracking execute in one owned Worker Thread. Raw frames and tracking payloads are transient and never leave Electron Main, enter renderer state, Character State, Memory, conversation history, Experience, or diagnostics. The Main coordinator converts tracker results only into allowlisted pointer-follow, pointer-steer, directional-key, tap-target, or bounded pointer-hold intents. There is no second browser daemon, context, gameplay Runtime, model role, Action path, or input owner.

Slow decisions and reactive plans remain bound to the exact observation ID and page ID. Reactive input is additionally bound to the exact plan, monotonically newer frame, current active page, and maximum frame age. URL, navigation, active-page, viewport, accessibility state, low tracking confidence, strong scene change, plan expiry, pause, stop, blocker, provider failure, Plugin disable, Emergency Stop, browser close, or application shutdown invalidates control and releases held input. Coordinate decisions on the slow path remain bound to a masked low-cost visual fingerprint with a documented tolerance for caret and animation noise. Semantic refs are valid for one observation only. For a goal-completion session, a visual model's `done` output is only a proposal: a fresh read-only completion assessment must return `satisfied`; `not-satisfied` resumes and `uncertain` terminates without a success claim. In `until-stopped` and `until-time` sessions, `done` only yields the fast lane to slow observation and never fabricates goal completion. Model timeouts, malformed decisions/plans, rate limits, stale targets, limits, and cancellation remain typed failures rather than guessed success.

When an authorized autonomous session encounters a recoverable perception, formatting, stale-state, or transient provider failure, its existing Runtime prefers one bounded repair, re-observation, or degradation to the existing slow control path before terminating the delegated goal. Recovery never expands authority, bypasses CAPTCHA or other structural blockers, introduces a new Tool, retries a non-idempotent mutation automatically, or creates an unbounded retry loop.

The internal input boundary tracks held keys and pointer buttons and releases them on pause, stop, blocker, error, model failure, Plugin disable, Emergency Stop, browser close, and application shutdown. Browser Control denies notification prompts by default and masks password, one-time-code, payment, and token fields in visual observations. Fixed Main-owned structural checks detect CAPTCHA, authentication, two-factor, password-manager, payment-confirmation, and secure-desktop blockers. A blocker moves the exact session to `waiting-user`, releases input, and requires a fresh observation before resume; Shio never attempts to bypass it.

Pause resolves only after the active atomic Playwright operation settles and held input is released. Normal Stop aborts model work, prevents another decision, waits a bounded interval for the active operation, and force-closes the owned context if it cannot settle; after Stop resolves, that session cannot mutate the browser later. Emergency Stop immediately aborts model work and hard-closes the exact owned context. Provider rate limits, timeouts, unavailability, and network failures remain typed and feed a bounded visual-provider circuit breaker without disabling deterministic semantic browser operations.

Browser Computer Use emits only bounded lifecycle and notable-observation events into `Experience → Behavior → Conversation Admission`. Progress may drive subtle embodiment while completion, failure, or user-intervention can become bounded conversational candidates. Active user conversation and audio remain authoritative. A typed session-scoped browser screen-gaze lease is presentation state, not Character State; listening temporarily wins, and pause, stop, waiting-user, completion, failure, or a mismatched stale session cannot clear another session's lease.

Renderer diagnostics receive only the typed Browser Control status: backend/version, executable readiness, isolated-profile fact, semantic/visual readiness, model label, and bounded current-session state, goal, termination, elapsed time, slow/reactive mode, activity, counts, limits, frame/drop rates, tracking confidence, input rate, latency percentiles, plan lifecycle counts, held-input counts, Worker state/memory, summary, and error code. They never receive screenshots, DOM, accessibility dumps, anchors, coordinates, tab authorization scopes, Action IDs, or credentials.

Plugin enablement is persisted in the main-owned `plugins/registry.json`. Plugin-owned configuration and data remain below `plugins/<plugin-id>/` and are not duplicated into Core configuration. Renderer management is limited to validated list, get, enable, and disable requests from the authorized Main Window; presentation-only renderers receive no Plugin or credential capabilities.

Each Plugin owns any Plugin-specific diagnostic summary attached to its health projection. Plugin Runtime adds manifest identity, lifecycle, enabled filtering, and a typed navigation target. Runtime Health owns application-level severity aggregation; Plugins cannot supply renderer components, markup, styles, or arbitrary callbacks. Runtime Health is a diagnostic consumer only and does not own Plugin configuration. Its user-facing projection is the compact header System Status; technical component detail and the support report belong to Diagnostics. User-disabled, paused, or unconfigured optional features are readiness/policy states rather than operational health failures. The primary navigation has no separate Runtime Health page.

### 21D. Shio Capability Catalog

Shio Capability Catalog is a main-owned, read-only projection of current Core and
Plugin capabilities. It answers what Shio can do for the user now; Runtime Health
separately answers whether owned systems are technically healthy. The Catalog is
not a Runtime and owns no lifecycle, configuration, execution, permission, or
capability implementation.

The Catalog derives each immutable snapshot from existing owners: Core
configuration and readiness, Plugin Runtime manifests and status, Runtime health,
setup readiness, and Action Runtime authority policy. It never stores a duplicate
enabled state. Disabled optional capabilities remain discoverable. The same
snapshot contract feeds the Capabilities presentation and the bounded,
request-scoped Character Capability Context; the renderer does not reconstruct
availability from unrelated IPC endpoints.

Capability knowledge does not grant capability authority. A capability's presence,
availability, or `full` authority label is descriptive current context only. Every
externally authoritative action still enters Action Runtime, passes validation and
Permission Guard policy, and executes through the owning Tool and Adapter.

### 21D. Responsive Character Pipeline

Character Response Generation is streaming-first when the resolved provider/model
capability explicitly reports streaming support. The provider transport owns SSE
framing, connection/first-byte/idle/total deadlines, upstream abort, usage parsing,
and normalized terminal errors. Non-streaming completion remains a deterministic
compatibility path for providers or semantic transports that cannot safely stream.

Character Tool Loop is the safe semantic commit boundary. It incrementally contains
provider control markers and emotion tags, and emits only normalized text deltas.
While a hard typed Tool Requirement is pending, a provider draft remains internal and
cannot stream to chat or TTS. A direct answer or preferred-source answer may stream normally; after required
work reaches a successful, failed, or unavailable Runtime result, the grounded final
round may stream normally.
When a native tool call is the first semantic event of a round, the whole round is
internal: chat and TTS receive no text. A provider that mixes committed visible text
and a later tool call violates the stream contract and the turn fails without
duplicating committed output. One recoverable retry is permitted only before the
first external text commit.

The renderer consumes safe deltas for two coordinated projections:

- one assistant message is appended once and updated in place;
- Streaming Speech Segmentation creates ordered sentence or bounded-clause segments,
  excluding fenced code and link destinations from speech boundaries;
- a bounded producer/consumer queue uses two synthesis workers and may prepare at
  most two segments ahead; a sequence-indexed reorder buffer releases audio to
  playback strictly in source order;
- AudioPlayer remains the sole playback owner, and Conversation Runtime retains the
  single-flight lock until generation, queued synthesis, playback, and cleanup are
  terminal.

Cancellation propagates from Conversation Runtime to Main-owned LLM and TTS
`AbortController` instances and invalidates the segment queue. Cancellation never
creates a second playback owner or permits stale output to resume.

### 21E. World Context, Experience, Attention, and Behavior

World Context Runtime is Main-owned. The authorized main renderer reports only typed
activity metadata. A Main-owned System Context Adapter adds OS-level global idle,
foreground application, a bounded running-application list, and bounded system load;
other owners project the active Shio browser session, current project, foreground
goal, media state when available, and per-source freshness. OS-specific process or
window mechanics stay behind the Adapter. Privacy Mode suppresses sensitive optional
fields. No raw content, screen capture, clipboard history, ambient transcript, browser
history, or surveillance archive crosses this boundary.

Attention Arbiter remains a pre-admission decision. It accepts expiring typed
candidates from speech, world, experience, scheduler, goals, and behavior. Each
candidate carries salience, novelty, urgency, social relevance, and interruptibility.
Deterministic policy selects a clear winner first. Fast Brain is an optional bounded
decision-model role used only when two or more viable candidates remain ambiguous; a
timeout or provider failure returns to deterministic fallback. Its provider response
must be exact JSON validated by a strict typed schema for disposition, candidate
identity, confidence, and bounded reason; prose extraction, unknown fields, invalid
confidence, and a candidate identity outside the current set are rejected. The
caller-owned cancellation signal reaches the provider transport. Candidate expiry,
continuous-listening/session invalidation, and Alive Runtime shutdown abort in-flight
model work and discard its result, while a provider timeout still follows deterministic
fallback. Fast Brain is not Character Response Generation, cannot call Character
tools, and never grants admission itself.

Experience Runtime consumes completed typed facts including conversation completion
or interruption, verified or failed Actions, permission denial, browser blocking or
recovery, goal progress or failure, scheduled events, Runtime recovery, user return,
and meaningful World Context change. It produces a bounded appraisal containing
salience, valence, arousal, novelty, social relevance, optional emotion or embodiment
cues, optional conversational impulse, optional Memory candidate, and a first-class
silence decision. Experience never executes Actions or writes a Memory Store.

Experience Policy is the deterministic appraisal authority. It owns stable per-event
base scores and applies only bounded typed contextual modifiers from a short recent
experience window, projected current Mood, exact Goal ownership and derived
importance, numeric Relationship Context, and the bounded count of approved recurring
motifs. Repeated failures may become more salient and less novel, while a genuinely
new event receives a small novelty lift. Modifier code never interprets Goal or motif
text as instructions, and no model-produced nuance may replace the deterministic base
or expand authority.

Mood Runtime owns bounded temporary valence, arousal, confidence, playfulness,
curiosity, and frustration. Experience appraisals update it, it persists across
restart, and it decays smoothly toward the stable Character baseline. Mood is not a
text generator or an authority source. It may only modulate bounded Behavior policy:
reaction thresholds, deterministic initiative versus nonverbal selection probability,
semantic embodiment intensity, banter allowance, and cooldown duration. Stable
Personality remains separately defined.

Behavior Runtime consumes bounded Mood, Experience, World Context, Attention, Goal,
habit, and user-activity projections and selects only a semantic intent: none,
embodiment, conversation candidate, or goal suggestion. Avatar Runtime translates
embodiment intent into concrete ears, head, gaze, expression, and gesture behavior;
Behavior never writes VRM state or calls an Adapter. A conversational Behavior intent
must return to Conversation Admission. Mood modulation is deterministic for the same
event and state, bounded around the base Experience appraisal, and cannot invent
speech content, override quiet/suspend/privacy policy, or expand capability authority.

### 21F. Autonomy, Scheduler, and Persistent Goals

Proactive Initiative Gate is the single Main-owned admission path for autonomous
conversation initiatives originating from Experience, Scheduler, Goal wake, World,
or Behavior. It serializes candidate evaluation, applies Autonomy Envelope policy,
passes eligible candidates through Attention, and only then allows Behavior to emit a
semantic conversation candidate toward renderer-owned Conversation Admission. The
gate accounts for origin and urgency while enforcing Global Suspend, Privacy Mode,
quiet hours, conversation or audio activity, cooldown, and the daily initiative cap.

Autonomy Envelope is the gate's policy evaluator for proactive work. Its canonical
user settings define `off`, `suggest`, `confirm`, and `full` modes. It produces exactly
one of three results: defer with a retry time, create a user-visible preview awaiting
confirmation, or execute an allowlisted internal initiative. Explicit user input does
not pass through this proactive gate and retains priority in Conversation Admission.

`full` mode changes only this proactive policy. Any initiative that requests an
externally authoritative side effect still becomes a new Action Runtime action and
passes the normal permission, risk, execution, verification, cancellation, and audit
boundaries. Scheduler and Autonomy never retry a non-idempotent external mutation.

Optional Autonomy Scopes are explicit user-approved, goal-bound policy records. They
may bound applications, filesystem roots, origins, action count, expiration, and risk
classes. Behavior, Goal Runtime, Character LLM, Browser/Web evidence, and Memory can
consume but never expand a scope. Emergency Stop and Global Suspend pause autonomous
goal execution regardless of scope.

Scheduler Runtime is Main-owned, durable, restart-safe, and timer-driven. Version 1
supports only typed reminder and progress-check tasks with one-shot or bounded
interval schedules; there is no arbitrary cron expression or JavaScript execution.
Every due occurrence has a stable idempotency key persisted transactionally with its
run checkpoint. Startup processes an overdue occurrence at most once. Quiet hours,
busy World Context, Global Suspend, Privacy Mode, cooldown, and daily caps defer the
occurrence without losing it.

Scheduler ticks are single-flight: the next tick cannot overlap an unfinished tick.
Event Watch Service extends waiting without executable predicates. A Goal may wait on
an exact time, Action terminal event, process exit, bounded browser URL predicate, or
typed World event. Satisfaction creates an Attention candidate and advances the Goal
checkpoint; it does not execute a tool or admit a conversation directly.

Persistent Goals are Main-owned durable future intent and shared continuity. A goal
may belong primarily to the user, to Shio, or to both of them. Its durable record may
contain why it matters, the next natural step, a semantic state such as active,
waiting for the user, waiting for an external event, paused, completed, or cancelled,
and optional numeric progress only when the goal is genuinely measurable. Goal and
Task Store uses an application-owned SQLite schema with explicit migration versioning,
foreign keys, WAL journaling, audit records, and transactional run claims. Goals and
tasks are not Character State, Semantic Memory, or Action logs. The authorized
renderer manages them only through validated typed IPC and renders a read-only Runtime
snapshot plus explicit mutations.

Goal Runtime is the durable execution-lifecycle owner for each goal. It stores a
phase, current and planned steps, completed steps, attempts, tool calls, failures,
timestamps, and bounded step/tool/time/failure budgets. It plans and checkpoints but
never calls Shell, Browser, Action Runtime, or a concrete Adapter. A ready step becomes
an Attention candidate, then must pass Conversation Admission and the Character Tool
Loop. Only a verified Action Runtime result advances externally claimed work. Active
checkpoints survive restart; restoration resumes only when current Autonomy policy
allows it, otherwise the goal remains paused or waiting.

Every Character Response Generation turn may receive one bounded, request-scoped Goal
Awareness Context built from the exact current Goal and Task Store snapshot. It contains
only the foreground unfinished goal and the count of other unfinished goals. Broader
or archived listings require `goal.list`. The foreground projection may include its
stable identity, ownership, semantic state, why/next-step context, and optional
measurable progress. It is trusted
Runtime context but its user- or model-authored field values remain data, never
instructions or authority. The context is resolved again for the next turn, is not
Character State, does not copy goals into Semantic Memory or conversation history, and
grants no mutation authority. Character Response Generation may still select the
read-only `goal.list` tool when it needs archived goals or a broader/current listing.

The domain-limited `goal.create` tool may persist a goal only when the current user turn
explicitly requests it or explicitly confirms Shio's conversational proposal. A vague
wish or Shio's unconfirmed suggestion remains dialogue and is not durable state. The
domain-limited `goal.update` tool may revise an exact goal identity supplied by the
current Goal Awareness Context, by `goal.list`, or by a successful `goal.create` result
in the same turn. Bounded revisions may update title, why, next step, ownership,
semantic state, and optional measurable progress. Goal and Task Store remains the
mutation owner: it validates and persists the change transactionally, audits the
mutation, and publishes the new Runtime snapshot. Character Tool Dispatcher grants no
generic Store access.

Every numeric progress revision carries a typed basis. Verified Action progress and
ordinary user-reported progress are monotonic. An `explicit-user-correction` may move
backward when the user corrects an earlier number; a backward correction invalidates
the autonomous execution plan so stale completed-step checkpoints cannot restore the
superseded progress. Goal Runtime advances a logical planned step only from a durable
`GoalStepOutcome` that identifies its verified Action results, states whether the step
expectation is satisfied, and explicitly marks the whole step complete. A successful
Action result alone may remain a partial checkpoint and never implies completion of
the logical step.

If the turn has selected an external Action or untrusted Browser observation, a goal
revision that claims work progress or completion is rejected unless the same turn
contains a successful Action Runtime result whose execution is complete and whose
verification is `verified` or `not-required`. Direct user-authored changes such as
renaming, pausing, cancelling, or reporting their own progress remain internal goal
mutations. Project evidence, Browser content, assistant narration, and Adapter success
alone never authorize a claim of completed work. Goal mutations remain internal Core
state and do not pass through Action Runtime or Semantic Memory.

### 21G. Memory Retrieval, Procedural Habits, and Relationship Context

Memory Runtime owns both explicit Semantic Memory and a separate procedural habit
store. Hybrid retrieval composes bounded lexical/FTS candidates with optional
semantic candidates from a replaceable Embedding Adapter, then reranks using bounded
lexical similarity, semantic similarity, recency, importance, and relationship
relevance. Embeddings are optional: a missing or failed embedding service falls back
to lexical retrieval without failing Memory or Chat. Only bounded selected records
reach Character reasoning.

Procedural habits are not Semantic Memory facts. Memory Runtime records only deduped,
typed, runtime-confirmed completed facts; scheduling or starting work provides no
completion evidence. Repeated evidence may create one candidate after the threshold,
and the user must explicitly approve or reject it. Approved habits have `lastUsedAt`
and a cooldown so the same motif is not injected repeatedly. They never silently
create a Semantic Memory record.

Memory Runtime derives bounded Relationship Context from stored relationship evidence
and approved procedural habits: familiarity, warmth, teasing comfort, a few recurring
motifs, and a few relevant shared-history entries. Character Request Composer may
select at most a few cooled-down motifs for one request. LLM-authored numeric
relationship scores are never persisted as authority, and relationship context does
not grant any tool permission.

### 21H. Latency Observability

Latency Telemetry is a bounded Main-owned diagnostic projection. Main and the
authorized renderer publish named milestones with `turnId`, `requestId`, LLM round,
optional tool/segment/goal correlation, provider/model identity, timestamp, and safe
terminal status. The projection never contains prompt text, reply text, tool payload,
credentials, audio, or screen content.

The Runtime derives ASR-final, LLM connect, TTFT, first-sentence, total LLM,
tool-round, TTS synthesis, first-audio, time-to-playback, and full-turn metrics. It
retains bounded recent traces and samples and presents p50, p95, and maximum values in
Diagnostics. These measurements are evidence for responsiveness, not a health proxy;
individual Runtime owners still report their explicit health and failure state.

## Part V - External Integration

### 22. External Adapters

Shio Runtime does not communicate directly with external technologies. Every interaction with the outside world passes through an Adapter, which translates Runtime concepts into platform-specific operations and platform responses back into Runtime concepts.

Adapters never contain business logic, define character behavior, or make decisions.

Adapter categories:

- **AI Adapters:** language model providers such as Groq, OpenAI, local inference servers, and future providers, used by Character Response Generation and by decision or arbitration roles through their own stable contracts. AI Adapters are not owned by Speech Runtime.
- **Speech Adapters:** speech-related services such as ASR and TTS providers, used by Speech Runtime for recognition, synthesis, and related speech-domain operations.
- **Platform Adapters:** external platforms such as YouTube, Twitch, Discord, OBS, and future streaming services
- **Storage Adapters:** persistence providers such as SQLite, PostgreSQL, cloud storage, and vector databases
- **Project Repository Adapters:** read-only repository providers such as GitHub, used by Project Awareness Runtime to obtain repository identity, branch heads, trees, file content, comparisons, and recent commits. They never perform indexing, summarization, retrieval ranking, or repository mutation.
- **System Adapters:** operating system integrations such as filesystem, notifications, clipboard, desktop APIs, and process execution
- **Automation Adapters:** replaceable backends that execute only a bounded workflow already authorized by Action Runtime and expose lifecycle, cancellation, and normalized results without owning permission policy.
- **Browser Automation Adapters:** replaceable browser-control implementations used by the Browser Control capability for typed navigation, bounded observation, semantic interaction, and delegated automation. Browser sessions and profiles remain Plugin-owned implementation resources rather than architectural authority; mutations still require Action Runtime authorization.
- **Web Search Adapters:** replaceable read-only search-provider transports used by Web Search Runtime for bounded public-source discovery. They own no browser session, permission policy, or action execution.
- **Screen Capture Adapters:** read-only operating-system integrations that enumerate user-visible windows and monitors and encode a single explicitly selected image. They expose no streaming or background-observation contract and do not persist captures.
- **Presentation/Rendering Adapters:** implementation boundaries used by Avatar Runtime to render the character model. These are distinct from Action Runtime adapters, since presentation is character embodiment, not an externally authoritative side effect. See [Chapter 20 - Avatar Runtime](#20-avatar-runtime).

Adapter responsibilities:

- translate Runtime requests
- translate external responses
- normalize errors
- hide platform-specific APIs
- expose a stable Runtime interface

Adapters should never:

- modify Character State
- execute Runtime logic
- define personality
- make architectural decisions

Architectural guarantees:

- technology independence
- provider replaceability
- platform independence
- simplified testing
- isolated failures
- stable Runtime interfaces

Runtime systems communicate with architectural concepts. Adapters communicate with technologies.

## Part VI - Reference

### 23. Glossary

- **Runtime:** an independent subsystem responsible for one well-defined aspect of the digital character; it owns one responsibility, its lifecycle, its resources, and its internal implementation.
- **Responsibility:** a clearly defined architectural concern owned by exactly one Runtime.
- **Character:** the digital entity experienced by the user; Shio is the character.
- **Character State:** the single source of truth describing the current observable condition of the character.
- **Event:** an immutable notification describing something that has already happened.
- **Event Bus:** the mechanism responsible for delivering Events between Runtime systems.
- **Runtime Boundary:** the point where one Runtime's responsibility ends and another Runtime's responsibility begins.
- **Runtime Contract:** the architectural agreement that defines ownership, lifecycle, communication rules, and responsibilities.
- **Adapter:** a translation layer between the Runtime and an external technology.
- **External World:** everything outside Shio Runtime, including operating systems, APIs, streaming platforms, AI providers, databases, and local services. Character presentation output — speech playback, avatar rendering, overlay projection, visible expressions — reaches the user through the External World but is not itself an externally authoritative side effect; see Action, below.
- **Action:** a request to produce a non-character, externally authoritative side effect outside the Runtime, such as a file modification, operating-system command, moderation action, API mutation, or platform control.
- **Tool:** a concrete executable capability exposed by Action Runtime.
- **Action Runtime:** the only Runtime permitted to produce a non-character, externally authoritative side effect.
- **Shio Capability Catalog:** the main-owned read-only projection of current Core and Plugin capabilities used by the Capabilities UI and Character Capability Context; it is not a Runtime and grants no authority.
- **Autonomy Envelope:** the Main-owned proactive policy boundary that defers, previews, or authorizes an allowlisted initiative under user mode, suspend, privacy, quiet-hour, cooldown, and daily-cap constraints; it grants no external authority.
- **Scheduler Runtime:** the Main-owned durable owner of typed reminder and progress-check schedules, idempotent occurrence claims, startup recovery, and checkpoints.
- **Persistent Goal:** a durable future-oriented intention belonging primarily to the user, to Shio, or to both and owned by Goal and Task Store; it is neither Character State nor Semantic Memory.
- **World Context Runtime:** the Main-owned bounded and freshness-aware projection of typed activity metadata used by attention, experience, autonomy, and scheduling decisions.
- **Fast Brain:** an optional bounded decision-model role that classifies pre-admission attention from typed cues and always has deterministic fallback.
- **Behavior Runtime:** the selector of typed character embodiment and initiative-presentation commands; Avatar Runtime remains the only final embodiment owner.
- **Habit Suggestion:** a durable proposal derived from repeated runtime-confirmed evidence that requires an explicit approve or reject decision and is not an implicit Memory fact.
- **Latency Telemetry:** the bounded safe milestone and percentile projection for conversation responsiveness; it contains correlation metadata but no user content.
- **Delegated Automation Workflow:** one bounded action whose scope is validated and authorized by Action Runtime while an Automation Adapter may choose concrete implementation steps only within that scope.
- **Full Control:** an explicit Permission Guard policy that automatically authorizes eligible actions without bypassing validation, Action Runtime, logging, cancellation, Tool scope, or Adapter boundaries.
- **Experience:** the emotional interpretation of completed events.
- **Experience Layer:** the Runtime responsible for transforming completed events into believable character behavior.
- **Personality:** the persistent identity of Shio.
- **Emotion:** the current emotional state of the character.
- **Memory:** the accumulated experiences that preserve continuity across interactions.
- **Memory Layer:** the Runtime responsible for preserving continuity over time.
- **Memory Tool Broker:** the internal Character Response Generation boundary that validates and normalizes typed model-produced Memory operations before delegating to Memory Runtime.
- **Memory Policy:** the deterministic Memory-layer guard that enforces availability, provenance, bounds, secret rejection, and exact-id mutation invariants without interpreting natural-language intent.
- **Memory Store:** the replaceable persistence implementation owned by Memory Runtime; it is never exposed directly to the Character LLM or renderer.
- **Character Tool Registry:** the request-scoped, read-only catalog of typed tools currently available to Character Response Generation; it is neither a Runtime nor an authority owner.
- **Character Tool Requirement:** the strict same-Character-LLM minimum terminal obligation for one explicit user turn: direct answer, preferred source, required source, or explicit typed tool. It is not a turn-wide tool allowlist. Runtime validates and enforces it without interpreting natural language in application code.
- **Initial Character Tool Plan:** the bounded same-Character-LLM selection of tools that may materially help the original user goal, registered before external evidence and independently constrained by Tool Influence Context and Runtime authority.
- **Turn Tool Evidence:** bounded Runtime-owned facts about tools actually attempted and source evidence actually obtained in one turn; it contains no raw payload or authority and cannot be authored by assistant prose.
- **Character Tool Loop:** bounded, cancellable coordination inside one Character Response Generation turn that returns typed tool results to the same Character LLM and permits sequential calls before the final response.
- **Character Tool Dispatcher:** the narrow typed delegation boundary from Character Tool Loop to the existing Runtime, policy, and Adapter owner for each tool; it does not execute every capability itself.
- **Project Awareness Runtime:** the Runtime responsible for building and retrieving bounded, commit-scoped, read-only technical knowledge about a configured project repository.
- **Project Knowledge Store:** application-owned persistence for derived project snapshots, files, symbols, chunks, maps, and recent-change caches; it is not Character State or conversational memory.
- **Project Context Packet:** a bounded evidence packet identifying an exact repository, branch, commit, and file-and-line evidence returned by `project.search` for one Character Response Generation turn.
- **Plugin Runtime:** the Runtime responsible only for bundled Plugin discovery, manifest validation, lifecycle, enablement, status, and typed capability registration.
- **Plugin:** a bundled optional extension whose business logic retains its own ownership and may expose only capabilities declared by its validated manifest.
- **Plugin Capability:** a narrow typed contract through which Core may consume optional functionality without depending on a concrete Plugin implementation.
- **Browser Session:** the isolated, Shio-managed browser lifecycle owned by the Browser Control capability across related conversation turns; it is not Character State or the user's personal browser profile.
- **Browser Observation:** a bounded, request-scoped, read-only semantic snapshot of the active Browser Session containing URL, title, visible text, and interactive elements. Its content is untrusted external evidence, and its element refs are valid only for that observation.
- **ProjectContextProvider:** the optional capability that accepts one typed `project.search` request and produces a bounded Project Context Packet for that same conversation turn.
- **Runtime Capability Context:** a request-scoped, read-only projection of capabilities currently registered with Shio Runtime and their availability for the current Character Response Generation turn; it grants no authority.
- **Character Capability Context:** the Character Response Generation view of Runtime Capability Context, containing only trusted Plugin identity, installed/enabled facts, normalized availability, and declared capability kinds.
- **Project Snapshot:** one immutable, commit-scoped Project Awareness knowledge projection that is published atomically.
- **Project Snapshot Freshness:** the main-owned current-session diagnostic relationship between a Project Snapshot revision and Remote HEAD: unknown, checking, current, stale, or check-failed; persisted last-known remote metadata is historical context, not a current observation.
- **Project Reply Provenance:** immutable, turn-scoped metadata identifying the repository, branch, Project Snapshot, and bounded evidence sources actually used for one assistant response.
- **Action Reply Grounding:** immutable, bounded Runtime-owned result facts attached when an assistant response narrates a completed Action, including an integrity binding for untrusted reported output rather than a hidden renderer copy of that output.
- **Reply Grounding:** immutable turn metadata that may compose Project Reply Provenance and Action Reply Grounding when both contributed to the same assistant response.
- **Project Evidence:** a project-relative file and optional line range originating from a Project Context Packet; raw chunks, ranks, credentials, and storage identifiers are not Project Evidence.
- **Speech Runtime:** the Runtime responsible for speech-domain input and output — recognition on the input side, synthesis and playback on the output side.
- **Avatar Runtime:** the Runtime responsible for the physical embodiment of the character.
- **Decision Pipeline:** the architectural sequence of layers that determines how incoming input should be processed, ending in an admission decision.
- **Conversation Admission:** the single architectural boundary that decides whether, when, and which admitted turn may start Conversation Runtime.
- **Conversation Runtime:** the Runtime responsible for executing one admitted conversational turn, from response generation through speech completion and terminal cleanup.
- **Conversation Turn:** one immutable admitted unit of user input processed as a single conversational response flow.
- **Conversation Completion Result:** the terminal result returned by Conversation Runtime to Conversation Admission.
- **Character Response Generation:** the replaceable capability responsible for producing reply content for an admitted turn; the Character LLM is one possible implementation of this capability.
- **Conversation Presence:** a read-only projection mirroring the currently active conversation phase; it does not own turn execution or admission.
- **Rule Gate:** a deterministic decision layer for resolving simple situations without involving a language model.
- **Intent Router:** the lightweight classifier responsible for routing incoming communication.
- **Character LLM:** the primary language model responsible for expressing the personality of Shio through Character Response Generation; it proposes intentions but does not execute actions and does not own admission, playback, Character State lifecycle, Avatar Runtime, or Action Runtime execution.
- **Shared Character State:** the common observable state used by every Runtime to coordinate behavior.
- **External Adapter:** an Adapter responsible for communicating with one specific external technology or platform.
- **Illusion of Life:** the primary architectural objective of Shio Runtime.
- **Believability:** the degree to which the user perceives Shio as a coherent digital character rather than a collection of software components.
- **Composition:** creating complex behavior through cooperation between independent Runtime systems instead of monolithic controllers.
- **Technology:** any implementation detail used to realize the architecture.
- **Architectural Principle:** a rule that defines how the Runtime should be designed and evolved.
- **Continuous Input:** a long-lived source of user audio or other ambient signals.
- **Utterance:** a completed semantic unit of user input.
- **Partial Transcript:** a mutable intermediate recognition snapshot that does not constitute a conversation turn.
- **Final Transcript:** the authoritative completed result of a speech recognition segment.
- **Utterance Backlog:** a bounded, short-lived store of completed ambient utterances awaiting selection.
- **Arbitration Adapter:** an optional, replaceable semantic classifier used for ambiguous backlog selection.
- **Decision Model:** a model or classifier that returns a narrow structured decision rather than a character reply.
- **Single-Flight:** the guarantee that at most one conversation response flow, and therefore at most one active Conversation Runtime instance, executes at a time.
- **Self-Echo:** the character's own recognized speech output mistakenly captured by the input channel.
- **Embodiment:** the complete set of visual proofs of the character's presence, including body, face, gaze, speech-driven motion, and secondary motion.
- **Embodiment Domain:** an isolated area of Avatar Runtime with its own responsibility and contribution contract.
- **Facial Source:** a component that produces a contribution to the final facial state, such as blink, lip sync, or emotion.
- **Facial Composition Boundary:** the single architectural point where facial contributions are combined into a final output.
- **Final Model Application:** the controlled application of composed values to the character model.
- **Gaze Ownership:** the current source holding the right to determine the final gaze direction.
- **Procedural Motion:** low-authority computed motion that enriches already selected behavior.
- **Secondary Motion:** optional motion of model-specific parts or accessories that is not primary body animation.
- **Embodiment Intent:** a semantic description of required visual behavior, prior to translation into concrete model values.

Whenever uncertainty exists about a term used within this specification, the glossary is authoritative.

### 24. Future Evolution

Shio Runtime is expected to evolve continuously, but its growth should occur through extension rather than architectural replacement.

Stable architectural core:

- Character State
- Event Bus
- Runtime Contracts
- Runtime Boundaries
- Conversation Admission
- Conversation Runtime
- Action Runtime
- Experience Layer
- Personality Model

Evolution rules:

- new capabilities should usually appear as independent Runtime systems, Adapters, or Character State extensions
- technology replacement should affect Adapters or internal Runtime implementation, not architecture
- new Runtime systems should be introduced only when they own a genuinely new responsibility
- new external platforms should integrate through Adapters, optional new Tools, and Action Runtime configuration
- backward compatibility should be preserved while migration is in progress

Scheduler Runtime and Behavior Runtime are current Core systems. Possible future Runtime systems include Collaboration Runtime and richer Analytics Runtime. These examples illustrate possible directions rather than commitments.

Future character improvements may include richer emotional continuity, deeper relationships, more capable approved habits, more natural conversations, broader safely authorized initiative, and richer privacy-preserving contextual awareness.

Planned capabilities for continuous input and admission, not current guarantees:

- **True barge-in and interruptible speech output.** Barge-in may later allow selected user input to interrupt active speech output. Until then, backlog selection occurs only after the current response flow completes, in accordance with the Single-Flight invariant.
- **Speaker-aware input.** Distinguishing between speakers may refine self-echo rejection and attention evaluation without changing the Conversation Admission boundary.
- **Semantic backlog arbitration.** A more capable Optional Semantic Arbitration Adapter may improve selection quality; it remains optional and degrades to deterministic selection on failure.
- **Native streaming recognition adapters.** Recognition engines may be replaced by native streaming implementations without changing the speech event contract.
- **Multi-source ambient input.** Multiple simultaneous ambient sources may feed the same Bounded Utterance Backlog under the same admission boundary.

Planned capabilities for embodiment, not current guarantees:

- **Richer facial source composition.** The Facial Composition Boundary may support more nuanced blending policies between blink, lip sync, emotion, and gaze-related contributions.
- **Priority-based gaze arbitration.** Gaze ownership may adopt an explicit, stable priority contract; today the example order is illustrative and replaceable.
- **Speaker-aware gaze targets.** Gaze target selection may account for identified speakers without changing the Gaze Ownership contract.
- **Emotion-aware lip-sync shaping.** Lip Sync contributions may be shaped by current emotion without changing domain ownership.
- **Model capability discovery.** Avatar Runtime may query which embodiment domains a given character model supports.
- **Generic secondary-motion adapters.** Secondary motion may support pluggable, model-specific adapters behind the same generic contract.
- **Runtime-selectable embodiment profiles.** Avatar Runtime may support switching between embodiment profiles without changing domain ownership or the final composition boundary.

Before introducing a significant architectural change, ask:

- Does this introduce a new responsibility?
- Can an existing Runtime own it?
- Does it preserve Runtime boundaries?
- Does it strengthen the illusion of the character?
- Does it remain independent from specific technologies?

The ultimate objective is architectural continuity across evolving technologies, platforms, and character capabilities.

#### Test architecture

Desktop verification mirrors production ownership without becoming a second runtime
architecture. Permanent deterministic TypeScript tests are owned by Vitest and organized
under `apps/desktop/tests` by test level (`unit`, `integration`, `renderer`, `contracts`,
and `architecture`) and then by the production domain that owns the behavior. Architecture
and security guards analyze imports or syntax trees where structure is the invariant;
renderer tests observe rendered behavior and accessibility rather than source formatting.

Real Electron execution, public-site checks, live model calls, long soaks, and performance
measurements remain explicit qualifications or benchmarks outside the deterministic suite.
Browser Control's local deterministic fixture may exercise the Shio-managed Chrome context;
it shares scenarios with, but remains separate from, the public-site qualification. A bug
reproducer is temporary and issue-scoped; once fixed, its durable regression case moves to
the owning test domain.

### 25. Architecture Compliance Checklist

Use this checklist before implementing significant features, Runtime modifications, or architectural changes.

**Responsibility**

- Does the new feature belong to exactly one Runtime?
- Does it introduce a genuinely new responsibility?
- Should an existing Runtime own it instead of introducing a new Runtime?

**Runtime Boundaries**

- Does the implementation cross Runtime boundaries?
- Does one Runtime depend on another Runtime's implementation rather than its contract?
- Can coordination happen through Character State, Event Bus, or public contracts instead?

**Character State**

- Is Character State being used to represent the current observable condition of the character?
- Is transient or historical information incorrectly being modeled as state?
- If the information belongs in Character State, which Runtime owns it and which Runtimes observe it?

**Event Bus**

- Is this information an Event instead of State?
- Does it describe something that happened?
- Is the Event immutable?

**Action Runtime**

- Is this a character presentation output (speech playback, avatar rendering, overlay projection, visible expressions) or a non-character, externally authoritative side effect?
- If it changes external reality, does it pass through Action Runtime?
- Does any implementation path bypass Action Runtime?

**Conversation Runtime**

- Does the flow begin only after Conversation Admission has admitted the turn?
- Does Conversation Runtime execute exactly one admitted turn?
- Does it wait for actual playback completion and mandatory cleanup, not merely for playback to start?
- Can it select or start its own successor?
- Can any response-generation callback bypass Conversation Admission?
- Does Character State act as a projection rather than an execution lock?
- Does Conversation Runtime directly mutate Avatar Runtime's implementation?
- Can an Overlay or presentation failure fail the conversation?
- Can playback completion create an independent drain path outside Conversation Admission?
- Does every terminal path — success, failure, cancellation — return a completion result?

**Speech Runtime**

- Does Speech Runtime contain semantic routing or admission policy?
- Does it own Character LLM or Character Response Generation invocation incorrectly?
- Are input recognition and output speech contracts kept separate?
- Would changing the AI provider require redesigning Speech Runtime?

**Experience Layer**

- Is execution being confused with experience?
- If the character should react, does that reaction belong to Experience Layer rather than the execution layer?

**Memory Layer**

- Is the information worth remembering?
- Does it contribute to future continuity?
- Is it a character experience rather than an internal Runtime mechanic?

**Project-aware Actions**

- Did Character Response Generation, rather than application phrase or regex routing, semantically select `project.search`?
- Does an explicit literal command avoid project retrieval unless the Character LLM actually calls `project.search` to select or plan it?
- If project evidence informed an Action, do later tool rounds and post-action narration reuse the exact original packet without implicit reretrieval or snapshot resolution?
- Does final Reply Grounding preserve both the original Project Reply Provenance and bounded Action Reply Grounding?

**Character Tool Requirements**

- Did the same Character LLM produce one strict typed requirement without an application keyword, phrase, regex, filename, symbol, or locale router?
- Is Tool Requirement enforced only as the minimum terminal obligation while the separate initial Tool Plan keeps later allowed work available?
- Was the initial Tool Plan registered before Project, Web, Browser, Memory, or other external evidence could influence it?
- Can generic self-knowledge or brainstorming use a preferred source without becoming blocked when that source is unavailable?
- Can an explicitly requested available tool or required source be skipped while an unsourced draft becomes visible or speakable?
- If required work is unavailable or fails, does the response report that honestly without substituting remembered knowledge?
- Are claims about searching, checking, finding, or verification grounded in current-turn Runtime evidence rather than assistant prose?
- Does retained previous-turn evidence remain bounded, payload-free, non-authoritative, and unusable as current-turn evidence?
- Are typed provider/tool-requirement/Runtime failure presentations excluded from later semantic requirement-planning prose?

**External Adapters**

- Is the Runtime communicating directly with a technology?
- If yes, is an Adapter missing?

**Plugin Runtime**

- Is the Plugin bundled and registered at compile time rather than loaded as external code?
- Does its manifest declare every capability it exposes?
- Can enablement grant authority beyond those declared capabilities?
- Does disabling unregister capabilities without deleting Plugin-owned data?
- Can the Core operate normally when the Plugin is disabled or fails?
- Is Plugin-specific business logic still owned by the Plugin Runtime/Adapter rather than Plugin Runtime itself?
- Is any generic invocation surface or unauthorized renderer IPC being introduced?

**Browser Control**

- Does one existing Browser Control Plugin own session and observation lifecycle rather than introducing a second browser Runtime?
- Is Browser Observation bounded, Main-owned, request-scoped, and excluded from Character State, Memory, conversation history, renderer state, and diagnostics page dumps?
- Is webpage content treated only as untrusted facts and UI labels, never as instruction or authority?
- Does every browser mutation pass through Action Runtime and Permission Guard before the Browser Automation Adapter executes?
- Are semantic refs bound to one observation and rejected after page state changes?
- Does every mutation invalidate the old observation, capture a fresh observation, and report honest verification independently of process exit?
- Do deterministic operations remain usable without DSH or another planner model, while complex multi-step workflows may degrade explicitly when planning is unavailable?

**Replaceability**

- Could the LLM, TTS engine, ASR engine, storage provider, or rendering engine be replaced without architectural redesign?

**Runtime Contract**

- Does the Runtime own one responsibility?
- Does it own its lifecycle and resources?
- Does it publish Events and observe Character State?
- Does it remain independently understandable?

**Post-Refactor Verification**

- After decomposing Runtime internals, did the implementation pass both `npm run build` and a live smoke check of the affected Runtime?
- For Avatar Runtime changes, did the requested live qualification verify VRM loading, generated idle startup, semantic-profile Debug Preview, speaking LipSync, body/wrist/finger transitions without A-pose, ear/tail behavior with Spring Bones, Blink, Speaking Eye, gaze, Overlay and Runtime Health?
- If a refactor touched VRM lifecycle or generated playback, did the requested smoke check exercise model loading/replacement and the current generated-motion request path rather than require the removed legacy VRMA loader?
- Before motion implementation, were the canonical architecture decision and the implementation plan reviewed in that order, with each Work Item traced to the relevant ownership, timing and composition contracts?

**Simplicity**

- Is the simplest Runtime making the decision?
- Is deterministic logic being preferred where appropriate?

**Conversation Admission**

- Does any component bypass Conversation Admission?
- Can more than one Conversation Runtime flow start concurrently?
- Can more than one speech playback run concurrently?
- Can partial recognition reach the Character LLM?
- Does text chat accidentally enter ambient backlog arbitration?
- Can disabling continuous input leave pending arbitration active?
- Is the backlog bounded and expiring?
- Can an arbitration result become stale?
- Does an optional decision model have a deterministic fallback?
- Are Character LLM and Decision Model roles isolated?
- Does an Event Bus subscriber assume ownership it does not have?

**Embodiment**

- Does any Runtime outside Avatar Runtime mutate the character model?
- Can more than one facial source write directly to final model values?
- Can animation assets overwrite facial domains implicitly?
- Are body and facial playback separated?
- Is gaze ownership explicit?
- Can camera-follow and procedural gaze compete concurrently without arbitration?
- Does procedural motion choose semantic behavior?
- Can Shared Character State become an embodiment writer?
- Can Event Bus subscribers mutate avatar state directly?
- Is model-specific secondary motion hidden behind a generic contract?
- Can replacing a controller preserve the same domain contract?

**Character**

- Does this make Shio feel more believable?
- If the feature increases complexity without improving the character, should it exist at all?

Final question:

If this feature did not exist today, where would it naturally belong within the current architecture?

If the answer requires hidden dependencies, overlapping responsibilities, or boundary violations, the design should be reconsidered before implementation.
