SHIO RUNTIME {{PRODUCT_VERSION}} — READ FIRST

Requirements: Windows 11 x64, NVIDIA GPU/driver, Python 3.12 x64, internet access.
This is an unsigned technical alpha.

Double-click "Start Shio Runtime.cmd".
The first start installs the Fish Local Speech Pack and separate ARDY Motion Pack,
and downloads large dependencies, models, and voice references. Later starts are faster.
Experimental target: RTX 5090 32 GB, about 96 GiB RAM. Smaller GPUs are not qualified.
ARDY requires Hugging Face access to Meta-Llama-3-8B-Instruct and a local HF token store.
Its LLM2Vec encoder is independent of the Character LLM provider (including Groq).

Commands from a terminal:
  "Start Shio Runtime.cmd" start
  "Start Shio Runtime.cmd" doctor
  "Start Shio Runtime.cmd" repair
  "Start Shio Runtime.cmd" status
  "Start Shio Runtime.cmd" stop
  "Start Shio Runtime.cmd" open-logs

See docs\ALPHA-INSTALL.md and docs\ALPHA-TROUBLESHOOTING.md.
Experimental details and licenses: docs\EXPERIMENT-ARDY-FISH.md.
