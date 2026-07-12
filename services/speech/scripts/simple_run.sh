#!/bin/bash
# Run script: starts the main app (Whisper ASR + XTTS v2) on :8000.

set -e

echo "🎙️  Python Speech Service"
echo "========================="

if [ ! -d "venv" ]; then
    echo "❌ venv not found. Run: ./scripts/simple_setup.sh"
    exit 1
fi

source venv/bin/activate

# Accept the Coqui (XTTS) non-commercial model license non-interactively
export COQUI_TOS_AGREED=1
export HOST=0.0.0.0
export PORT=8000

echo ""
echo "🚀 Starting server on http://localhost:8000 ..."
echo "   First run downloads models (Whisper ~1.5GB, XTTS ~1.8GB, F5-TTS ~1.3GB)."
echo ""

python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
