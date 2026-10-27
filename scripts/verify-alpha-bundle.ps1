param([string]$BundlePath, [switch]$ExperimentalWorktree)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$manifest = Get-Content -Raw -Encoding UTF8 (Join-Path $repoRoot "launcher\release-manifest.json") | ConvertFrom-Json
$expectedName = "Shio-Runtime-$($manifest.productVersion)-win-x64"
if ($ExperimentalWorktree) { $expectedName += '-ardy-fish-experiment' }
if (-not $BundlePath) { $BundlePath = Join-Path $repoRoot "release\$expectedName.zip" }
if (-not (Test-Path -LiteralPath $BundlePath)) { throw "Bundle not found: $BundlePath" }

$verifyRoot = Join-Path $repoRoot "release\alpha-verify"
function Remove-VerifyScratch {
    $resolved = [IO.Path]::GetFullPath($verifyRoot)
    if (-not $resolved.StartsWith([IO.Path]::GetFullPath((Join-Path $repoRoot 'release')) + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe verification path.' }
    if ([IO.Directory]::Exists($resolved)) { [IO.Directory]::Delete('\\?\' + $resolved, $true) }
}
Remove-VerifyScratch
New-Item -ItemType Directory -Force -Path $verifyRoot | Out-Null
try {
    & tar.exe -xf $BundlePath -C $verifyRoot
    if ($LASTEXITCODE -ne 0) { throw 'Bundle extraction failed.' }
    $root = Join-Path $verifyRoot $expectedName
    $required = @(
        "Start Shio Runtime.cmd",
        "README-FIRST.txt",
        "launcher\ShioLauncher.ps1",
        "launcher\release-manifest.json",
        "desktop\Shio Runtime.exe",
        "desktop\resources\motion-source\worker.py",
        "desktop\resources\motion-source\backend.py",
        "desktop\resources\motion-source\research-pins.json",
        "desktop\resources\motion-source\motion-profiles.json",
        "desktop\resources\motion-source\requirements-research.lock.txt",
        "speech-pack\api\requirements.lock.txt",
        "speech-pack\api\requirements-torch-cu128.txt",
        "speech-pack\api\.env.release",
        "speech-pack\api\scripts\prefetch_models.py",
        "speech-pack\api\scripts\doctor_strict.py",
        "docs\ALPHA-INSTALL.md",
        "docs\ALPHA-TROUBLESHOOTING.md"
        "docs\EXPERIMENT-ARDY-FISH.md"
    )
    foreach ($relative in $required) {
        if (-not (Test-Path -LiteralPath (Join-Path $root $relative))) { throw "Missing bundle file: $relative" }
    }
    $bundledManifest = Get-Content -Raw -Encoding UTF8 (Join-Path $root "launcher\release-manifest.json") | ConvertFrom-Json
    if ($bundledManifest.productVersion -ne $manifest.productVersion -or
        $bundledManifest.speechPack.version -ne $manifest.productVersion) {
        throw "Bundle version mismatch."
    }
    $readme = Get-Content -Raw -Encoding UTF8 (Join-Path $root "README-FIRST.txt")
    if (-not $readme.Contains($manifest.productVersion)) {
        throw "Generated README does not contain the manifest product version."
    }
    if ($readme -match "{{[^{}]+}}") {
        throw "Generated README contains an unresolved template placeholder."
    }
    foreach ($requiredReadmeText in @(
        "Windows 11 x64",
        "NVIDIA",
        "Python 3.12",
        "unsigned technical alpha",
        "first start",
        "Start Shio Runtime.cmd",
        "doctor",
        "repair",
        "status",
        "stop",
        "open-logs",
        "docs\ALPHA-INSTALL.md",
        "docs\ALPHA-TROUBLESHOOTING.md"
    )) {
        if (-not $readme.Contains($requiredReadmeText)) {
            throw "Generated README is missing required text: $requiredReadmeText"
        }
    }
    if (Test-Path -LiteralPath (Join-Path $root "launcher\assets\README-FIRST.template.txt")) {
        throw "Release README source template leaked into the bundle."
    }
    $forbiddenNames = @(
        ".env", ".env.example", ".venv", ".git", "__pycache__", "coverage",
        ".coverage", ".pytest_cache", ".ruff_cache", "voice_repository_status.json"
    )
    $forbiddenExtensions = @(
        ".key", ".pem", ".pfx", ".p12", ".cer", ".crt", ".log", ".db",
        ".sqlite", ".sqlite3", ".ckpt", ".safetensors", ".pt", ".pth", ".onnx",
        ".tmp", ".temp", ".coverage", ".vrma"
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
    foreach ($forbiddenPath in @("speech-pack\services", "services\api", "apps\api")) {
        if (Test-Path -LiteralPath (Join-Path $root $forbiddenPath)) {
            throw "Stale repository layout leaked into the bundle: $forbiddenPath"
        }
    }
    $apiRoot = Join-Path $root "speech-pack\api"
    $tracked = & git -C $repoRoot ls-files -- "apps/api"
    if ($ExperimentalWorktree) { $tracked = & git -C $repoRoot ls-files --cached --others --exclude-standard -- "apps/api" }
    if ($LASTEXITCODE -ne 0) { throw "Could not enumerate tracked API files." }
    $trackedSet = @{}
    foreach ($item in $tracked) {
        $trackedSet[$item.Substring("apps/api/".Length).Replace("/", "\")] = $true
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
        # Upstream documentation contains illustrative C:\Users\me paths; it is
        # not locally generated application configuration or developer data.
        if ($file.FullName.Contains('\app.asar.unpacked\node_modules\')) { continue }
        $text = Get-Content -Raw -ErrorAction SilentlyContinue -LiteralPath $file.FullName
        if ($text -match "[A-Za-z]:\\(Users|Web)\\") { throw "Absolute developer path found: $($file.FullName)" }
        if ($text -match "(?i)(api[_-]?key|github[_-]?token)\s*[:=]\s*[A-Za-z0-9_-]{12,}") {
            throw "Possible credential found: $($file.FullName)"
        }
    }
    Write-Host "Verified: $BundlePath"
} finally {
    Remove-VerifyScratch
}
