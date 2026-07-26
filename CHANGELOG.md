# Changelog

## [0.1.0-alpha.5] - 2026-07-26

### Added

- Selected-voice Speech API warmup prepares the configured F5 voice, language, and Russian accent path in the background.
- Chat shows typed LLM setup readiness with a direct Settings action when the active provider credential is missing.
- Launcher installation prefetches revision-pinned Whisper, F5, vocoder, and RUAccent model assets before normal startup.

### Changed

- Published alpha releases and assets are immutable; only an unpublished draft targeting the exact release commit may be recreated.
- Managed Speech API ownership now includes and revalidates the process start time, executable, installation root, version, endpoint, and service identity.
- Repair builds and validates a staging replacement while retaining the previous working installation until replacement succeeds.
- Packaged fresh configs default Developer Mode and its animation HUD to off; development fresh configs default both to on.
- Project credential storage and GitHub connection readiness are presented as independent statuses.

### Fixed

- Missing LLM credentials no longer clear the composer draft, append the user turn, or appear as a red chat error, including credential-removal races.
- VRM configuration is independent of a mounted Three.js Preview scene, so first selection immediately unlocks Camera and Overlay guards.
- Selected Russian voices no longer remain cold after the core default-voice warmup.
- F5 warmup and real synthesis share one inference lock; concurrent identical warmups coalesce and the distinct warmup queue is bounded.
- Launcher adoption no longer treats an unrelated healthy process as managed, and stop/repair operations reject ownership identity mismatches.
- Packaged model prefetch now bootstraps the Speech API import root when launched as a script.
- Failed installation cleanup removes only the staging voice junction and preserves persistent voice data.
- Normal managed API startup reports missing prefetched assets as a repair requirement instead of downloading models silently.
- Release bundles are assembled from Git-tracked allowlisted files and reject credentials, runtime data, model weights, logs, databases, and temporary artifacts.

### Security

- Release workflows require annotated tags from `origin/main`, pin official Actions by immutable commit SHA, and never overwrite a published release.
- Published Speech Packs require the expected service/contract identity and real F5 mode; mock F5 cannot satisfy release readiness.

### Known Limitations

- Windows 11 x64 only; the qualified local speech path requires an NVIDIA CUDA-capable GPU and Python 3.12 x64.
- The unsigned ZIP has no installer, automatic update, code signing, or macOS/Linux target.
- First installation remains large and network-dependent because locked dependencies, voice references, and pinned models are installed into persistent local data.
- Testers provide their own LLM credential and a separate GitHub token for Project Awareness.
- Screen Context 2.x, Memory Layer, and Action Runtime remain outside the release-ready alpha scope.

## [0.1.0-alpha.4] - 2026-07-26

### Fixed

- Strict doctor now validates the launcher's actual Speech Pack virtual environment instead of assuming a service-local `.venv`.
- Mutating launcher commands are single-instance, preventing a second launch from deleting an active staging installation.
- Long voice synchronization reports periodic activity and stops/retries a process that exceeds the installation timeout.

### Known Limitations

- `0.1.0-alpha.1` through `0.1.0-alpha.3` are superseded prereleases with blocking first-run launcher defects and must not be used for qualification.

## [0.1.0-alpha.3] - 2026-07-26

### Fixed

- Voice synchronization now preserves manifest paths through the launcher's persistent voices junction instead of failing when the resolved files are outside the Speech Pack directory.
- The Windows launcher now retries voice synchronization in a fresh process after transient Hugging Face TLS or HTTP-client failures.
- Failed and abandoned Speech Pack staging directories are safely removed without traversing the persistent voices junction.

### Known Limitations

- `0.1.0-alpha.1` and `0.1.0-alpha.2` are superseded prereleases with blocking first-run launcher defects and must not be used for qualification.

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
