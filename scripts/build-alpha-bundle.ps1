param([switch]$ExperimentalWorktree)
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$manifest = Get-Content -Raw -Encoding UTF8 (Join-Path $repoRoot "launcher\release-manifest.json") | ConvertFrom-Json
$name = "Shio-Runtime-$($manifest.productVersion)-win-x64"
if ($ExperimentalWorktree) { $name += '-ardy-fish-experiment' }
$releaseRoot = Join-Path $repoRoot "release"
$desktopReleaseRoot = Join-Path $repoRoot "apps\desktop\release"
$stageRoot = Join-Path $releaseRoot ".staging.$PID"
$bundleRoot = Join-Path $stageRoot $name
$zipPath = Join-Path $releaseRoot "$name.zip"

function Remove-BundleScratch {
    $resolved = [IO.Path]::GetFullPath($stageRoot)
    if (-not $resolved.StartsWith([IO.Path]::GetFullPath($releaseRoot) + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe bundle staging path.' }
    if ([IO.Directory]::Exists($resolved)) { [IO.Directory]::Delete('\\?\' + $resolved, $true) }
}

try {
if (Test-Path -LiteralPath $stageRoot) {
    $resolved = [IO.Path]::GetFullPath($stageRoot)
    if (-not $resolved.StartsWith([IO.Path]::GetFullPath($releaseRoot) + '\', [StringComparison]::OrdinalIgnoreCase)) { throw "Unsafe staging path." }
    Remove-BundleScratch
}
New-Item -ItemType Directory -Force -Path $bundleRoot | Out-Null
New-Item -ItemType Directory -Force -Path $releaseRoot | Out-Null

Push-Location $repoRoot
try {
    & npm run desktop:pack
    if ($LASTEXITCODE -ne 0) { throw "Desktop packaging failed." }
} finally { Pop-Location }

Copy-Item -LiteralPath (Join-Path $repoRoot "launcher\Start Shio Runtime.cmd") -Destination $bundleRoot
$readmeTemplatePath = Join-Path $repoRoot "launcher\assets\README-FIRST.template.txt"
$readmeTemplate = Get-Content -Raw -Encoding UTF8 -LiteralPath $readmeTemplatePath
if (-not $readmeTemplate.Contains("{{PRODUCT_VERSION}}")) {
    throw "Release README template is missing the required {{PRODUCT_VERSION}} placeholder."
}
$renderedReadme = $readmeTemplate.Replace("{{PRODUCT_VERSION}}", $manifest.productVersion)
if ($renderedReadme -match "{{[^{}]+}}") {
    throw "Release README contains an unresolved template placeholder."
}
[IO.File]::WriteAllText(
    (Join-Path $bundleRoot "README-FIRST.txt"),
    $renderedReadme,
    [Text.UTF8Encoding]::new($false)
)
$launcherTarget = Join-Path $bundleRoot "launcher"
New-Item -ItemType Directory -Force -Path $launcherTarget | Out-Null
Copy-Item -LiteralPath (Join-Path $repoRoot "launcher\ShioLauncher.ps1") -Destination $launcherTarget
Copy-Item -LiteralPath (Join-Path $repoRoot "launcher\release-manifest.json") -Destination $launcherTarget
# Windows PowerShell 5 Copy-Item fails on nested dependency paths over MAX_PATH.
& robocopy.exe (Join-Path $repoRoot 'apps\desktop\release\win-unpacked') (Join-Path $bundleRoot 'desktop') /E /COPY:DAT /DCOPY:DAT /R:0 /W:0 /NFL /NDL /NJH /NJS | Out-Null
if ($LASTEXITCODE -gt 7) { throw "Desktop bundle copy failed: $LASTEXITCODE" }

$speechRoot = Join-Path $bundleRoot "speech-pack"
New-Item -ItemType Directory -Force -Path $speechRoot | Out-Null
$apiSource = Join-Path $repoRoot "apps\api"
$apiTarget = Join-Path $speechRoot "api"
if (-not (Test-Path -LiteralPath $apiSource -PathType Container)) {
    throw "Canonical Speech API source is missing: $apiSource"
}
New-Item -ItemType Directory -Force -Path $apiTarget | Out-Null
$trackedApiFiles = & git -C $repoRoot ls-files -- "apps/api"
if ($ExperimentalWorktree) { $trackedApiFiles = & git -C $repoRoot ls-files --cached --others --exclude-standard -- "apps/api" }
if ($LASTEXITCODE -ne 0) { throw "Could not enumerate tracked Speech Pack files." }
if ($trackedApiFiles.Where({ -not $_.StartsWith("apps/api/") }).Count -ne 0) {
    throw "Tracked Speech Pack source escaped the canonical apps/api prefix."
}
$releaseFiles = $trackedApiFiles | Where-Object {
    $_ -match '^apps/api/app/.*\.py$' -or
    $_ -match '^apps/api/web/.*\.(html|js|css)$' -or
    $_ -match '^apps/api/licenses/.*\.(txt|md)$' -or
    $_ -in @(
        "apps/api/.env.release",
        "apps/api/emotion_manifest.json",
        "apps/api/voice_manifest.json",
        "apps/api/requirements.lock.txt",
        "apps/api/requirements-torch-cu128.txt",
        "apps/api/scripts/doctor_strict.py",
        "apps/api/scripts/prefetch_models.py",
        "apps/api/scripts/sync_voices.py"
    )
}
$requiredReleaseSources = @(
    "apps/api/.env.release",
    "apps/api/emotion_manifest.json",
    "apps/api/voice_manifest.json",
    "apps/api/requirements.lock.txt",
    "apps/api/requirements-torch-cu128.txt",
    "apps/api/scripts/doctor_strict.py",
    "apps/api/scripts/prefetch_models.py",
    "apps/api/scripts/sync_voices.py"
)
foreach ($requiredSource in $requiredReleaseSources) {
    if ($requiredSource -notin $releaseFiles) {
        throw "Required tracked Speech Pack source is missing: $requiredSource"
    }
}
foreach ($tracked in $releaseFiles) {
    if (-not (Test-Path -LiteralPath (Join-Path $repoRoot $tracked) -PathType Leaf)) { continue }
    $relative = $tracked.Substring("apps/api/".Length)
    $destination = Join-Path $apiTarget $relative
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
    Copy-Item -LiteralPath (Join-Path $repoRoot $tracked) -Destination $destination
}

$docsTarget = Join-Path $bundleRoot "docs"
New-Item -ItemType Directory -Force -Path $docsTarget | Out-Null
Copy-Item (Join-Path $repoRoot "docs\ALPHA-INSTALL.md") $docsTarget
Copy-Item (Join-Path $repoRoot "docs\ALPHA-TROUBLESHOOTING.md") $docsTarget
Copy-Item (Join-Path $repoRoot "docs\EXPERIMENT-ARDY-FISH.md") $docsTarget

if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }
& tar.exe -a -cf $zipPath -C $stageRoot $name
if ($LASTEXITCODE -ne 0) { throw 'Bundle compression failed.' }
Write-Host "Built: $zipPath"
} finally {
    if (Test-Path -LiteralPath $stageRoot) {
        Remove-BundleScratch
    }
}
