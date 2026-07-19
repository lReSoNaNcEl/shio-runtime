Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$launcher = Join-Path $repoRoot "launcher\ShioLauncher.ps1"
$errors = $null
[void][Management.Automation.Language.Parser]::ParseFile($launcher, [ref]$null, [ref]$errors)
if ($errors.Count -gt 0) { throw ($errors | ForEach-Object Message) -join [Environment]::NewLine }
$text = Get-Content -Raw -LiteralPath $launcher
foreach ($required in @("Test-Health", "Get-PortOccupied", "Stop-OwnedApi", "startTime", "Wait-Process")) {
    if (-not $text.Contains($required)) { throw "Launcher lifecycle guard missing: $required" }
}
$pythonProbe = "import sys, struct; print(str(sys.version_info.major) + '.' + str(sys.version_info.minor) + ':' + str(struct.calcsize('P') * 8))"
$pythonVersion = & python.exe -c $pythonProbe
if ($LASTEXITCODE -ne 0 -or ([string]$pythonVersion).Trim() -ne "3.12:64") {
    throw "Launcher Python probe must detect Python 3.12 x64."
}
Write-Host "Launcher syntax and lifecycle guards verified."
