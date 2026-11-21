SHIO RUNTIME {{PRODUCT_VERSION}} — READ FIRST

Requirements: Windows 11 x64, NVIDIA Blackwell GPU (compute capability 12.0),
Python 3.12 x64, internet access and a dedicated Ubuntu 24.04 WSL2 distribution
with the CUDA 12.8 build tools. See docs\ALPHA-INSTALL.md before first start.
This is an unsigned technical alpha.

Double-click "Start Shio Runtime.cmd".
The first start prepares FlashMotion in WSL2 and installs the Fish Local Speech
Pack in Windows. It compiles CUDA extensions and downloads large dependencies,
models and voice references. Later starts reuse the prepared environments.
Qualified hardware for the motion adapter: RTX 5090 32 GB.

Commands from a terminal:
  "Start Shio Runtime.cmd" start
  "Start Shio Runtime.cmd" doctor
  "Start Shio Runtime.cmd" repair
  "Start Shio Runtime.cmd" status
  "Start Shio Runtime.cmd" stop
  "Start Shio Runtime.cmd" open-logs

See docs\ALPHA-INSTALL.md and docs\ALPHA-TROUBLESHOOTING.md.
Third-party notices: desktop\resources\THIRD_PARTY_NOTICES.md.
