# Shio Alive & Autonomous v1

> Living Loop 2.0 extends this v1 operational record. See
> [LIVING-LOOP-2.md](./LIVING-LOOP-2.md) for the current World, Experience, Attention,
> conversation threads, procedural Memory, Web Search, and streaming-speech behavior.

This document is the operational guide for the responsive and autonomous Core
implemented by the `Alive & Autonomous v1` work item. `ARCHITECTURE.md` remains the
canonical source of architectural meaning.

## Scope

Version 1 includes:

- safe OpenAI-compatible SSE streaming with connection, first-byte, idle, and total
  deadlines;
- incremental containment of internal Character protocols and emotion markers;
- sentence/clause speech segmentation and a bounded two-audio producer/consumer
  queue;
- Experience events, optional Fast Brain attention, bounded World Context, and
  typed Behavior commands;
- Autonomy Envelope and Smart Habit suggestions;
- safe correlated latency traces with p50, p95, and maximum summaries;
- initiative controls in Settings and habit suggestions in Memory.

The API speech service and its HTTP contract are unchanged.

## Ownership and data flow

Electron Main owns SQLite persistence, World Context, Autonomy policy,
Fast Brain transport, and latency aggregation. Procedural habits are now owned
by Memory Runtime. Fast Brain can use a
separately selected low-cost provider/model while credentials continue to resolve only
through the existing secure Main credential store. The renderer owns the
single Conversation Admission, Conversation Runtime coordination, and presentation.
It reports only typed activity and experience facts.

Character turns may receive one unresolved conversation thread. Substantive interruptions and explicit requests to return to a topic can open a thread. Resolution and expiry remove it from the next turn.

Safe response flow:

```text
Provider SSE
  -> deadline/cancellation transport
  -> Character Tool Loop semantic gate
  -> incremental protocol filter
  -> one in-place chat message
  -> sentence/clause segmenter
  -> bounded TTS queue
  -> AudioPlayer (sole playback owner)
```

Proactive flow:

```text
Experience event and bounded World Context
  -> Proactive Initiative Gate, Autonomy Envelope, and Attention
  -> defer | preview/confirmation | allowlisted initiative
  -> typed Behavior presentation or Conversation Admission request
  -> Action Runtime for every external side effect
```

## Autonomy policy

- `off`: no proactive initiative.
- `suggest`: an eligible initiative becomes a visible preview awaiting confirmation.
- `confirm`: an eligible initiative requires explicit approval before execution.
- `full`: eligible conversational initiatives may enter Conversation Admission after all
  policy checks. External side effects still require Action Runtime policy.
- Global Suspend stops all initiatives, including new conversation candidates.
- Privacy Mode disables optional Fast Brain model calls and proactive initiatives.
- Quiet hours, conversation/audio activity, cooldown, and the daily cap suppress an initiative.

Fast Brain is the optional AI attention filter for continuous listening. It evaluates
one recognized utterance before a response starts and decides whether Shio should
react. It is separate from Smart next-reply selection, which operates only after
multiple utterances have accumulated while another response was busy and chooses or
merges the next buffered utterance. Regular text chat uses neither mechanism.

## Persistence and migration

Electron Main stores autonomy settings, Mood, and audit records in `alive/alive.sqlite` below `userData`. As of schema v6, fresh profiles contain only settings and audit tables. On upgrade, legacy goal and reminder tables are left in place. The application does not read them or schedule their contents. Conversation threads use their own store.

Smart Habits count only typed, runtime-confirmed events. A suggestion appears after
three observations and requires explicit approval or rejection. It never creates a
semantic Memory fact automatically.

## Privacy and diagnostics

World Context contains focus, idle duration, conversation/audio activity,
observation timestamps, policy flags, and freshness only. Latency traces contain
correlation identifiers, milestone names/times, provider/model identity, and safe
status only. Neither surface stores user text, model text, tool payloads, DOM, screen
pixels, audio, repository content, or credentials.

Diagnostics shows recent safe traces and p50/p95/max for ASR-final, LLM connect,
TTFT, first sentence, total LLM, tool rounds, TTS, first audio, playback start, and
full turn when the required milestones exist.

## Failure and recovery policy

- Streaming retries once only before the first externally committed delta.
- A provider mixing committed text and a native tool call fails as a protocol
  violation; the Runtime does not replay duplicate text.
- LLM and TTS cancellation abort upstream work. Queued or prepared speech is
  invalidated and stale playback cannot resume.
- Optional Fast Brain failure falls back to deterministic attention.

## Validation

Focused automated validation:

```text
npm run desktop:test:regression
```

The deterministic suite covers normal SSE, upstream first-byte timeout abort, split internal
markers, emotion stripping, sentence/code/link segmentation, tool-round containment,
ordered bounded speech playback, conversation thread continuity, SQLite
restart and migration, Autonomy
Suspend, habit evidence thresholds, and latency percentile aggregation.

Required Desktop qualification before commit:

```text
npm run desktop:check
npm run desktop:format:check
npm run desktop:imports:check
npm run typecheck
npm run build
```

Because the work changes Electron Main, preload, renderer, SQLite persistence, LLM
transport, and playback coordination, live qualification must additionally verify:

1. text and voice replies update progressively and playback starts before a long
   response completes;
2. a tool round exposes and speaks no internal preamble;
3. manual stop and voice barge-in stop LLM/TTS/playback with no late continuation;
4. TTS outage preserves the complete text response and returns to a stable state;
5. initiative preview, Full mode, quiet hours, Privacy Mode, and Global Suspend behave as configured;
6. conversation threads survive interruption and disappear on resolution or expiry;
7. VRM loading, idle, Speaking, LipSync, Overlay, Runtime Health, and application
   shutdown remain healthy.
