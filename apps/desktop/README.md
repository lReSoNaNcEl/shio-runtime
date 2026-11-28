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
npm run typecheck   # all TypeScript projects, including tests
```

Speech base URL is Main-owned `SHIO_SPEECH_API_URL`, default `http://127.0.0.1:8000`.
Changing it requires restart. Renderer settings cannot supply an endpoint.

FlashMotion uses T2M for presence and catalog gestures and S2G
for gestures tied to Fish S2 Pro speech. `AudioPlayer` owns playback and the
consumed-sample clock. Avatar Runtime composes the body and hands, and Overlay
displays the same pose and mouth weights.
[Packaged Windows setup](../../docs/ALPHA-INSTALL.md) · [Development WSL2 setup](../../docs/FLASHMOTION-LIVING-V1-STAGE-1.md) ·
[Live qualification](../../docs/FLASHMOTION-LIVING-V1-STAGE-2.md)

From the repository root:

```powershell
npm run motion:catalog:check
```

The FlashMotion Python environment is `/opt/shio-flashmotion` in the
`ShioFlashMotionV1` WSL2 distribution. Character providers use the Vercel AI SDK
through the existing Main-owned LlmGateway. Configure a supported cloud provider
and model in Settings.

## Product surfaces

- **Capabilities** is the live, read-only answer to “what can Shio do now?”. It
  includes disabled bundled capabilities and routes setup to the owning Settings or
  Plugin screen. Runtime Health remains the separate technical-health surface.
- **Plugins** manages bundled first-party optional features. Enablement registers
  only manifest-declared capabilities and never grants execution authority.
- **Desktop Control** delegates a validated workflow only after Action Runtime has
  authorized its bounded scope. Its DeepSeek Harness backend is replaceable and is
  not a permission owner.
- **Browser Control** is the sole owner of a headed Google Chrome persistent context
  launched through pinned `playwright-core`. Browser state is isolated below Shio
  `userData`; the user's regular Chrome profile is not reused.
- **Computer Control** runs bounded foreground PowerShell commands through the
  official DSH PowerShell executor and tool. DSH has no browser, page, screenshot,
  mouse, or keyboard ownership.
- **Full Computer Access** changes Permission Guard from per-workflow confirmation
  to automatic authorization for eligible actions. Validation, lifecycle logging,
  cancellation, and Adapter boundaries remain active.
- **Emergency Stop** cancels confirmations and work, releases held browser input,
  closes the isolated browser context and DSH shell process, and allows the next
  action to start cleanly.
- **Diagnostics** shows bounded Runtime/action status and technical resource
  availability without credentials or complete browser snapshots.

## Desktop Control prerequisites

Development requires the locked Desktop dependencies installed with `npm install`
in this directory (or `npm run desktop:install` at the repository root). The Windows
package bundles DSH `0.2.3-alpha.2` and `playwright-core`. DSH uses a Shio-owned
minimal Cordis composition; only PowerShell is model-facing. The SDK launches
the owned runtime entry point through `dshBin` with an explicit child environment.
Both environments
still require:

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
