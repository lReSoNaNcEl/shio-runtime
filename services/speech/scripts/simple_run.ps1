# Run script: starts the main app (Whisper ASR + XTTS v2) on :8000.

$ErrorActionPreference = "Stop"

Write-Host "Python Speech Service" -ForegroundColor Cyan
Write-Host "=====================" -ForegroundColor Cyan

if (-not (Test-Path "venv\Scripts\python.exe")) {
    Write-Host "venv not found. Run: .\scripts\simple_setup.ps1" -ForegroundColor Red
    exit 1
}

# Accept the Coqui (XTTS) non-commercial model license non-interactively
$env:COQUI_TOS_AGREED = "1"

Write-Host ""
Write-Host "Starting server on http://localhost:8000 ..." -ForegroundColor Green
Write-Host "First run downloads models (Whisper ~1.5GB, XTTS ~1.8GB, F5-TTS ~1.3GB). Please wait." -ForegroundColor Gray
Write-Host ""

& ".\venv\Scripts\python.exe" -m uvicorn app.main:app --host 0.0.0.0 --port 8000
