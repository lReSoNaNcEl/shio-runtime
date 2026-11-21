# Install the Windows alpha

## Windows prerequisites

Use Windows 11 x64, Python 3.12 x64 and an NVIDIA driver with CUDA support in WSL2. The FlashMotion installer compiles CUDA 12.8 extensions for compute capability 12.0. The qualified GPU is the RTX 5090 with 32 GB VRAM. Allow more than 30 GB for FlashMotion model files alone, plus space for WSL, Python packages, Speech models and installation caches.

1. Enable WSL2 and restart Windows if prompted. Download the Ubuntu 24.04 x64 WSL root filesystem and verify its SHA-256 against the publisher's list. [WSL installation](https://learn.microsoft.com/windows/wsl/install) · [Ubuntu 24.04 WSL image and checksums](https://cloud-images.ubuntu.com/wsl/releases/noble/current/)
2. Import that archive into a new, dedicated distribution.

   ```powershell
   wsl --import ShioFlashMotionV1 "$env:LOCALAPPDATA\ShioFlashMotionV1" .\ubuntu-noble-wsl-amd64-wsl.rootfs.tar.gz --version 2
   wsl -d ShioFlashMotionV1 -u root
   ```

3. Inside that distribution, install the build prerequisites. Install the NVIDIA driver on Windows. [NVIDIA CUDA on WSL](https://docs.nvidia.com/cuda/wsl-user-guide/index.html)

   ```bash
   apt-get update
   apt-get install -y --no-install-recommends ca-certificates curl git
   curl -fLsS -o /tmp/shio-cuda-keyring.deb https://developer.download.nvidia.com/compute/cuda/repos/wsl-ubuntu/x86_64/cuda-keyring_1.1-1_all.deb
   dpkg -i /tmp/shio-cuda-keyring.deb
   apt-get update
   apt-get install -y --no-install-recommends python3.12-venv python3.12-dev build-essential ninja-build cuda-nvcc-12-8 cuda-cudart-dev-12-8
   exit
   ```

## First start

1. Verify the ZIP checksum and extract the complete bundle to a local Windows drive accessible to WSL2.
2. Run **Start Shio Runtime.cmd**. The launcher prepares FlashMotion in `/opt/shio-flashmotion` inside the dedicated distribution and stores verified model files under `%LOCALAPPDATA%\Shio Runtime\Data\FlashMotion`. It also installs the independent Windows Speech Pack and prepares Fish S2 Pro, faster-whisper and voice references. Keep the launcher open while it downloads files, compiles CUDA extensions and prepares the S2G normalizer.
3. Open Runtime Health and check FlashMotion, Speech API, microphone, VRM and the configured language model. FlashMotion warms up after Desktop opens.

From PowerShell, use `& '.\Start Shio Runtime.cmd' doctor` to check the dependencies and model files offline or `& '.\Start Shio Runtime.cmd' repair` to resume preparation. The launcher uses already verified files when available.

A side-by-side qualification can select an equivalently prepared dedicated WSL2 distribution with `SHIO_FLASHMOTION_WSL_DISTRO`. Set an absolute Windows path in `SHIO_LOCAL_ROOT` to isolate launcher data for that run.
