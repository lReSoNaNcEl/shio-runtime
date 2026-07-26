Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$apiRoot = Join-Path $repoRoot "apps\api"
$tempBase = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
$tempRoot = Join-Path $tempBase ("shio-api-lock-" + [guid]::NewGuid().ToString("N"))
$venvPython = Join-Path $tempRoot "Scripts\python.exe"

function Invoke-Checked {
    param(
        [Parameter(Mandatory = $true)][string]$Command,
        [Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments
    )
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed with exit code ${LASTEXITCODE}: $Command $($Arguments -join ' ')"
    }
}

try {
    $version = (& py -3.12 -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')").Trim()
    if ($LASTEXITCODE -ne 0 -or $version -ne "3.12") {
        throw "Python 3.12 is required to generate API dependency locks."
    }

    Invoke-Checked py -3.12 -m venv $tempRoot
    Invoke-Checked $venvPython -m pip install --upgrade "pip>=25.3,<26"
    Invoke-Checked $venvPython -m pip install -r (Join-Path $apiRoot "requirements-tools.txt")

    Push-Location $apiRoot
    try {
        Invoke-Checked $venvPython -m piptools compile `
            --resolver=backtracking `
            --strip-extras `
            --allow-unsafe `
            --output-file=requirements.lock.txt `
            requirements.txt `
            requirements-torch-cu128.txt
        Invoke-Checked $venvPython -m piptools compile `
            --resolver=backtracking `
            --strip-extras `
            --allow-unsafe `
            --output-file=requirements-dev.lock.txt `
            requirements-dev.txt `
            requirements-torch-cu128.txt
    }
    finally {
        Pop-Location
    }

    foreach ($lockName in @("requirements.lock.txt", "requirements-dev.lock.txt")) {
        $lockPath = Join-Path $apiRoot $lockName
        $content = Get-Content -Raw -LiteralPath $lockPath
        if ($content -match [regex]::Escape($tempRoot) -or $content -match "(?m)^\s*(file:|[-]e\s+|[-]{2}editable)") {
            throw "$lockName contains a local path or editable dependency."
        }
    }
}
finally {
    if (Test-Path -LiteralPath $tempRoot) {
        $resolvedTemp = [System.IO.Path]::GetFullPath($tempRoot)
        if (-not $resolvedTemp.StartsWith($tempBase, [System.StringComparison]::OrdinalIgnoreCase) -or
            -not ([System.IO.Path]::GetFileName($resolvedTemp)).StartsWith("shio-api-lock-")) {
            throw "Refusing to remove unexpected temporary directory: $resolvedTemp"
        }
        [System.IO.Directory]::Delete($resolvedTemp, $true)
    }
}
