# Shio Runtime 0.1.0-alpha.1

This is the first technical alpha for invited testers. It is an unsigned portable build intended for functional evaluation, not a production release.

## Supported platform and hardware

- Windows 11 x64.
- NVIDIA GPU with CUDA support is the target configuration for local ASR and TTS.
- Node.js 24.x, npm 11.x, Python 3.12, and enough free disk space for Python packages and downloaded models are required for Speech API setup.
- macOS and Linux are not supported in this alpha.

## ZIP contents

The release ZIP contains the portable Electron desktop application and its runtime files. Extract the complete archive to a writable folder and start `Shio Runtime.exe`. Do not run the executable from inside the ZIP.

The Speech API, Python, CUDA-compatible drivers and models are installed separately. The ZIP has no installer, code signing, automatic updater, or bundled Python environment. Windows SmartScreen may display a warning because the executable is unsigned; verify that the archive came from the project maintainer before continuing.

## Install and start the Speech API

From a fresh repository clone, open PowerShell in the repository root:

```powershell
npm run desktop:install
npm run alpha:setup
```

`alpha:setup` checks the supported toolchain, creates the local Speech API environment, installs locked CUDA dependencies, and synchronizes pinned voice references. It does not start the service.

Start the API in a separate terminal and keep it running while using the desktop:

```powershell
npm run api:dev
```

On first setup or first API use, model downloads can take time and require an internet connection. The API listens locally on port `8000`.

## First run

1. Start the Speech API, then run `Shio Runtime.exe`.
2. Open Settings and choose an LLM provider and model.
3. Enter your own provider API key. Shio does not supply an LLM account or quota.
4. Select a microphone and grant Windows microphone permission when prompted.
5. Choose a `.vrm` avatar file.
6. Confirm Speech API, LLM, avatar, and microphone state in Runtime Health.

LLM credentials are encrypted through Windows-backed Electron secure storage. Project Awareness uses a separate GitHub token; an LLM GitHub Models credential is not reused for repository access.

## Project Awareness

In Settings, select GitHub, enter the repository in `owner/name` form, choose a branch, save a separate GitHub token, and connect. Project Awareness is read-only: it downloads repository metadata and source content into a local SQLite/FTS index and does not modify the repository.

## Settings, logs, and support data

Application settings and encrypted credential files are stored under Electron's `userData` directory, normally below `%APPDATA%\Shio Runtime`. Persistent logs are stored in Electron's standard logs directory. Runtime Health shows the exact paths in its copied support payload.

Runtime Health is available without Developer Mode:

- **Open logs folder** opens the persistent log location.
- **Copy version** copies `0.1.0-alpha.1`.
- **Copy Runtime Health** copies readable JSON containing release and safe runtime status.

The copied payload contains no API keys, GitHub token, authorization headers, encrypted credential contents, screenshots, or audio buffers. Review it before attaching it to a report.

To fully remove local data, exit Shio Runtime, open the `userData` path reported by Runtime Health, and delete that Shio Runtime directory. This removes settings, encrypted credentials, Project Awareness indexes, and application logs; it does not remove the separately installed repository, Python environment, or model caches.

## Bug reports

Include:

1. Steps to reproduce, expected result, and actual result.
2. The copied version and Runtime Health JSON.
3. Relevant log files from **Open logs folder**.
4. Windows version, GPU model, and whether the Speech API terminal showed an error.

Do not include API keys, GitHub tokens, private source code, screen captures, or recorded audio unless you deliberately choose to share them through an agreed private channel. The application has no telemetry and does not automatically upload reports.

## Known limitations

- Windows 11 x64 only; NVIDIA/CUDA is the target hardware.
- Speech API installation and launch are separate from the desktop.
- The executable is unsigned, so SmartScreen can warn.
- There is no installer, automatic update, telemetry, macOS build, or Linux build.
- First Speech API launch can download large models.
- Every tester supplies an LLM provider API key.
- Project Awareness requires a separate GitHub token.
- This is a technical alpha; failures and incomplete workflows are expected.

## Security notes

Use test-scoped credentials with the minimum necessary permissions. Project Awareness access is read-only, but the GitHub token still determines which repositories can be read. Do not share the application data directory or encrypted credential files. Obtain builds only from the project maintainer and verify the archive source before bypassing SmartScreen.

This repository remains `UNLICENSED`; no distribution license has been approved or added. That is a release blocker for public distribution.
