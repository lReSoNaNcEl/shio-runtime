Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$apiEnv = Join-Path $repoRoot "services\api\.env"
$apiEnvExample = Join-Path $repoRoot "services\api\.env.example"

function Get-CommandVersion {
    param(
        [Parameter(Mandatory = $true)][string]$Command,
        [Parameter(Mandatory = $true)][string[]]$Arguments
    )
    try {
        $value = (& $Command @Arguments 2>$null).Trim()
        if ($LASTEXITCODE -ne 0) {
            throw "exit $LASTEXITCODE"
        }
        return $value
    }
    catch {
        throw "Required command is unavailable: $Command"
    }
}

function Invoke-Npm {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)
    & npm @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "npm $($Arguments -join ' ') failed with exit code $LASTEXITCODE."
    }
}

if ($env:OS -ne "Windows_NT" -or -not [Environment]::Is64BitOperatingSystem -or
    [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture -ne
    [System.Runtime.InteropServices.Architecture]::X64) {
    throw "Alpha setup requires Windows x64."
}

$nodeVersion = Get-CommandVersion node @("--version")
if ($nodeVersion -notmatch "^v24\.") {
    throw "Node.js 24.x is required. Detected: $nodeVersion"
}

$npmVersion = Get-CommandVersion npm @("--version")
if ($npmVersion -notmatch "^11\.") {
    throw "npm 11.x is required. Detected: $npmVersion"
}

$pythonVersion = Get-CommandVersion py @("-3.12", "-c", "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
if ($pythonVersion -ne "3.12") {
    throw "Python 3.12 is required. Detected: $pythonVersion"
}

if (-not (Test-Path -LiteralPath $apiEnv)) {
    Copy-Item -LiteralPath $apiEnvExample -Destination $apiEnv
    Write-Host "Created services/api/.env from .env.example."
}
else {
    Write-Host "Keeping existing services/api/.env."
}

Push-Location $repoRoot
try {
    Invoke-Npm @("run", "api:install:alpha")
    Invoke-Npm @("run", "api:voices:sync")
    Invoke-Npm @("run", "api:doctor:strict")
}
finally {
    Pop-Location
}

Write-Host ""
Write-Host "Alpha setup complete."
Write-Host "Start API:     npm run api:dev"
$manifest = Get-Content -Raw -Encoding UTF8 (Join-Path $repoRoot "launcher\release-manifest.json") | ConvertFrom-Json
Write-Host "Start Desktop: extract Shio-Runtime-$($manifest.productVersion)-win-x64.zip and run Shio Runtime.exe"
