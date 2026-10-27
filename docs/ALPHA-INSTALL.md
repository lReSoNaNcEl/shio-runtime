# Alpha installation

Requirements: Windows 11 x64, NVIDIA GPU with a working driver, Python 3.12 x64, and internet access.

The ARDY/Fish experimental bundle additionally installs a separate Motion Pack
and requires gated Hugging Face access to Meta-Llama-3-8B-Instruct. Its qualified
target is RTX 5090 32 GB with about 96 GiB system RAM; smaller hardware is not
qualified. Follow [the experiment guide](EXPERIMENT-ARDY-FISH.md) for exact pins,
licenses, setup and migration. The Llama encoder cannot be replaced by Groq Chat.

1. Extract the complete ZIP to a writable directory.
2. Double-click `Start Shio Runtime.cmd`.
3. Wait while the Fish Local Speech Pack and separate ARDY Motion Pack are installed and verified. The first run downloads large CUDA dependencies, revision-pinned models, and voice references. The launcher allows up to 120 minutes for each long download command, reports progress every 30 seconds, and retries transient failures.
4. Desktop starts only after the local `/health` endpoint is compatible.

The launcher installs versioned runtime files below `%LOCALAPPDATA%\Shio Runtime\SpeechPack`. Persistent voices and model caches remain below `%LOCALAPPDATA%\Shio Runtime\Data`; repair preserves them. Desktop can still be started directly; without Speech API its voice features show a degraded state.

Motion environments live below `%LOCALAPPDATA%\Shio Runtime\Motion`. The
launcher supplies `SHIO_MOTION_ROOT` to Electron Main. `SHIO_LOCAL_ROOT` may
select an absolute isolated installation root for qualification. Doctor is
read-only; install/repair own dependency and model downloads.

Useful commands:

```text
Start Shio Runtime.cmd doctor
Start Shio Runtime.cmd repair
Start Shio Runtime.cmd status
Start Shio Runtime.cmd open-logs
```
