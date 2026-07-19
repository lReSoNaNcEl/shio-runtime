# Changelog

## [0.1.0-alpha.2] - 2026-07-19

### Fixed

- Fixed the Windows launcher incorrectly reporting that Python 3.12 x64 was missing when it was already installed.

### Changed

- Python discovery now checks the Python launcher, standard per-user and system installation directories, and `PATH`.
- Launcher validation now executes the same Windows PowerShell-compatible Python architecture probe used by the release.

## [0.1.0-alpha.1] - 2026-07-19

### Added

- Portable Windows desktop client with VRM avatar loading, chat, microphone input, speech playback, Mirror Overlay, and Runtime Health.
- Local FastAPI Speech API with faster-whisper ASR, Silero VAD, and F5-TTS.
- LLM provider selection for Groq, Cerebras, GitHub Models, OpenRouter, and Mistral with credentials stored through Electron secure storage.
- Read-only GitHub Project Awareness with local SQLite/FTS indexing.
- Russian and English interface localization.
- Persistent redacted main-process logs and safe Runtime Health support copy actions.
- Managed Windows launcher that installs, verifies, starts, and owns an optional local Speech API process.
- Reproducible complete alpha bundle with Desktop, launcher, Speech Pack source, documentation, and checksums.

### Changed

- Desktop and the independently maintained Local Speech API are delivered through one managed Windows ZIP.
- Alpha setup, dependency locks, and voice synchronization are reproducible from repository commands.

### Security

- LLM and GitHub credentials are encrypted with Electron `safeStorage` and are never included in Runtime Health support data.
- Project Awareness repository access is read-only.
- The release has no telemetry and does not automatically send logs or support data.

### Known limitations

- Windows 11 x64 only; the target speech configuration requires an NVIDIA CUDA-capable GPU.
- The first launcher run installs the Speech Pack and downloads large dependencies and models.
- The ZIP is unsigned, has no installer, automatic updates, or macOS/Linux build.
- First Speech API launch downloads model data; testers provide their own LLM API key and a separate GitHub token for Project Awareness.
- Screen Context 2.x, Memory Layer, and Action Runtime are not release-ready alpha features.
