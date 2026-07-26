param([string]$BundlePath)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$manifest = Get-Content -Raw -Encoding UTF8 (Join-Path $repoRoot "launcher\release-manifest.json") | ConvertFrom-Json
$expectedName = "Shio-Runtime-$($manifest.productVersion)-win-x64"
if (-not $BundlePath) { $BundlePath = Join-Path $repoRoot "release\$expectedName.zip" }
if (-not (Test-Path -LiteralPath $BundlePath)) { throw "Bundle not found: $BundlePath" }

$verifyRoot = Join-Path $repoRoot "release\alpha-verify"
if (Test-Path -LiteralPath $verifyRoot) { Remove-Item -LiteralPath $verifyRoot -Recurse -Force }
New-Item -ItemType Directory -Force -Path $verifyRoot | Out-Null
try {
    Expand-Archive -LiteralPath $BundlePath -DestinationPath $verifyRoot
    $root = Join-Path $verifyRoot $expectedName
    $required = @(
        "Start Shio Runtime.cmd",
        "README-FIRST.txt",
        "launcher\ShioLauncher.ps1",
        "launcher\release-manifest.json",
        "desktop\Shio Runtime.exe",
        "speech-pack\services\api\requirements.lock.txt",
        "speech-pack\services\api\requirements-torch-cu128.txt",
        "speech-pack\services\api\.env.release",
        "speech-pack\services\api\scripts\prefetch_models.py",
        "speech-pack\services\api\scripts\doctor_strict.py",
        "docs\ALPHA-INSTALL.md",
        "docs\ALPHA-TROUBLESHOOTING.md"
    )
    foreach ($relative in $required) {
        if (-not (Test-Path -LiteralPath (Join-Path $root $relative))) { throw "Missing bundle file: $relative" }
    }
    $bundledManifest = Get-Content -Raw -Encoding UTF8 (Join-Path $root "launcher\release-manifest.json") | ConvertFrom-Json
    if ($bundledManifest.productVersion -ne $manifest.productVersion -or
        $bundledManifest.speechPack.version -ne $manifest.productVersion) {
        throw "Bundle version mismatch."
    }
    $forbiddenNames = @(
        ".env", ".env.example", ".venv", ".git", "__pycache__", "coverage",
        ".coverage", ".pytest_cache", ".ruff_cache", "voice_repository_status.json"
    )
    $forbiddenExtensions = @(
        ".key", ".pem", ".pfx", ".p12", ".cer", ".crt", ".log", ".db",
        ".sqlite", ".sqlite3", ".ckpt", ".safetensors", ".pt", ".pth", ".onnx",
        ".tmp", ".temp", ".coverage"
    )
    $bad = Get-ChildItem -LiteralPath $root -Recurse -Force | Where-Object {
        $forbiddenNames -contains $_.Name -or
        $_.Extension -in ($forbiddenExtensions + @(".pyc", ".pyo", ".wav")) -or
        ($_.Name -eq "node_modules" -and
            -not $_.FullName.StartsWith(
                (Join-Path $root "desktop\resources\app.asar.unpacked\node_modules"),
                [StringComparison]::OrdinalIgnoreCase
            ))
    }
    if ($bad) { throw "Forbidden bundle content: $($bad[0].FullName)" }
    $apiRoot = Join-Path $root "speech-pack\services\api"
    $tracked = & git -C $repoRoot ls-files -- "services/api"
    if ($LASTEXITCODE -ne 0) { throw "Could not enumerate tracked API files." }
    $trackedSet = @{}
    foreach ($item in $tracked) {
        $trackedSet[$item.Substring("services/api/".Length).Replace("/", "\")] = $true
    }
    foreach ($file in Get-ChildItem -LiteralPath $apiRoot -Recurse -File -Force) {
        $relative = $file.FullName.Substring($apiRoot.Length + 1)
        if (-not $trackedSet.ContainsKey($relative)) {
            throw "Untracked Speech Pack file found: $relative"
        }
    }
    $textFiles = Get-ChildItem -LiteralPath $root -Recurse -File |
        Where-Object { $_.Extension -in @(".txt", ".md", ".json", ".ps1", ".cmd", ".py") }
    foreach ($file in $textFiles) {
        $text = Get-Content -Raw -ErrorAction SilentlyContinue -LiteralPath $file.FullName
        if ($text -match "[A-Za-z]:\\(Users|Web)\\") { throw "Absolute developer path found: $($file.FullName)" }
        if ($text -match "(?i)(api[_-]?key|github[_-]?token)\s*[:=]\s*[A-Za-z0-9_-]{12,}") {
            throw "Possible credential found: $($file.FullName)"
        }
    }
    Write-Host "Verified: $BundlePath"
} finally {
    if (Test-Path -LiteralPath $verifyRoot) { Remove-Item -LiteralPath $verifyRoot -Recurse -Force }
}
