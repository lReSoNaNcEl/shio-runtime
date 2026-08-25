# Shio Living Loop 2.0

This is the operational companion to `ARCHITECTURE.md`, which remains the canonical
source of architectural meaning. Living Loop 2.0 closes the typed feedback path from
World Context through Experience, Attention, Behavior, Conversation Admission,
Character tools, verification, Goals, and Memory without creating a central brain.

## Runtime ownership

- World Context Runtime owns bounded present-state context. A Main-owned
  `SystemContextAdapter` supplies OS-level global idle, foreground/running application
  metadata, and system load. Privacy Mode suppresses sensitive optional projections.
- Experience Runtime appraises completed typed events and may choose silence. Mood
  Runtime owns bounded persistent mood with baseline decay.
- Attention Arbiter evaluates candidates from speech, world, experience, scheduler,
  goals, and behavior. Deterministic policy runs first; Fast Brain is used only for
  ambiguous sets of two or more viable candidates and cannot call tools.
- Behavior Runtime emits only `none`, semantic embodiment, conversation-candidate, or
  goal-suggestion intents. Conversation Admission and Avatar Runtime remain the
  execution owners for their domains.
- Goal Runtime owns durable plans, checkpoints, event waits, and step/tool/time/failure
  budgets. It never executes a concrete tool. Verified Action results are required to
  advance externally claimed work.
- Memory Runtime owns explicit Semantic Memory, hybrid retrieval, procedural habits,
  and bounded Relationship Context. Embeddings are optional; lexical/FTS retrieval is
  the operational fallback.

## Character and cross-tool flow

`CharacterRequestComposer` applies per-section and total budgets to Persona, Response
Policy, Mood, Relationship, Goals, Memory availability, Capabilities, Project, World,
and Tool Results. A normal turn receives compact capability availability, one
foreground goal plus the other-unfinished count, and at most a few cooled-down motifs.
Complete stores are available only through typed tools.

`ToolInfluenceContext` keeps original user intent distinct from evidence. Project,
Browser, Web Search, and Memory data may supply facts but never grant permission. A
cross-tool transition that needs Shell or Memory mutation must already be part of the
original request or an approved scope before untrusted Browser/Web evidence enters the
turn. Shell effective risk is always classified in Main by `ShellRiskPolicy`; the
Character-facing `shell.execute` contract has no risk field.

## Web discovery

`web.search` is read-only source discovery, separate from Browser Control. Web Search
Runtime validates a bounded query, freshness, domain filters, and result count, then
uses a replaceable Web Search Adapter. The bundled adapter reads DuckDuckGo's official
non-JavaScript Lite results and requires no account, token, or renderer configuration.
Responses are size-bounded, parsed as inert HTML data, and reduced to untrusted result
fields. Transport failure remains isolated from Chat and Browser Control. Opening or
interacting with a selected URL remains Browser Control work.

## Scheduler, watches, and scopes

Scheduler ticks are single-flight and due occurrences retain their transactional
idempotency keys. Event Watch Service supports only typed time, Action-terminal,
process-exit, browser-URL, and World-event conditions. No renderer-defined JavaScript,
cron, command, or executable predicate is accepted.

Autonomy Scope is explicit user-approved policy that may bound goal, applications,
filesystem roots, origins, action count, expiration, and risk classes. Behavior, Goal,
LLM, Browser/Web evidence, and Memory cannot expand it. Full Control changes
confirmation policy only; validation, risk classification, Action Runtime, verification,
cancellation, and logging remain mandatory. Global Suspend and Emergency Stop pause
autonomous goal work.

## Procedural continuity

Only deduplicated completed typed facts count as habit evidence. Scheduling or starting
work does not count. Three observations may create one candidate; approval or rejection
is explicit. Approved motifs have `lastUsedAt` cooldown and remain separate from
Semantic Memory facts. Relationship Context is Runtime-derived from bounded evidence;
LLM-authored relationship scores are not persisted.

## Streaming speech and latency

Two bounded synthesis workers may run concurrently. A sequence-indexed reorder buffer
preserves playback order, and cancellation aborts both workers, queued/prepared audio,
and pending playback. The first segment prefers a safe 60–140-character semantic
boundary. Telemetry records TTFT, first sentence, first audio, playback start, full turn,
first-segment size, queue wait, execution, preparation, ready-to-playback delay, and
worker identity without prompt, reply, audio, or credential content.

## UI and validation

The React Spectrum 2 UI separates Goals into Active, Scheduled, and History; Memory
into Facts, Decisions, Memories, and Habits; and Autonomy policy into Settings with a
prominent master pause plus advanced Fast Brain controls. Goal progress shown in the
primary card is Runtime-derived from `GoalExecutionState`; manual completion is an
explicit override.

Focused commands:

```text
npm run desktop:living-loop-hardening:repro
npm run desktop:world-context:repro
npm run desktop:mind-layer:repro
npm run desktop:goal-runtime:repro
npm run desktop:memory-2:repro
npm run desktop:streaming-tts-2:repro
npm run desktop:prompt-budget:repro
npm run desktop:web-search:repro
npm run desktop:latency-benchmark
```

Desktop Main, preload, renderer, SQLite, browser, speech, and goal changes additionally
require the static Desktop suite and the live Windows qualification described in the
repository agent manual.
