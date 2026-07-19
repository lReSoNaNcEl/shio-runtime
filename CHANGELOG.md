# Changelog

## [0.1.0-alpha.1] - 2026-07-19

### Added

- Portable Windows desktop client with VRM avatar loading, chat, microphone input, speech playback, Mirror Overlay, and Runtime Health.
- Local FastAPI Speech API with faster-whisper ASR, Silero VAD, and F5-TTS.
- LLM provider selection for Groq, Cerebras, GitHub Models, OpenRouter, and Mistral with credentials stored through Electron secure storage.
- Read-only GitHub Project Awareness with local SQLite/FTS indexing.
- Russian and English interface localization.
- Persistent redacted main-process logs and safe Runtime Health support copy actions.

### Changed

- Desktop alpha is distributed as a portable x64 ZIP and uses the separately installed Speech API.
- Alpha setup, dependency locks, and voice synchronization are reproducible from repository commands.

### Security

- LLM and GitHub credentials are encrypted with Electron `safeStorage` and are never included in Runtime Health support data.
- Project Awareness repository access is read-only.
- The release has no telemetry and does not automatically send logs or support data.

### Known limitations

- Windows 11 x64 only; the target speech configuration requires an NVIDIA CUDA-capable GPU.
- Speech API setup and launch are separate from the desktop client.
- The ZIP is unsigned, has no installer, automatic updates, or macOS/Linux build.
- First Speech API launch downloads model data; testers provide their own LLM API key and a separate GitHub token for Project Awareness.
- Screen Context 2.x, Memory Layer, and Action Runtime are not release-ready alpha features.
