# AGENTS.md

Developer operating manual for all AI agents working on this monorepository
(GPT, Claude Code, Opus, Codex, or any other AI-assisted development agent).

This document is mandatory reading before any code change. It holds the rules that
apply across the whole repository. Application-specific rules and checks live in the
local files:

- `apps/desktop/CLAUDE.md` — Electron / React / Avatar Runtime.
- `services/api/CLAUDE.md` — Python / FastAPI / ASR / TTS.

## 1. Repository

- `apps/desktop` — Electron, React, TypeScript, Three.js client.
- `services/api` — Python, FastAPI, ASR and TTS service (port `8000`).
- `ARCHITECTURE.md` is the canonical architecture document.

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

Run the checks for the affected application (defined in its local `CLAUDE.md`).

- Desktop changes → the desktop build, typecheck, and applicable repro / smoke tests.
- API changes → import/startup check plus the applicable endpoint checks.
- Cross-boundary changes → validate both applications and run an integration smoke
  test.

If a required check cannot be run, say so explicitly in the final report. A task is
not complete if its required build/checks do not pass.

## 8. Do not hide errors

If something was not checked, say it directly (e.g. "Не проверял live. Проверил только
build.", "Не смог воспроизвести."). Do not pretend a problem is solved only because
compilation passed. Confirm fixes in the live runtime when the bug is runtime-visible.

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
update the corresponding documentation (`ARCHITECTURE.md` and the relevant local
`CLAUDE.md`).

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

## 14. Never Again

Known mistakes and risks — do not repeat them.

- Always reread `ARCHITECTURE.md` before architecture changes.
- After refactoring, do not stop at a passing build; run the required live smoke
  test when runtime behavior is involved.
- Do not move helper methods without checking all call sites.
- Do not change architecture and behavior in the same Work Item.
- When fixing bugs, collect evidence first.
- Do not consider a problem solved only because compilation succeeds.
- Do not silently remove or weaken debug, telemetry, diagnostics, or Runtime Health.
