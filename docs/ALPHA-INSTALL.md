# Alpha installation

Requirements: Windows 11 x64, NVIDIA GPU with a working driver, Python 3.12 x64, and internet access.

1. Extract the complete ZIP to a writable directory.
2. Double-click `Start Shio Runtime.cmd`.
3. Wait while the Local Speech Pack is installed and verified. The first run downloads large CUDA dependencies, revision-pinned models, and voice references. The launcher allows up to 120 minutes for each long download command, reports progress every 30 seconds, and retries transient failures.
4. Desktop starts only after the local `/health` endpoint is compatible.

The launcher installs versioned runtime files below `%LOCALAPPDATA%\Shio Runtime\SpeechPack`. Persistent voices and model caches remain below `%LOCALAPPDATA%\Shio Runtime\Data`; repair preserves them. Desktop can still be started directly; without Speech API its voice features show a degraded state.

Useful commands:

```text
Start Shio Runtime.cmd doctor
Start Shio Runtime.cmd repair
Start Shio Runtime.cmd status
Start Shio Runtime.cmd open-logs
```
