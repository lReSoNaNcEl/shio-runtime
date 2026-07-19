Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$manifest = Get-Content -Raw -Encoding UTF8 (Join-Path $repoRoot "launcher\release-manifest.json") | ConvertFrom-Json
$name = "Shio-Runtime-$($manifest.productVersion)-win-x64.zip"
$releaseRoot = Join-Path $repoRoot "release"
$zip = Join-Path $releaseRoot $name
if (-not (Test-Path -LiteralPath $zip)) { throw "Release ZIP is missing: $zip" }
$sha256 = [System.Security.Cryptography.SHA256]::Create()
$stream = [System.IO.File]::OpenRead($zip)
try {
    $hash = [System.BitConverter]::ToString($sha256.ComputeHash($stream)).Replace("-", "").ToLowerInvariant()
} finally {
    $stream.Dispose()
    $sha256.Dispose()
}
"$hash  $name" | Set-Content -LiteralPath "$zip.sha256" -Encoding ascii
"$hash  $name" | Set-Content -LiteralPath (Join-Path $releaseRoot "SHA256SUMS.txt") -Encoding ascii
Write-Host "SHA-256: $hash"
