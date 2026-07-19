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
    $forbiddenNames = @(".env", ".venv", ".git", "__pycache__")
    $bad = Get-ChildItem -LiteralPath $root -Recurse -Force | Where-Object {
        $forbiddenNames -contains $_.Name -or $_.Extension -in @(".pyc", ".pyo", ".wav") -or
        ($_.Name -eq "node_modules" -and
            -not $_.FullName.StartsWith(
                (Join-Path $root "desktop\resources\app.asar.unpacked\node_modules"),
                [StringComparison]::OrdinalIgnoreCase
            ))
    }
    if ($bad) { throw "Forbidden bundle content: $($bad[0].FullName)" }
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
