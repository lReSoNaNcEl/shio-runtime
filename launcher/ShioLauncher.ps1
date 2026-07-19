param(
    [ValidateSet("start", "install", "doctor", "repair", "status", "stop", "open-logs")]
    [string]$Command = "start"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$LauncherRoot = $PSScriptRoot
$BundleRoot = Split-Path -Parent $LauncherRoot
$ManifestPath = Join-Path $LauncherRoot "release-manifest.json"
$LocalRoot = Join-Path $env:LOCALAPPDATA "Shio Runtime"
$DataRoot = Join-Path $LocalRoot "Data"
$LogsRoot = Join-Path $LocalRoot "Logs"
$RuntimeRoot = Join-Path $LocalRoot "Runtime"
$LauncherLog = Join-Path $LogsRoot "launcher.log"
$OwnershipPath = Join-Path $RuntimeRoot "speech-api.json"

New-Item -ItemType Directory -Force -Path $DataRoot, $LogsRoot, $RuntimeRoot | Out-Null
$env:HF_HOME = Join-Path $DataRoot "huggingface"
$env:TORCH_HOME = Join-Path $DataRoot "torch"
$env:XDG_CACHE_HOME = Join-Path $DataRoot "cache"

function Write-LauncherLog {
    param([string]$Message)
    $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss.fff"), $Message
    Add-Content -LiteralPath $LauncherLog -Encoding UTF8 -Value $line
    Write-Host $Message
}

function Fail {
    param([string]$Message)
    Write-LauncherLog "ERROR: $Message"
    throw $Message
}

function Read-Manifest {
    if (-not (Test-Path -LiteralPath $ManifestPath)) { Fail "Release manifest is missing: $ManifestPath" }
    $manifest = Get-Content -Raw -Encoding UTF8 -LiteralPath $ManifestPath | ConvertFrom-Json
    if ($manifest.schemaVersion -ne 1 -or $manifest.platform -ne "win32" -or
        $manifest.architecture -ne "x64") {
        Fail "Release manifest is incompatible."
    }
    return $manifest
}

function Resolve-BundlePath {
    param([string]$RelativePath)
    if ([IO.Path]::IsPathRooted($RelativePath)) { Fail "Manifest path must be relative." }
    $root = [IO.Path]::GetFullPath($BundleRoot)
    $resolved = [IO.Path]::GetFullPath((Join-Path $root $RelativePath))
    if (-not $resolved.StartsWith($root + [IO.Path]::DirectorySeparatorChar,
            [StringComparison]::OrdinalIgnoreCase)) {
        Fail "Manifest path escapes the release bundle."
    }
    return $resolved
}

function Assert-Platform {
    if ($env:OS -ne "Windows_NT" -or -not [Environment]::Is64BitOperatingSystem -or
        [Runtime.InteropServices.RuntimeInformation]::OSArchitecture -ne
        [Runtime.InteropServices.Architecture]::X64) {
        Fail "Shio Runtime alpha requires Windows x64."
    }
    $build = [Environment]::OSVersion.Version.Build
    if ($build -lt 22000) { Fail "Shio Runtime alpha requires Windows 11." }
}

function Find-Python312 {
    $candidates = @(
        @{ File = "py.exe"; Args = @("-3.12") },
        @{ File = "python.exe"; Args = @() }
    )
    foreach ($candidate in $candidates) {
        try {
            $version = & $candidate.File @($candidate.Args) -c "import sys,struct; print(f'{sys.version_info.major}.{sys.version_info.minor}:{struct.calcsize(""P"")*8}')" 2>$null
            if ($LASTEXITCODE -eq 0 -and $version.Trim() -eq "3.12:64") { return $candidate }
        } catch { }
    }
    Fail "Python 3.12 x64 was not found. Install it from python.org and retry."
}

function Test-Nvidia {
    try {
        & nvidia-smi.exe --query-gpu=name --format=csv,noheader 2>$null | Out-Null
        return $LASTEXITCODE -eq 0
    } catch { return $false }
}

function Get-InstallPaths {
    param($Manifest)
    $install = Join-Path $LocalRoot ("SpeechPack\{0}" -f $Manifest.speechPack.version)
    return @{
        Root = $install
        Api = Join-Path $install "services\api"
        Python = Join-Path $install ".venv\Scripts\python.exe"
        State = Join-Path $install "install-state.json"
    }
}

function Invoke-Checked {
    param([string]$File, [string[]]$Arguments, [string]$WorkingDirectory)
    Write-LauncherLog "Running: $File $($Arguments -join ' ')"
    $process = Start-Process -FilePath $File -ArgumentList $Arguments -WorkingDirectory $WorkingDirectory -Wait -PassThru -NoNewWindow
    if ($process.ExitCode -ne 0) { Fail "Command failed with exit code $($process.ExitCode)." }
}

function Install-SpeechPack {
    param($Manifest, [switch]$Repair)
    Assert-Platform
    if (-not (Test-Nvidia)) { Fail "A working NVIDIA GPU/driver is required for this alpha." }
    $python = Find-Python312
    $paths = Get-InstallPaths $Manifest
    $source = Resolve-BundlePath $Manifest.speechPack.sourceRelativePath
    if (-not (Test-Path -LiteralPath (Join-Path $source "services\api\requirements.lock.txt"))) {
        Fail "Speech Pack payload is incomplete."
    }
    $staging = "$($paths.Root).staging.$PID"
    if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $staging | Out-Null
    try {
        Write-LauncherLog "Copying Speech Pack $($Manifest.speechPack.version)..."
        Copy-Item -LiteralPath (Join-Path $source "services") -Destination $staging -Recurse
        $stagingApi = Join-Path $staging "services\api"
        & $python.File @($python.Args) -m venv (Join-Path $staging ".venv")
        if ($LASTEXITCODE -ne 0) { Fail "Could not create the Speech Pack virtual environment." }
        $stagingPython = Join-Path $staging ".venv\Scripts\python.exe"
        Invoke-Checked $stagingPython @("-m", "pip", "install", "--upgrade", "pip>=25.3,<26") $stagingApi
        Invoke-Checked $stagingPython @("-m", "pip", "install", "-r", "requirements-torch-cu128.txt") $stagingApi
        Invoke-Checked $stagingPython @("-m", "pip", "install", "-r", "requirements.lock.txt") $stagingApi
        Invoke-Checked $stagingPython @("-m", "pip", "check") $stagingApi
        $persistentEnv = Join-Path $DataRoot "speech-api.env"
        if (-not (Test-Path -LiteralPath $persistentEnv)) {
            Copy-Item -LiteralPath (Join-Path $stagingApi ".env.example") -Destination $persistentEnv
        }
        Copy-Item -LiteralPath $persistentEnv -Destination (Join-Path $stagingApi ".env")
        $persistentVoices = Join-Path $DataRoot "voices"
        New-Item -ItemType Directory -Force -Path $persistentVoices | Out-Null
        $voicesPath = Join-Path $stagingApi "voices"
        if (Test-Path -LiteralPath $voicesPath) { Remove-Item -LiteralPath $voicesPath -Recurse -Force }
        New-Item -ItemType Junction -Path $voicesPath -Target $persistentVoices | Out-Null
        Invoke-Checked $stagingPython @("scripts\sync_voices.py") $stagingApi
        Invoke-Checked $stagingPython @("scripts\doctor_strict.py") $stagingApi
        $state = @{
            schemaVersion = 1
            speechPackVersion = $Manifest.speechPack.version
            installedAt = (Get-Date).ToUniversalTime().ToString("o")
            installDirectory = $paths.Root
            pythonExecutable = $paths.Python
            status = "ready"
        } | ConvertTo-Json
        Set-Content -LiteralPath (Join-Path $staging "install-state.json") -Encoding UTF8 -Value $state
        if (Test-Path -LiteralPath $paths.Root) {
            $backup = "$($paths.Root).previous.$PID"
            Move-Item -LiteralPath $paths.Root -Destination $backup
            Move-Item -LiteralPath $staging -Destination $paths.Root
            Remove-Item -LiteralPath $backup -Recurse -Force
        } else {
            Move-Item -LiteralPath $staging -Destination $paths.Root
        }
        Write-LauncherLog "Speech Pack installation is ready."
    } catch {
        Write-LauncherLog "Installation failed; inactive staging directory: $staging"
        throw
    }
}

function Test-Health {
    param($Manifest)
    $uri = "http://$($Manifest.speechPack.host):$($Manifest.speechPack.port)$($Manifest.speechPack.healthPath)"
    try {
        $health = Invoke-RestMethod -Uri $uri -TimeoutSec 3
        return $health.status -eq "ok" -and $null -ne $health.engines
    } catch { return $false }
}

function Get-PortOccupied {
    param($Manifest)
    return $null -ne (Get-NetTCPConnection -LocalPort $Manifest.speechPack.port -State Listen -ErrorAction SilentlyContinue)
}

function Read-Ownership {
    if (-not (Test-Path -LiteralPath $OwnershipPath)) { return $null }
    try { return Get-Content -Raw -LiteralPath $OwnershipPath | ConvertFrom-Json } catch { return $null }
}

function Stop-OwnedApi {
    $owned = Read-Ownership
    if ($null -eq $owned) { return }
    $process = Get-Process -Id $owned.pid -ErrorAction SilentlyContinue
    if ($null -eq $process) {
        Remove-Item -LiteralPath $OwnershipPath -Force -ErrorAction SilentlyContinue
        return
    }
    $actualStart = $process.StartTime.ToUniversalTime().ToString("o")
    if ($actualStart -ne $owned.startTime) {
        Write-LauncherLog "Stale ownership state ignored; PID belongs to another process."
        Remove-Item -LiteralPath $OwnershipPath -Force
        return
    }
    Write-LauncherLog "Stopping managed Speech API (PID $($owned.pid))..."
    Stop-Process -Id $owned.pid
    Wait-Process -Id $owned.pid -Timeout 15 -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $OwnershipPath -Force -ErrorAction SilentlyContinue
}

function Ensure-Installed {
    param($Manifest)
    $paths = Get-InstallPaths $Manifest
    if (-not (Test-Path -LiteralPath $paths.State) -or -not (Test-Path -LiteralPath $paths.Python)) {
        Install-SpeechPack $Manifest
    }
    return $paths
}

function Start-Shio {
    param($Manifest)
    Assert-Platform
    $desktop = Resolve-BundlePath $Manifest.desktop.relativeExecutablePath
    if (-not (Test-Path -LiteralPath $desktop)) { Fail "Desktop executable is missing." }
    $paths = Ensure-Installed $Manifest
    $ownsApi = $false
    if (Test-Health $Manifest) {
        Write-LauncherLog "Using compatible externally managed Speech API."
    } elseif (Get-PortOccupied $Manifest) {
        Fail "Port $($Manifest.speechPack.port) is occupied by an incompatible service. The launcher will not stop it."
    } else {
        $runtimeLog = Join-Path $LogsRoot "speech-api.log"
        $arguments = @("-m", "uvicorn", "app.main:app", "--host", $Manifest.speechPack.host, "--port", [string]$Manifest.speechPack.port)
        $api = Start-Process -FilePath $paths.Python -ArgumentList $arguments -WorkingDirectory $paths.Api `
            -PassThru -WindowStyle Hidden -RedirectStandardOutput $runtimeLog -RedirectStandardError (Join-Path $LogsRoot "speech-api-error.log")
        @{
            schemaVersion = 1
            pid = $api.Id
            startTime = $api.StartTime.ToUniversalTime().ToString("o")
            speechPackVersion = $Manifest.speechPack.version
        } | ConvertTo-Json | Set-Content -LiteralPath $OwnershipPath -Encoding UTF8
        $ownsApi = $true
        $deadline = (Get-Date).AddSeconds($Manifest.speechPack.startupTimeoutSeconds)
        while ((Get-Date) -lt $deadline -and -not (Test-Health $Manifest)) {
            if ($api.HasExited) { break }
            Start-Sleep -Seconds 2
        }
        if (-not (Test-Health $Manifest)) {
            Stop-OwnedApi
            Fail "Speech API did not become healthy. See $runtimeLog"
        }
    }
    try {
        Write-LauncherLog "Starting Shio Runtime Desktop..."
        $desktopProcess = Start-Process -FilePath $desktop -WorkingDirectory (Split-Path -Parent $desktop) -PassThru
        Wait-Process -Id $desktopProcess.Id
    } finally {
        if ($ownsApi) { Stop-OwnedApi }
    }
}

$manifest = Read-Manifest
try {
    switch ($Command) {
        "start" { Start-Shio $manifest }
        "install" { Install-SpeechPack $manifest }
        "repair" { Install-SpeechPack $manifest -Repair }
        "doctor" {
            Assert-Platform
            $paths = Get-InstallPaths $manifest
            if (-not (Test-Path -LiteralPath $paths.Python)) { Fail "Speech Pack is not installed." }
            Invoke-Checked $paths.Python @("scripts\doctor_strict.py") $paths.Api
        }
        "status" {
            $paths = Get-InstallPaths $manifest
            Write-Host "Speech Pack installed: $(Test-Path -LiteralPath $paths.State)"
            Write-Host "Speech API healthy:   $(Test-Health $manifest)"
            Write-Host "Managed ownership:    $($null -ne (Read-Ownership))"
        }
        "stop" { Stop-OwnedApi }
        "open-logs" { Start-Process explorer.exe -ArgumentList "`"$LogsRoot`"" }
    }
    exit 0
} catch {
    Write-LauncherLog $_.Exception.Message
    exit 1
}
