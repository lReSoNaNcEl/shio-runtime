param([switch]$Build)

$ErrorActionPreference = 'Stop'
$experimentRoot = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
$desktopRoot = Join-Path $experimentRoot 'apps/desktop'
foreach ($asset in @('.venv/Scripts/python.exe', '.cache/hand/SOMAHand.npz', '.cache/hand/SOMA_template_rig.usda')) {
    if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot $asset) -PathType Leaf)) {
        throw "MotionBricks research assets are missing: $asset. Follow motionbricks/README.md."
    }
}
if ($Build) {
    Push-Location -LiteralPath $experimentRoot
    try {
        & npm.cmd run build
        if ($LASTEXITCODE -ne 0) { throw 'Desktop build failed' }
    } finally { Pop-Location }
}
$previousRoot = $env:SHIO_MOTION_ROOT
try {
    $env:SHIO_MOTION_ROOT = $PSScriptRoot
    & npm.cmd --prefix $desktopRoot run start
    if ($LASTEXITCODE -ne 0) { throw 'Experimental Desktop exited with an error' }
} finally {
    $env:SHIO_MOTION_ROOT = $previousRoot
}
