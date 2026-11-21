# Shio Living Loop 2.0

This is the operational companion to `ARCHITECTURE.md`, which remains the canonical
source of architectural meaning. Living Loop 2.0 closes the typed feedback path from
World Context through Experience, Attention, Behavior, Conversation Admission,
Character tools, verification, and Memory without creating a central brain.

## Runtime ownership

- World Context Runtime owns bounded present-state context. A Main-owned
  `SystemContextAdapter` supplies OS-level global idle, foreground/running application
  metadata, and system load. Privacy Mode suppresses sensitive optional projections.
- Experience Runtime appraises completed typed events and may choose silence. Mood
  Runtime owns bounded persistent mood with baseline decay.
- Attention Arbiter evaluates candidates from speech, world, experience, and behavior. Deterministic policy runs first; Fast Brain is used only for
  ambiguous sets of two or more viable candidates and cannot call tools.
- Behavior Runtime emits only `none`, semantic embodiment, or conversation-candidate intents. Conversation Admission and Avatar Runtime remain the
  execution owners for their domains.
- Conversation Thread Runtime keeps a bounded, expiring record of interrupted topics.
- Memory Runtime owns explicit Semantic Memory, hybrid retrieval, procedural habits,
  and bounded Relationship Context. Embeddings are optional; lexical/FTS retrieval is
  the operational fallback.

## Character and cross-tool flow

`CharacterRequestComposer` applies per-section and total budgets to Persona, Response
Policy, Mood, Relationship, conversational threads, Memory availability, Capabilities, Project, World,
and Tool Results. A normal turn receives compact capability availability, at most one
relevant unfinished thread, and at most a few cooled-down motifs.
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

Autonomy policy, master pause, and Fast Brain controls are in Settings. Habit suggestions are in Memory.

Focused commands:

```text
npm run desktop:test:regression
npm --prefix apps/desktop run test -- mind-layer
npm --prefix apps/desktop run test -- conversation-threads
npm --prefix apps/desktop run test -- prompt-budget
npm --prefix apps/desktop run test -- web-search
npm run desktop:benchmark:latency
```

Desktop Main, preload, renderer, SQLite, browser, and speech changes additionally
require the static Desktop suite and the live Windows qualification described in the
repository agent manual.
