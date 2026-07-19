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
Copy-Item -LiteralPath (Join-Path $repoRoot "README-FIRST.txt") -Destination $bundleRoot
$launcherTarget = Join-Path $bundleRoot "launcher"
New-Item -ItemType Directory -Force -Path $launcherTarget | Out-Null
Copy-Item -LiteralPath (Join-Path $repoRoot "launcher\ShioLauncher.ps1") -Destination $launcherTarget
Copy-Item -LiteralPath (Join-Path $repoRoot "launcher\release-manifest.json") -Destination $launcherTarget
Copy-Item -LiteralPath (Join-Path $repoRoot "apps\desktop\release\win-unpacked") `
    -Destination (Join-Path $bundleRoot "desktop") -Recurse

$speechRoot = Join-Path $bundleRoot "speech-pack"
New-Item -ItemType Directory -Force -Path $speechRoot | Out-Null
$apiSource = Join-Path $repoRoot "services\api"
$apiTarget = Join-Path $speechRoot "services\api"
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $apiTarget) | Out-Null
& robocopy $apiSource $apiTarget /E /NFL /NDL /NJH /NJS /NP `
    /XD .venv venv __pycache__ voices .pytest_cache .ruff_cache `
    /XF .env *.pyc *.pyo *.wav *.sqlite *.sqlite3
if ($LASTEXITCODE -ge 8) { throw "Speech Pack copy failed with robocopy exit code $LASTEXITCODE." }

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
