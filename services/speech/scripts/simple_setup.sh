#!/bin/bash
# Setup script (macOS / Linux). Single venv: Whisper ASR + XTTS v2 in-process.
#
# - macOS (Apple Silicon): installs the default torch build (CPU / MPS). No CUDA.
# - Linux + NVIDIA GPU: installs the CUDA cu128 build (Blackwell / RTX 50xx).

set -e

echo "🚀 Setting up Python Speech Service"
echo "==================================="

# Require Python 3.12 (3.13/3.14 lack ML wheels)
if ! command -v python3.12 >/dev/null 2>&1; then
    echo "❌ Python 3.12 not found."
    echo "   macOS:  brew install python@3.12"
    echo "   Linux:  sudo apt install python3.12 python3.12-venv"
    exit 1
fi

echo ""
echo "🗑️  Cleaning up old environment..."
rm -rf venv

echo "📦 Creating Python 3.12 virtual environment..."
python3.12 -m venv venv
source venv/bin/activate

python -m pip install --upgrade pip setuptools wheel

echo ""
echo "📦 Installing PyTorch..."
if [[ "$(uname)" == "Darwin" ]]; then
    # macOS: CPU / Metal (MPS) build — no CUDA wheels exist for macOS.
    pip install torch torchaudio
else
    # Linux + NVIDIA: CUDA cu128 (works on Blackwell / RTX 50xx).
    pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu128
fi

echo ""
echo "📦 Installing dependencies (XTTS + F5-TTS)..."
# Constrain torch so coqui-tts/f5-tts don't pull a different build
echo "torch==$(python -c 'import torch;print(torch.__version__)')" > .torch-constraint.txt
pip install -r requirements.txt -c .torch-constraint.txt
rm -f .torch-constraint.txt

echo ""
echo "✅ Setup complete!"
echo "   Next: ./scripts/simple_run.sh   then open http://localhost:8000"
echo "   Models (Whisper ~1.5GB, XTTS ~1.8GB, F5-TTS ~1.3GB) download on first run."
echo "   Then prepare voice manifest directories:  ./venv/bin/python scripts/prepare_voice_manifest_dirs.py"
