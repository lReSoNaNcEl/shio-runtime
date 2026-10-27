# Alpha troubleshooting

- **Python not found:** install Python 3.12 x64 and enable the Python launcher.
- **NVIDIA check failed:** install a compatible NVIDIA driver and confirm `nvidia-smi` works.
- **Port 8000 is occupied:** stop the application using the port. The launcher never terminates an unowned process.
- **Health timeout:** run `Start Shio Runtime.cmd open-logs` and inspect `speech-api.log` and `speech-api-error.log`.
- **Missing model cache:** run `Start Shio Runtime.cmd repair`. Normal managed startup never downloads large model files; install/repair owns that work.
- **Voice download failed:** check access to `huggingface.co` and retry. The launcher retries transient failures automatically and removes incomplete Speech Pack staging data after the final failure.
- **Damaged installation:** run `Start Shio Runtime.cmd repair`. Repair replaces only a verified managed installation through staging and preserves persistent Data, voices, and model caches.
- **Diagnostics:** run `Start Shio Runtime.cmd doctor`.
- **ARDY encoder access denied:** grant the current Hugging Face account access to `meta-llama/Meta-Llama-3-8B-Instruct` and configure its local token store, then repair. Access to Llama 3.1 is a different grant. Do not send tokens in chat.
- **Fish loading after Stop:** cancellation terminates the actual GPU worker. Loading/warming and delayed recovery are expected; wait for ready before the next session. Repeated failed status needs logs, not an F5 fallback.
- **Motion degraded:** inspect Runtime Health queue/deadline/error and run Motion doctor. Safe pose is a failure presentation, not evidence of successful ARDY generation.
- **Old F5 environment:** reinstall the experimental Speech Pack from its lock-file and migrate `.env` to Fish settings. Existing F5/Cosy configurations are not accepted silently.

See [the ARDY/Fish guide](EXPERIMENT-ARDY-FISH.md) for resources, contracts and
qualification limits. Do not infer low-memory support from a successful build.

Do not post API keys, GitHub tokens, `.env` files, or private logs publicly.
