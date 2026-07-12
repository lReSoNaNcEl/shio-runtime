# CLAUDE.md

Before making any code changes in this repository, read and follow:

- `AGENTS.md`
- `ARCHITECTURE.md` when the task touches architecture, Runtime boundaries,
  Avatar Runtime, Speech Runtime, Character State, Event Bus, Overlay Runtime,
  or related systems.

`AGENTS.md` is the canonical developer operating manual for this project.

All Claude Code work must follow its rules, including:

- Architecture First
- Runtime Boundaries
- Behavior Preserving refactoring
- Single Source of Truth
- required `npm run build`
- required Runtime smoke tests when applicable
- RCA for bug fixes
- final report format

If `CLAUDE.md` and `AGENTS.md` ever conflict, `AGENTS.md` wins.

## Language

All responses to the user, and all reasoning shown to the user, must be
written in Russian.
