# Shio Runtime

@AGENTS.md

`AGENTS.md` is the canonical operating manual for every agent in this repository.
This file adds only repository structure, global invariants, and Claude-specific
rules. When a nested `CLAUDE.md` applies (`apps/desktop`, `services/api`), its rules
are additive. If any rule ever conflicts, `AGENTS.md` wins.

## Repository structure

- `apps/desktop` — Electron + React + TypeScript + Three.js client.
- `services/api` — Python + FastAPI ASR/TTS service (formerly `python-speech`).
- `ARCHITECTURE.md` — the single canonical architecture document.
- `AGENTS.md` — the single canonical agent manual.

## Global invariants

- Desktop and API are independent applications connected only through the HTTP
  API contract. Do not introduce source-level dependencies between them.
- Do not change runtime ownership without first reviewing `ARCHITECTURE.md`.
- Do not modify files outside this repository, and do not touch the standalone
  backups at `D:\Web\vtuber-app` or `D:\Web\python-speech`.
- Do not push, force-push, or rewrite Git history unless explicitly requested.
- Never commit `.env`, credentials, model caches, virtual environments, generated
  audio, or build output.

## Validation

Run checks only for the affected application (see its local `CLAUDE.md`) unless the
change crosses the Desktop–API contract, in which case validate both and run an
integration smoke test.

## Language

All responses to the user, and all reasoning shown to the user, must be written in
Russian.
