# Setup script. Tested config: Python 3.12 + PyTorch cu128 (Blackwell / RTX 50xx).
#
# Single venv:  venv\  -> FastAPI + Whisper ASR + XTTS v2 (all in-process).

$ErrorActionPreference = "Stop"

Write-Host "Setting up Python Speech Service" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan

# Require Python 3.12 (3.13/3.14 lack ML wheels)
try { & py -3.12 --version | Out-Null } catch {
    Write-Host "Python 3.12 not found. Install: winget install Python.Python.3.12 --scope user" -ForegroundColor Red
    exit 1
}

Write-Host "`nCreating venv (Whisper + XTTS + F5-TTS)..." -ForegroundColor Yellow
if (Test-Path "venv") { Remove-Item -Recurse -Force venv }
& py -3.12 -m venv venv
& ".\venv\Scripts\python.exe" -m pip install --upgrade pip
# Install torch first and constrain it so coqui-tts/f5-tts don't pull a different build
& ".\venv\Scripts\python.exe" -m pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu128
"torch==$((& '.\venv\Scripts\python.exe' -c 'import torch;print(torch.__version__)'))" | Out-File -Encoding ascii .torch-constraint.txt
& ".\venv\Scripts\python.exe" -m pip install -r requirements.txt -c .torch-constraint.txt
Remove-Item .torch-constraint.txt -ErrorAction SilentlyContinue

Write-Host "`nSetup complete!" -ForegroundColor Green
Write-Host "Next: .\scripts\simple_run.ps1  then open http://localhost:8000" -ForegroundColor White
Write-Host "Models (Whisper ~1.5GB, XTTS ~1.8GB, F5-TTS ~1.3GB) download on first run." -ForegroundColor Gray
Write-Host "Then prepare voice manifest directories:  .\venv\Scripts\python.exe scripts\prepare_voice_manifest_dirs.py" -ForegroundColor Gray
