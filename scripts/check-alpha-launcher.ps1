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
    "Invoke-StrictDoctor",
    "Enter-LauncherLock",
    "Exit-LauncherLock",
    "SHIO_API_VENV",
    "Another Shio Runtime launcher is already running",
    "Command is still running",
    "Command timed out",
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

function Write-LauncherLog { param([string]$Message) Write-Host "[launcher-check] $Message" }
function Fail { param([string]$Message) throw $Message }

Import-LauncherFunction "Invoke-CheckedWithRetry"
Import-LauncherFunction "Enter-LauncherLock"
Import-LauncherFunction "Exit-LauncherLock"
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
    Invoke-CheckedWithRetry `
        -File powershell.exe `
        -Arguments @(
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            "`"$probeScript`"",
            "`"$counter`""
        ) `
        -WorkingDirectory $retryRoot `
        -MaxAttempts 3 `
        -RetryDelaySeconds 0 `
        -TimeoutSeconds 30 `
        -ProgressIntervalSeconds 1
    if ([int](Get-Content -Raw -LiteralPath $counter) -ne 3) {
        throw "Launcher retry did not run exactly three attempts."
    }

    $timeoutPid = Join-Path $retryRoot "timeout-pid.txt"
    $timeoutProbe = Join-Path $retryRoot "timeout-probe.ps1"
    @'
param([string]$PidPath)
Set-Content -LiteralPath $PidPath -Encoding ascii -Value $PID
Start-Sleep -Seconds 30
'@ | Set-Content -LiteralPath $timeoutProbe -Encoding UTF8
    $timedOut = $false
    try {
        Invoke-CheckedWithRetry `
            -File powershell.exe `
            -Arguments @(
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                "`"$timeoutProbe`"",
                "`"$timeoutPid`""
            ) `
            -WorkingDirectory $retryRoot `
            -MaxAttempts 1 `
            -RetryDelaySeconds 0 `
            -TimeoutSeconds 1 `
            -ProgressIntervalSeconds 1
    } catch {
        $timedOut = $_.Exception.Message.Contains("after 1 attempts")
    }
    if (-not $timedOut) {
        throw "Launcher timeout did not fail the hung command."
    }
    $timedOutProcessId = [int](Get-Content -Raw -LiteralPath $timeoutPid)
    if ($null -ne (Get-Process -Id $timedOutProcessId -ErrorAction SilentlyContinue)) {
        throw "Launcher timeout left the owned command running."
    }

    $script:LauncherMutexName = "Local\ShioRuntimeLauncherCheck$PID"
    $heldMutex = [Threading.Mutex]::new($true, $script:LauncherMutexName)
    try {
        $lockFailed = $false
        $lockProbe = Start-Job -ScriptBlock {
            param($LauncherPath, $MutexName)
            $script:LauncherMutexName = $MutexName
            $script:LauncherMutex = $null
            $script:LauncherMutexHeld = $false
            function Write-LauncherLog { param([string]$Message) }
            function Fail { param([string]$Message) throw $Message }
            $errors = $null
            $ast = [Management.Automation.Language.Parser]::ParseFile(
                $LauncherPath, [ref]$null, [ref]$errors
            )
            foreach ($name in @("Enter-LauncherLock", "Exit-LauncherLock")) {
                $definition = $ast.Find({
                    param($node)
                    $node -is [Management.Automation.Language.FunctionDefinitionAst] -and
                        $node.Name -eq $name
                }, $true)
                $bodyText = $definition.Body.Extent.Text
                $body = [scriptblock]::Create($bodyText.Substring(1, $bodyText.Length - 2))
                Set-Item -Path "function:script:$name" -Value $body
            }
            try {
                Enter-LauncherLock
                return "unexpected"
            } catch {
                return $_.Exception.Message
            } finally {
                Exit-LauncherLock
            }
        } -ArgumentList $launcher, $script:LauncherMutexName
        $lockResult = Receive-Job -Job $lockProbe -Wait -AutoRemoveJob
        $lockFailed = ([string]$lockResult).Contains("already running")
        if (-not $lockFailed) {
            throw "Launcher single-instance lock did not reject a concurrent process."
        }
    } finally {
        $heldMutex.ReleaseMutex()
        $heldMutex.Dispose()
    }

    $script:LocalRoot = Join-Path $retryRoot "local"
    $staging = Join-Path $script:LocalRoot "SpeechPack\test.staging.1"
    New-Item -ItemType Directory -Force -Path $staging | Out-Null
    Set-Content -LiteralPath (Join-Path $staging "partial.txt") -Value "partial"
    Remove-InstallStaging $staging
    if (Test-Path -LiteralPath $staging) {
        throw "Launcher staging cleanup did not remove the incomplete directory."
    }

    $junctionTarget = Join-Path $retryRoot "persistent-voices"
    New-Item -ItemType Directory -Force -Path $junctionTarget | Out-Null
    Set-Content -LiteralPath (Join-Path $junctionTarget "reference.txt") -Value "persistent"
    New-Item -ItemType Directory -Force -Path (Join-Path $staging "api") | Out-Null
    New-Item -ItemType Junction -Path (Join-Path $staging "api\voices") `
        -Target $junctionTarget | Out-Null
    Remove-InstallStaging $staging
    if (Test-Path -LiteralPath $staging) {
        throw "Launcher staging cleanup did not remove a staging directory with a voice junction."
    }
    if (-not (Test-Path -LiteralPath (Join-Path $junctionTarget "reference.txt"))) {
        throw "Launcher staging cleanup removed persistent voice data behind the junction."
    }
} finally {
    if (Test-Path -LiteralPath $retryRoot) {
        Remove-Item -LiteralPath $retryRoot -Recurse -Force
    }
}
Write-Host "Launcher syntax and lifecycle guards verified."
