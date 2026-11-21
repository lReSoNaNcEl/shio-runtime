#!/usr/bin/env bash
set -euo pipefail

runtime="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
tools="$runtime/../qualifications/flashmotion"
assets="${SHIO_FLASHMOTION_ASSETS:?FlashMotion asset directory is required}"
environment=/opt/shio-flashmotion
python="$environment/bin/python"
stats="$assets/reconstructed-stats-full55-reference-python.npz"
ready="$assets/.flashmotion-v1-ready"

case "$assets" in
    /*) ;;
    *) echo "FlashMotion needs an absolute asset directory." >&2; exit 1 ;;
esac

preflight() {
    if [[ "$(uname -r | tr '[:upper:]' '[:lower:]')" != *wsl2* ]] ||
        ! command -v python3.12 >/dev/null ||
        ! command -v git >/dev/null ||
        ! command -v g++ >/dev/null ||
        ! command -v ninja >/dev/null ||
        [[ ! -x /usr/local/cuda-12.8/bin/nvcc ]]; then
        echo "Prepare the dedicated Ubuntu WSL2 distribution with Python 3.12, Git, build tools and CUDA 12.8. See docs/ALPHA-INSTALL.md." >&2
        exit 1
    fi
}

runtime_check() {
    "$python" -B -c '
import numpy
import torch
import torchaudio
import transformers
from causal_conv1d import causal_conv1d_fn
from mamba_ssm.ops.selective_scan_interface import selective_scan_fn
if torch.__version__ != "2.7.1+cu128" or torch.cuda.get_device_capability() != (12, 0):
    raise RuntimeError("FlashMotion needs PyTorch 2.7.1+cu128 and an NVIDIA compute capability 12.0 GPU")
'
}

case "${1:-}" in
    status)
        test -x "$python" && test -f "$ready" && test -f "$stats"
        ;;
    preflight)
        preflight
        ;;
    doctor)
        runtime_check
        "$python" -B "$tools/assets.py" "$assets" --include-umt5 --include-s2g-inputs --check
        "$python" -B "$tools/rebuild_s2g_stats.py" "$assets" --output "$stats" --check
        ;;
    install)
        preflight
        mkdir -p "$assets"
        rm -f -- "$ready"
        python3.12 -B "$tools/assets.py" "$assets" --include-umt5 --include-s2g-inputs
        if [[ ! -x "$python" ]] || ! runtime_check; then
            python3.12 -m venv "$environment"
            "$python" -m pip install torch==2.7.1 torchaudio==2.7.1 --index-url https://download.pytorch.org/whl/cu128
            "$python" -m pip install numpy==1.26.4 scipy==1.15.3 einops==0.8.1 transformers==4.57.0 sentencepiece==0.2.1 wheel==0.45.1 uv==0.10.12
            scratch="$(mktemp -d)"
            trap 'rm -rf -- "$scratch"' EXIT
            "$python" -B "$tools/build_cuda.py" "$assets" "$scratch/build"
            runtime_check
        fi
        if [[ ! -f "$stats" ]]; then
            export UV_PYTHON_INSTALL_DIR=/opt/flashmotion-python UV_CACHE_DIR=/opt/flashmotion-uv-cache
            uv="$environment/bin/uv"
            stats_python=/opt/flashmotion-stats/bin/python
            "$uv" python install 3.10.12
            "$uv" venv --allow-existing --python 3.10.12 /opt/flashmotion-stats
            "$uv" pip install --python "$stats_python" numpy==1.23.5 scipy==1.15.3
            OPENBLAS_CORETYPE=Haswell OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 MKL_NUM_THREADS=1 \
                "$stats_python" -B "$tools/rebuild_s2g_stats.py" "$assets" --output "$stats"
        fi
        "$python" -B "$tools/rebuild_s2g_stats.py" "$assets" --output "$stats" --check
        touch "$ready"
        ;;
    *)
        echo "Usage: setup.sh preflight | status | install | doctor" >&2
        exit 2
        ;;
esac
