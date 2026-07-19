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
Write-Host "Launcher syntax and lifecycle guards verified."
