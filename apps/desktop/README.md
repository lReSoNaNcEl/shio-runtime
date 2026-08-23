# apps/desktop

Electron + React + Three.js client (VRM avatar, LLM orchestration, mic capture).
Connects to the local Speech service over HTTP only.

- Architecture: [../../ARCHITECTURE.md](../../ARCHITECTURE.md)
- Agent guidance: [../../AGENTS.md](../../AGENTS.md)
- Monorepo README (install/run): [../../README.md](../../README.md)

## Commands

```powershell
npm install          # or: npm run desktop:install (from repo root)
npm run dev          # electron-vite dev
npm run build        # electron-vite build
npx tsc --noEmit     # typecheck
```

Speech base URL defaults to `http://localhost:8000`; override with `PYTHON_SPEECH_URL`
in `.env` (copy from `.env.example`).

## Product surfaces

- **Capabilities** is the live, read-only answer to “what can Shio do now?”. It
  includes disabled bundled capabilities and routes setup to the owning Settings or
  Plugin screen. Runtime Health remains the separate technical-health surface.
- **Plugins** manages bundled first-party optional features. Enablement registers
  only manifest-declared capabilities and never grants execution authority.
- **Desktop Control** delegates a validated workflow only after Action Runtime has
  authorized its bounded scope. Its DeepSeek Harness backend is replaceable and is
  not a permission owner.
- **Browser Control** runs through the official DSH MCP client and the pinned native
  `agent-browser` package. Browser state is isolated below Shio `userData`; the
  user's regular Chrome profile is not reused.
- **Computer Control** runs bounded foreground PowerShell commands through the
  official DSH PowerShell executor and tool. Browser and shell tools are mounted in
  separate task-scoped DSH processes.
- **Full Computer Access** changes Permission Guard from per-workflow confirmation
  to automatic authorization for eligible actions. Validation, lifecycle logging,
  cancellation, and Adapter boundaries remain active.
- **Emergency Stop** cancels confirmations and work, closes the DSH/browser session,
  and allows the next action to start cleanly.
- **Diagnostics** shows bounded Runtime/action status and technical resource
  availability without credentials or complete browser snapshots.

## Desktop Control prerequisites

Development requires the locked Desktop dependencies installed with `npm install`
in this directory (or `npm run desktop:install` at the repository root). The Windows
package bundles the pinned DSH family, MCP client, and native `agent-browser`
executable. Both environments still require:

- an active OpenAI-compatible provider, model, and API key in Shio Settings;
- a supported local Google Chrome executable for Browser Control;
- PowerShell 7 or Windows PowerShell 5.1 for Computer Control;
- the local Speech API for voice features.

Computer Control reports **Needs setup** until a supported PowerShell executable is
available. Desktop Control reads the selected Character LLM configuration only
inside Electron Main and passes its key directly to the isolated DSH child process;
the renderer never receives it. It never accepts arbitrary renderer paths, uses
`npx`, or reuses the user's normal browser profile.

## Focused repros

Run from the repository root:

```powershell
npm run desktop:capabilities:repro
npm run desktop:streamdown:repro
npm run desktop:action-runtime:repro
npm run desktop:dsh:repro
npm run desktop:browser-control:repro
```
