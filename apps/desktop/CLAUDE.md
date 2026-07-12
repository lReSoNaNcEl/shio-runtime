# Desktop application

Electron + React + TypeScript + Three.js client. Local rules for `apps/desktop`.
The canonical cross-repo manual is `../../AGENTS.md`; global and Claude-specific rules
are in `../../CLAUDE.md`. Reread `../../ARCHITECTURE.md` before touching runtime
boundaries.

## Stack

Electron, React, TypeScript, Three.js, VRM and VRMA.

## Architecture ownership

- Controller coordinates existing runtimes but does not absorb their ownership.
- AudioPlayer is the sole audio playback owner.
- AvatarExpressionMixer is the sole final facial-expression writer. Do not write to
  VRM facial expressions outside the mixer.
- Overlay is a presentation consumer, not an application runtime.
- Character State is the single source of truth for character state.

## Change policy

- Preserve existing runtime behavior unless the task explicitly changes it.
- Do not silently change the HTTP API contract with `services/api`.

## Commands

- `npx tsc --noEmit` — typecheck
- `npm run build` — required before the final report

## Code quality (Biome)

Desktop formatting, linting, React checks, and import ordering are owned by
[Biome](https://biomejs.dev). The configuration and the `@biomejs/biome`
dependency live in this project (`apps/desktop/biome.jsonc`); there is no root
`node_modules`. Biome runs with `apps/desktop` as its working directory and checks
`.`. Run the local scripts here, or delegate from the repo root:

- `npm run check` (root: `npm run desktop:check`) — formatter + linter + import sorting
- `npm run check:fix` (root: `npm run desktop:check:fix`) — apply the safe fixes
- `npm run lint` / `npm run format` / `npm run imports:check`

Tooling ownership: Desktop → Biome, API (Python) → Ruff, TypeScript types → `tsc`.
Do not add ESLint or Prettier alongside Biome. Prefer a justified single-line
`// biome-ignore lint/<rule>: <reason>` (or `/* … */` in CSS) over disabling a
rule; never add blanket suppressions.

## Electron client changes

If `renderer`, `main`, or `preload` changed, you must rebuild, restart Electron, and
confirm the client starts. Do not rely on `npm run build` alone.

## Runtime smoke test

After changes that touch Avatar Runtime, perform a live smoke test:

- [ ] VRM loads
- [ ] idle animation starts
- [ ] `loadAnimation` works
- [ ] Debug Preview works
- [ ] Speaking works
- [ ] LipSync works
- [ ] Overlay works
- [ ] A-pose is absent
- [ ] Runtime Health has no new errors

After Animation Runtime changes, additionally verify: idle, speaking, transitions,
and preview.
