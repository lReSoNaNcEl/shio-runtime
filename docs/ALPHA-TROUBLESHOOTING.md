# Alpha troubleshooting

- **Python not found:** install Python 3.12 x64 and enable the Python launcher.
- **NVIDIA check failed:** install a compatible NVIDIA driver and confirm `nvidia-smi` works.
- **Port 8000 is occupied:** stop the application using the port. The launcher never terminates an unowned process.
- **Health timeout:** run `Start Shio Runtime.cmd open-logs` and inspect `speech-api.log` and `speech-api-error.log`.
- **Missing model cache:** run `Start Shio Runtime.cmd repair`. Normal managed startup never downloads large model files; install/repair owns that work.
- **Voice download failed:** check access to `huggingface.co` and retry. The launcher retries transient failures automatically and removes incomplete Speech Pack staging data after the final failure.
- **Damaged installation:** run `Start Shio Runtime.cmd repair`. Repair replaces only a verified managed installation through staging and preserves persistent Data, voices, and model caches.
- **Diagnostics:** run `Start Shio Runtime.cmd doctor`.

Do not post API keys, GitHub tokens, `.env` files, or private logs publicly.
