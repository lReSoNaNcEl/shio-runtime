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
