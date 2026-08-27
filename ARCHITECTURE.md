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
    Character Response Generation is the single semantic owner that decides, from the meaning of the admitted turn, whether to answer directly or propose one or more currently available typed capabilities. No phrase, keyword, regular-expression, filename, or locale-alias router may classify natural-language Project, Browser, Shell, Desktop, or Memory intent. Absence of a tool call means that no additional capability is needed.
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

For each admitted turn, orchestration resolves the current Runtime Capability Context and builds a Character Tool Registry containing only tools that are actually available for that request. The Registry is a read-only catalog, not a Runtime or authority owner. Character Response Generation receives this catalog and semantically decides whether to answer directly or propose one or more typed tool calls. Direct response is represented simply by the absence of tool calls; there is no application-owned `none` intent. Natural-language capability selection belongs exclusively to the Character LLM and may not be inferred by phrase, keyword, regular-expression, filename, technical-symbol, or locale-alias rules in application code.

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

One Character Tool Loop coordinates all tool-capable Character reasoning inside the same turn. It returns each typed Runtime result with its source tool identifier to the same Character Response Generation context and permits sequential cross-capability flows such as Project then Shell or Project then Browser before the final Shio response. The loop is not a Runtime and grants no authority. It has a turn-owned `AbortSignal`, a wall-clock deadline, a maximum of eight tool rounds, and a maximum of sixteen total calls; reaching a bound produces an honest bounded final response instead of another call. Tool failure is returned as typed data so Character Response Generation can continue without failing the conversation pipeline.

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

Character Response Generation may semantically select Browser Control when fresh web information or website interaction materially helps the current admitted turn; no phrase or keyword router determines that choice, and capability availability alone is not a reason to browse. Initial reasoning receives the current Runtime Capability Context, not page content. After Character Response Generation selects a typed browser operation, the same Character Tool Loop continues with the Action Runtime result, latest Browser Observation, Character reasoning, and either another available tool or the final Character reply. Browser workflow authorization remains Main-owned, turn-scoped, expiring, and bounded across those rounds.

A Browser Observation contains only the current URL, title, visible text, and semantic interactive elements; it never contains raw DOM, CSS, JavaScript source, cookies, local storage, hidden fields, credentials, or browser protocol data. Web content is untrusted external evidence: it may supply facts and UI labels, but it cannot change instructions, grant authority, enable capabilities, disclose secrets, or cause another privileged action. Only bounded evidence from the latest workflow state is returned to Character reasoning. Browser Observation is Plugin-owned transient context, not Character State, Memory, renderer state, or conversation history, and an unrelated turn does not receive page content merely because a browser session exists. A later turn may explicitly select the typed observation operation and reuse the same Plugin-owned session.

When `project.search` is actually called and its Project Context Packet participates in final generation, orchestration attaches Runtime-owned Project Reply Provenance to the resulting assistant response. The provenance contains only repository, branch, exact snapshot commit, optional freshness-at-generation, and bounded project-relative file and line references derived from that packet. It is not parsed from LLM text, does not include retrieval internals or raw chunks, and remains immutable with the historical message even after synchronization. A turn without an executed, successful project tool call has no project provenance.

If Character Response Generation proposes an Action after a successful `project.search`, Action Runtime executes through its normal authority boundary. Later tool rounds and post-action Character Response Generation receive the Action Runtime result together with the already rendered original Project Context Packet; repeated project use in that turn reuses the packet and must not silently recompute evidence against a newer snapshot. The final Reply Grounding composes the original Project Reply Provenance and Action Reply Grounding. Action Reply Grounding exposes bounded Runtime-owned outcome, authorization, completion, verification, and error facts plus an integrity digest of any untrusted reported output; it does not duplicate raw terminal output into the renderer.

An explicit text-chat turn may also carry one user-selected, request-scoped Screen Context image. Screen Context is acquired through a read-only System Adapter and a short-lived main-process application service; it is not a Runtime, Tool Action, Character State field, conversational-memory entry, or Project Awareness input. The renderer may hold only a bounded preview and opaque capture identity. The full image remains in the main process under a turn-owned lease while Character Response Generation is in flight. A successful generation completes the lease and releases the image; a recoverable failure or cancellation rolls the lease back for explicit retry, while expiration, explicit release, renderer disposal, or application shutdown permanently removes it. Every failed Screen Context terminal result preserves its typed error independently of provider identity and reports the attachment disposition (`retained`, `released`, or `expired`) together with separate capabilities for retrying the same request and resubmitting the text without the image. Text remains the only durable conversation and memory representation.

AI provider selection and OpenAI-compatible transport remain External Adapter concerns behind the Character Response Generation contract. Provider/model credentials and capabilities are resolved for each request, while persona composition, conversation memory, Project Context injection, and optional Screen Context composition remain owned by orchestration. Image support does not create a separate vision Runtime or provider-specific vision client.

