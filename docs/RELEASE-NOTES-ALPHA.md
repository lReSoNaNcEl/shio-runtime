# Technical alpha

Shio Runtime `0.1.0-alpha.2` is an unsigned technical prerelease for invited testers.

This release fixes the Windows launcher incorrectly rejecting an installed Python 3.12 x64 runtime.

## What Shio Runtime can do

- Run an interactive VRM character with idle motion, expressions, lip sync, and a mirror overlay.
- Chat through supported cloud LLM providers while keeping API keys in Windows-backed encrypted storage.
- Accept text and microphone input, recognize speech locally, and answer through local F5-TTS playback.
- Load a user-selected VRM avatar and provide a guided fallback when no model is configured.
- Build a read-only searchable context from a selected GitHub repository and branch.
- Expose Runtime Health, persistent logs, and safe support information for diagnostics.
- Install, verify, start, monitor, and stop the optional Local Speech API together with Desktop through the Windows launcher.

For the exact change history, see [`CHANGELOG.md`](../CHANGELOG.md). Detailed tester guidance is in [`ALPHA.md`](ALPHA.md).

## Requirements

- Windows 11 x64
- NVIDIA GPU with a compatible driver
- Python 3.12 x64
- Internet access for first-time Local Speech Pack installation

macOS and Linux are unsupported. There is no installer, code signing, telemetry, or automatic update.

## Installation and start

1. Verify the downloaded ZIP with:
   `Get-FileHash .\Shio-Runtime-0.1.0-alpha.2-win-x64.zip -Algorithm SHA256`
2. Extract the entire ZIP.
3. Double-click `Start Shio Runtime.cmd`.
4. Wait for the launcher to install locked dependencies, download large models and voice references, run doctor, start Speech API, and then start Desktop.

Run `Start Shio Runtime.cmd doctor` for diagnostics or `Start Shio Runtime.cmd open-logs` to open launcher/runtime logs.

## Known limitations and reporting

The first installation is large and may take significant time. This CI build validates source, packaging, launcher structure, and API tests, but does not prove real CUDA/F5/Whisper inference works. Qualification on a clean NVIDIA Windows 11 machine is mandatory before publishing.

When reporting a problem, include reproduction steps, copied Runtime Health, and relevant logs after removing sensitive data.
