# AGENTS.md

Developer Operating Manual for all AI agents working on this project.

This document is mandatory reading before any code changes by GPT, Claude Code,
Opus, Codex, or any other AI-assisted development agent.

## 1. Architecture First

Before any architecture-related change, reread:

- `ARCHITECTURE.md`

Do not change Memory, Runtime, Avatar Runtime, Speech Runtime, Character State,
Event Bus, Overlay Runtime, or other architecture-level components without
checking the current architecture first.

If a change touches Runtime boundaries, the final report must include:

```text
Architecture Review
Сверился с ARCHITECTURE.md.
Разногласий нет.
```

or:

```text
Architecture Review
Нашёл конфликт...
```

## 2. Runtime Boundaries

Never change architectural boundaries on your own initiative.

Do not move responsibility between Runtimes without an explicit reason.

Preserve Runtime ownership and existing responsibility splits unless the Work
Item explicitly asks for an architecture change.

## 3. Behavior Preserving Work

If a task is described as:

- Refactoring
- Cleanup
- Decomposition
- Extraction

then the change must be fully behavior-preserving.

Do not change, as a side effect:

- algorithms
- timings
- UX
- character behavior
- Runtime semantics

## 4. Minimal Changes

Do not rewrite half of the project.

Prefer the smallest safe fix.

If the task can be completed by changing one file, do not change twelve files.

## 5. Do Not Invent New Runtimes

Do not create new Runtimes unless the Work Item explicitly requires it.

Prefer smaller supporting units when appropriate:

- helper
- coordinator
- builder
- controller
- service

## 6. Single Source of Truth

Do not create a second source of truth.

Examples:

- animation manifest
- emotion manifest
- voice manifest
- runtime config
- Character State

If the data already exists, use the existing source.

Character State must remain the single source of truth for character state.

## 7. Required Build Check

Before the final report, always run:

```bash
npm run build
```

If the build does not pass, the task is not complete.

If the build cannot be run, say so explicitly in the final report.

## 8. Runtime Smoke Test

After changes that touch Avatar Runtime, perform a live smoke test.

Minimum checklist:

- [ ] VRM loads
- [ ] idle animation starts
- [ ] `loadAnimation` works
- [ ] Debug Preview works
- [ ] Speaking works
- [ ] LipSync works
- [ ] Overlay works
- [ ] A-pose is absent
- [ ] Runtime Health has no new errors

## 9. Electron Client Changes

If `renderer`, `main`, or `preload` changed, you must:

- rebuild
- restart Electron
- confirm that the client starts

Do not rely on `npm run build` alone.

## 10. Python Speech Changes

After changes to Python Speech, check:

- `/health`
- `/synthesize`
- voice generation actually works

Do not rely on `py_compile` alone.

## 11. Regression Check

After every fix, check that old scenarios still work.

If Animation Runtime changed, verify:

- idle
- speaking
- transitions
- preview

## 12. RCA for Bug Fixes

If fixing a bug, determine before changing code:

- Observed behavior
- Root Cause
- Why previous fix failed
- Why the new fix works

Do not write "предположительно" without verification.

Collect evidence first: logs, telemetry, repro steps, or runtime observations.

## 13. Do Not Hide Errors

If something was not checked, say it directly.

Examples:

```text
Не проверял live.
Проверил только build.
```

```text
Не смог воспроизвести.
```

Do not pretend that a problem is solved only because compilation passed.

## 14. After Decomposition

After any large refactoring or decomposition, verify:

- build
- live smoke test
- runtime repro scripts

## 15. Do Not Remove Debug Facilities

Unless the task explicitly requires it, do not remove:

- telemetry
- diagnostics
- debug state
- Runtime Health

Debug and diagnostic surfaces are part of maintainability.

## 16. Documentation

If a change:

- changes architecture
- introduces a new contract
- changes ownership

then update the corresponding documentation.

## 17. Final Report Format

Every Work Item must end with the same report format:

```text
Architecture Review

Что изменено

Root Cause (если был баг)

Почему фикс работает

Файлы

Проверки

Ограничения
```

Do not omit sections. If a section does not apply, write `N/A`.

## 18. General Principles

- Simple solutions are preferred over complex ones.
- Do not add abstractions "for the future" without a current need.
- Preserve Runtime boundaries.
- Follow Single Responsibility.
- Do not break Character State as the single source of truth.
- Changes must improve project maintainability, not only solve the immediate task.

## 19. Never Again

These mistakes already happened or are known risks. Do not repeat them.

- Always reread `ARCHITECTURE.md` before architecture changes.
- After refactoring, do not stop at `npm run build`; run the required live smoke
  test when Runtime behavior is involved.
- Do not move helper methods without checking all call sites.
- Specifically verify moved or extracted helpers such as `applyStartupTransform()`.
- Do not change architecture and behavior in the same Work Item.
- When fixing bugs, collect evidence first: logs, telemetry, repro steps, or
  runtime observations.
- Do not consider a problem solved only because compilation succeeds.
- Confirm fixes in the live Runtime when the bug is Runtime-visible.
- Do not silently remove or weaken debug, telemetry, diagnostics, or Runtime
  Health surfaces.