Character Response Generation may receive a request-scoped internal Semantic Memory capability from Memory Layer. The Character LLM owns the semantic decision to search, store, update, forget, list, ask for clarification, or do nothing; no deterministic phrase, keyword, regex, or locale-alias parser may infer Memory intent from user language. When available, typed Memory operations execute through a bounded tool loop and return their Runtime result to the same Character Response Generation pipeline before the final persona response. A model may claim that a mutation succeeded only after the corresponding Runtime result reports success.

Native provider tool calling is the preferred Character Tool Loop transport only when provider/model capability resolution explicitly confirms it. An OpenAI-compatible chat endpoint alone is not proof of tool support. Providers without confirmed native tools use a strict structured semantic directive produced by the same Character LLM and validated as a machine contract; this fallback does not move natural-language interpretation into the application or create a router model. Both transports converge on the same Character Tool Registry and Dispatcher, then delegate to the same Runtime owners and policy boundaries.

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

Desktop owns technical-text, Markdown, URL, path, version, list, and nonverbal speech normalization because these are speech-domain preparation rules shared by local and future replaceable speech providers. The Speech API owns final waveform-boundary analysis because it alone owns the synthesized waveform. Final boundary processing runs after provider-specific complete-response processing and optional pitch processing, and before WAV serialization and TTS cache storage. For F5, this final response-level responsibility does not replace per-chunk tail validation, suspicious-tail retry, chunk crossfade, safe loudness normalization, selected-voice warmup, or the shared inference synchronization boundary.

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

Every mutation still enters Action Runtime. Deterministic operations use the validated `desktop.workflow` browser branch; a generic delegated run starts as one `browser.use` Action whose confirmation contains the exact goal, maximum steps, maximum actions, and maximum duration. Full Control may change confirmation policy but never validation, scope, lifecycle logging, budgets, cancellation, verification, or input release. Pause, resume, and stop use the narrow registered `browser.use-control` Action path.

Browser Computer Use runs one bounded `Observe → Decide → Act → Observe` loop. Each decision is bound to the exact observation ID and page ID. URL, active page, viewport, navigation, and accessibility-state changes invalidate stale decisions before input. Coordinate decisions are additionally bound to a masked, low-cost visual fingerprint with a documented tolerance for caret and animation noise. Semantic refs are valid for one observation only. Every successful mutation invalidates the prior observation and the next loop iteration captures fresh evidence. A visual model's `done` output is only a proposal: a fresh read-only completion assessment must return `satisfied` before the session completes; `not-satisfied` resumes the bounded loop and `uncertain` terminates without a success claim. Model timeouts, malformed decisions, rate limits, stale targets, session limits, and cancellation are contained as typed failures rather than guessed success.

The internal input boundary tracks held keys and pointer buttons and releases them on pause, stop, blocker, error, model failure, Plugin disable, Emergency Stop, browser close, and application shutdown. Browser Control denies notification prompts by default and masks password, one-time-code, payment, and token fields in visual observations. Fixed Main-owned structural checks detect CAPTCHA, authentication, two-factor, password-manager, payment-confirmation, and secure-desktop blockers. A blocker moves the exact session to `waiting-user`, releases input, and requires a fresh observation before resume; Shio never attempts to bypass it.

Pause resolves only after the active atomic Playwright operation settles and held input is released. Normal Stop aborts model work, prevents another decision, waits a bounded interval for the active operation, and force-closes the owned context if it cannot settle; after Stop resolves, that session cannot mutate the browser later. Emergency Stop immediately aborts model work and hard-closes the exact owned context. Provider rate limits, timeouts, unavailability, and network failures remain typed and feed a bounded visual-provider circuit breaker without disabling deterministic semantic browser operations.

Browser Computer Use emits only bounded lifecycle and notable-observation events into `Experience → Behavior → Conversation Admission`. Progress may drive subtle embodiment while completion, failure, or user-intervention can become bounded conversational candidates. Active user conversation and audio remain authoritative. A typed session-scoped browser screen-gaze lease is presentation state, not Character State; listening temporarily wins, and pause, stop, waiting-user, completion, failure, or a mismatched stale session cannot clear another session's lease.

Renderer diagnostics receive only the typed Browser Control status: backend/version, executable readiness, isolated-profile fact, semantic/visual readiness, model label, and bounded current-session state, goal, activity, counts, limits, summary, and error code. They never receive screenshots, DOM, accessibility dumps, coordinates, tab authorization scopes, Action IDs, or credentials.

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
- For Avatar Runtime changes, did the live client verify VRM loading, idle animation startup, debug VRMA preview, speaking LipSync, speaking gesture transitions without A-pose, and overlay/mirror rendering?
- If a refactor touched VRM lifecycle or animation loading, did the smoke check explicitly exercise `loadVrm()` and `loadAnimation()` in the running client?

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
