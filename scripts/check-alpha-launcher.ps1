Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$launcher = Join-Path $repoRoot "launcher\ShioLauncher.ps1"
$errors = $null
$tokens = $null
$ast = [Management.Automation.Language.Parser]::ParseFile(
    $launcher,
    [ref]$tokens,
    [ref]$errors
)
if ($errors.Count -gt 0) { throw ($errors | ForEach-Object Message) -join [Environment]::NewLine }
$text = Get-Content -Raw -LiteralPath $launcher
foreach ($required in @(
    "Test-Health",
    "Get-PortOccupied",
    "Stop-OwnedApi",
    "startTime",
    "Wait-Process",
    "Invoke-CheckedWithRetry",
    "Remove-InstallStaging",
    "retrying in",
    "removing inactive staging directory"
)) {
    if (-not $text.Contains($required)) { throw "Launcher lifecycle guard missing: $required" }
}
$pythonProbe = "import sys, struct; print(str(sys.version_info.major) + '.' + str(sys.version_info.minor) + ':' + str(struct.calcsize('P') * 8))"
$pythonVersion = & python.exe -c $pythonProbe
if ($LASTEXITCODE -ne 0 -or ([string]$pythonVersion).Trim() -ne "3.12:64") {
    throw "Launcher Python probe must detect Python 3.12 x64."
}

function Import-LauncherFunction {
    param([string]$Name)
    $definition = $ast.Find({
        param($node)
        $node -is [Management.Automation.Language.FunctionDefinitionAst] -and
            $node.Name -eq $Name
    }, $true)
    if ($null -eq $definition) { throw "Launcher function is missing: $Name" }
    $bodyText = $definition.Body.Extent.Text
    $body = [scriptblock]::Create($bodyText.Substring(1, $bodyText.Length - 2))
    Set-Item -Path "function:script:$Name" -Value $body
}

function Write-LauncherLog { param([string]$Message) }
function Fail { param([string]$Message) throw $Message }

Import-LauncherFunction "Invoke-CheckedWithRetry"
Import-LauncherFunction "Remove-InstallStaging"

$retryRoot = Join-Path ([IO.Path]::GetTempPath()) "shio-launcher-retry-check-$PID"
New-Item -ItemType Directory -Force -Path $retryRoot | Out-Null
try {
    $counter = Join-Path $retryRoot "counter.txt"
    $probeScript = Join-Path $retryRoot "probe.ps1"
    Set-Content -LiteralPath $counter -Encoding ascii -Value "0"
    @'
param([string]$Counter)
$attempt = [int](Get-Content -Raw -LiteralPath $Counter) + 1
Set-Content -LiteralPath $Counter -Encoding ascii -Value $attempt
if ($attempt -lt 3) { exit 1 }
'@ | Set-Content -LiteralPath $probeScript -Encoding UTF8
    Invoke-CheckedWithRetry powershell.exe @(
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        "`"$probeScript`"",
        "`"$counter`""
    ) $retryRoot 3 0
    if ([int](Get-Content -Raw -LiteralPath $counter) -ne 3) {
        throw "Launcher retry did not run exactly three attempts."
    }

    $script:LocalRoot = Join-Path $retryRoot "local"
    $staging = Join-Path $script:LocalRoot "SpeechPack\test.staging.1"
    New-Item -ItemType Directory -Force -Path $staging | Out-Null
    Set-Content -LiteralPath (Join-Path $staging "partial.txt") -Value "partial"
    Remove-InstallStaging $staging
    if (Test-Path -LiteralPath $staging) {
        throw "Launcher staging cleanup did not remove the incomplete directory."
    }
} finally {
    if (Test-Path -LiteralPath $retryRoot) {
        Remove-Item -LiteralPath $retryRoot -Recurse -Force
    }
}
Write-Host "Launcher syntax and lifecycle guards verified."
