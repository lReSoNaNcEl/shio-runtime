Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$manifest = Get-Content -Raw -Encoding UTF8 (Join-Path $repoRoot "launcher\release-manifest.json") | ConvertFrom-Json
$name = "Shio-Runtime-$($manifest.productVersion)-win-x64"
$releaseRoot = Join-Path $repoRoot "release"
$desktopReleaseRoot = Join-Path $repoRoot "apps\desktop\release"
$stageRoot = Join-Path ([IO.Path]::GetTempPath()) "shio-alpha-staging-$PID"
$bundleRoot = Join-Path $stageRoot $name
$zipPath = Join-Path $releaseRoot "$name.zip"

try {
if (Test-Path -LiteralPath $stageRoot) {
    $resolved = [IO.Path]::GetFullPath($stageRoot)
    if (-not $resolved.StartsWith([IO.Path]::GetFullPath([IO.Path]::GetTempPath()))) { throw "Unsafe staging path." }
    Remove-Item -LiteralPath $stageRoot -Recurse -Force
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
Copy-Item -LiteralPath (Join-Path $repoRoot "apps\desktop\release\win-unpacked") `
    -Destination (Join-Path $bundleRoot "desktop") -Recurse

$speechRoot = Join-Path $bundleRoot "speech-pack"
New-Item -ItemType Directory -Force -Path $speechRoot | Out-Null
$apiSource = Join-Path $repoRoot "apps\api"
$apiTarget = Join-Path $speechRoot "api"
if (-not (Test-Path -LiteralPath $apiSource -PathType Container)) {
    throw "Canonical Speech API source is missing: $apiSource"
}
New-Item -ItemType Directory -Force -Path $apiTarget | Out-Null
$trackedApiFiles = & git -C $repoRoot ls-files -- "apps/api"
if ($LASTEXITCODE -ne 0) { throw "Could not enumerate tracked Speech Pack files." }
if ($trackedApiFiles.Where({ -not $_.StartsWith("apps/api/") }).Count -ne 0) {
    throw "Tracked Speech Pack source escaped the canonical apps/api prefix."
}
$releaseFiles = $trackedApiFiles | Where-Object {
    $_ -match '^apps/api/app/' -or
    $_ -match '^apps/api/web/' -or
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
    $relative = $tracked.Substring("apps/api/".Length)
    $destination = Join-Path $apiTarget $relative
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
    Copy-Item -LiteralPath (Join-Path $repoRoot $tracked) -Destination $destination
}

$docsTarget = Join-Path $bundleRoot "docs"
New-Item -ItemType Directory -Force -Path $docsTarget | Out-Null
Copy-Item (Join-Path $repoRoot "docs\ALPHA-INSTALL.md") $docsTarget
Copy-Item (Join-Path $repoRoot "docs\ALPHA-TROUBLESHOOTING.md") $docsTarget

if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }
Compress-Archive -LiteralPath $bundleRoot -DestinationPath $zipPath -CompressionLevel Optimal
Write-Host "Built: $zipPath"
} finally {
    if (Test-Path -LiteralPath $stageRoot) {
        Remove-Item -LiteralPath $stageRoot -Recurse -Force
    }
    if (Test-Path -LiteralPath $desktopReleaseRoot) {
        Remove-Item -LiteralPath $desktopReleaseRoot -Recurse -Force
    }
}
