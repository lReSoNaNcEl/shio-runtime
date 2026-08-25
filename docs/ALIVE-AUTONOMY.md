# Shio Alive & Autonomous v1

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
- Autonomy Envelope, durable Scheduler, Persistent Goals, and Smart Habit
  suggestions;
- safe correlated latency traces with p50, p95, and maximum summaries;
- a React Spectrum 2 "Between us" UI in Russian and English, with conversational
  intentions, reminders and promises, Autonomy policy in Settings, and habit
  suggestions alongside Memory management.

The API speech service and its HTTP contract are unchanged.

## Ownership and data flow

Electron Main owns SQLite persistence, World Context, Autonomy policy, Scheduler,
Goals, habits, Fast Brain transport, and latency aggregation. Fast Brain can use a
separately selected low-cost provider/model while credentials continue to resolve only
through the existing secure Main credential store. The renderer owns the
single Conversation Admission, Conversation Runtime coordination, and presentation.
It reports only typed activity and experience facts.

Each Character turn receives a bounded Goal Awareness Context built from the exact
current unfinished-goal snapshot. This makes Shio aware of ongoing intentions without
copying them to Semantic Memory, Character State, conversation history, or a static
persona prompt. Goal values remain data rather than instructions, and their presence
does not grant mutation authority or force an unrelated status report.

The Character LLM may use `goal.create` only after an explicit user request or explicit
confirmation of a conversational proposal. It may use the read-only `goal.list` tool
for archived or broader listings. `goal.update` accepts an exact identity from current
awareness, a list result, or a same-turn create result, and can revise ownership, why,
next step, last note, semantic state, or optional measurable progress. Unverified Action
or Browser results cannot claim work progress or completion. Goals remain separate from
Semantic Memory and are never duplicated into Memory records.

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
Durable due task + World Context
  -> Autonomy Envelope
  -> defer | preview/confirmation | allowlisted initiative
  -> typed Behavior presentation or Conversation Admission request
  -> Action Runtime for every external side effect
```

## Autonomy policy

- `off`: no proactive initiative.
- `suggest`: due work becomes a visible preview awaiting confirmation.
- `confirm`: due work requires explicit approval before execution.
- `full`: typed internal reminders/check-ins may execute automatically after all
  policy checks. External side effects still require Action Runtime policy.
- Global Suspend stops all initiatives, including previously previewed tasks.
- Privacy Mode disables optional Fast Brain model calls and proactive initiatives.
- Quiet hours, conversation/audio activity, cooldown, and the daily cap defer rather
  than drop work.

Fast Brain is the optional AI attention filter for continuous listening. It evaluates
one recognized utterance before a response starts and decides whether Shio should
react. It is separate from Smart next-reply selection, which operates only after
multiple utterances have accumulated while another response was busy and chooses or
merges the next buffered utterance. Regular text chat uses neither mechanism.

Scheduler v1 accepts only `reminder` and `check_in`, with a one-shot due time or a
bounded interval. It cannot store or execute cron strings, scripts, commands, paths,
or arbitrary Plugin methods. Each occurrence is transactionally claimed using
`taskId:scheduledAt`, so restart or a repeated tick cannot execute it twice.

## Persistence and migration

The Main process stores `alive/alive.sqlite` below Electron `userData`. Schema v2
uses WAL, foreign keys, `PRAGMA user_version`, transactional migrations, an
idempotent task-run table, and a bounded UI audit query. Goals, tasks, habits, and
audit entries are separate from Character State, semantic Memory, conversation
history, Project Awareness, and Action Runtime logs.

Schema v2 migrates existing goals in place and adds owner, next step, last note, and
the optional measurable-progress flag. Existing title, description, state, progress,
timestamps, task links, and audit records are preserved.

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
- Scheduler failures are surfaced in Alive health and logs; Core conversation,
  Speech, Avatar, Plugins, and Memory remain available.
- An overdue task is processed at most once after restart. Policy-deferred tasks keep
  a future retry time.

## Validation

Focused automated validation:

```text
npm run desktop:alive-autonomy:repro
```

The repro covers normal SSE, upstream first-byte timeout abort, split internal
markers, emotion stripping, sentence/code/link segmentation, tool-round containment,
ordered bounded speech playback, typed Persistent Goal retrieval, SQLite
restart/migration/idempotency, Autonomy
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
5. scheduled preview/approval, Full mode, quiet hours, Privacy Mode, and Global
   Suspend behave as configured;
6. goals/tasks survive application restart without duplicate initiative;
7. Goals & Tasks and Diagnostics render correctly in Russian and English;
8. VRM loading, idle, Speaking, LipSync, Overlay, Runtime Health, and application
   shutdown remain healthy.
