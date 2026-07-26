Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$workflow = Get-Content -Raw -LiteralPath (Join-Path $repoRoot ".github\workflows\release-alpha.yml")
$publisher = Get-Content -Raw -LiteralPath (Join-Path $repoRoot "scripts\publish-alpha-release.ps1")
$launcher = Get-Content -Raw -LiteralPath (Join-Path $repoRoot "launcher\ShioLauncher.ps1")
$bundle = Get-Content -Raw -LiteralPath (Join-Path $repoRoot "scripts\build-alpha-bundle.ps1")

if ($workflow -match "uses:\s+\S+@v\d") { throw "An official Action is not pinned to a SHA." }
if ($workflow.Contains("gh release edit") -or $workflow.Contains("--clobber") -or
    $publisher.Contains("--clobber")) {
    throw "Published release mutation command is present."
}
foreach ($required in @(
    "Published release `$Tag is immutable",
    "--draft --prerelease",
    "Draft asset verification failed",
    "-F draft=false"
)) {
    if (-not $publisher.Contains($required)) { throw "Publication guard missing: $required" }
}

$manifest = Get-Content -Raw -LiteralPath (Join-Path $repoRoot "launcher\release-manifest.json") |
    ConvertFrom-Json
$assetsRoot = Join-Path ([IO.Path]::GetTempPath()) "shio-release-check-$PID"
New-Item -ItemType Directory -Force -Path $assetsRoot | Out-Null
try {
    $zip = "Shio-Runtime-$($manifest.productVersion)-win-x64.zip"
    foreach ($name in @($zip, "$zip.sha256", "SHA256SUMS.txt")) {
        Set-Content -LiteralPath (Join-Path $assetsRoot $name) -Value "test"
    }
    $env:GITHUB_REPOSITORY = "owner/repo"
    $env:GITHUB_SHA = "1111111111111111111111111111111111111111"
    $env:RELEASE_COMMIT = ""
    $script:ghCalls = [Collections.Generic.List[string]]::new()
    $script:ghMode = "published"
    function gh {
        $global:LASTEXITCODE = 0
        $call = $args -join " "
        [void]$script:ghCalls.Add($call)
        if ($call -like "api repos/*/releases/tags/*") {
            if ($script:ghMode -eq "published") {
                return '{"id":41,"draft":false,"target_commitish":"1111111111111111111111111111111111111111"}'
            }
            return '{"id":42,"draft":true,"target_commitish":"1111111111111111111111111111111111111111"}'
        }
        if ($call.Contains("/releases/42/assets")) {
            return "[{`"name`":`"$zip`"},{`"name`":`"$zip.sha256`"},{`"name`":`"SHA256SUMS.txt`"}]"
        }
        if ($call -match "release (delete|create|upload)" -or $call.Contains("--method PATCH")) {
            return "{}"
        }
        throw "Unhandled mocked gh call: $call"
    }

    $publishedRejected = $false
    try {
        . (Join-Path $repoRoot "scripts\publish-alpha-release.ps1") `
            -Tag "v$($manifest.productVersion)" -AssetsDirectory $assetsRoot `
            -NotesFile (Join-Path $repoRoot "docs\RELEASE-NOTES-ALPHA.md")
    } catch {
        $publishedRejected = $_.Exception.Message.Contains("immutable")
    }
    if (-not $publishedRejected) { throw "Published release was not rejected." }
    if ($script:ghCalls.Where({ $_ -match "release (delete|upload|create)" }).Count -ne 0) {
        throw "Published release test attempted a mutation."
    }

    $script:ghCalls.Clear()
    $script:ghMode = "draft"
    . (Join-Path $repoRoot "scripts\publish-alpha-release.ps1") `
        -Tag "v$($manifest.productVersion)" -AssetsDirectory $assetsRoot `
        -NotesFile (Join-Path $repoRoot "docs\RELEASE-NOTES-ALPHA.md")
    foreach ($requiredCall in @("release delete", "release create", "release upload", "--method PATCH")) {
        if (-not $script:ghCalls.Where({ $_.Contains($requiredCall) })) {
            throw "Draft completion did not call: $requiredCall"
        }
    }
} finally {
    Remove-Item -LiteralPath $assetsRoot -Recurse -Force
}

foreach ($required in @(
    "serviceId -eq `$Manifest.speechPack.serviceId",
    "engines.f5.mode -eq `"real`"",
    "actualExecutable -eq",
    "Adopting an existing managed Speech API",
    "Repair refused: an unowned process",
    "prefetch_models.py`", `"--check",
    "Run 'Start Shio Runtime.cmd repair'"
)) {
    if (-not $launcher.Contains($required)) { throw "Launcher hardening guard missing: $required" }
}
if (-not $bundle.Contains("git -C `$repoRoot ls-files") -or $bundle.Contains("robocopy")) {
    throw "Speech Pack bundle is not assembled exclusively from tracked files."
}

$launcherErrors = $null
$launcherAst = [Management.Automation.Language.Parser]::ParseFile(
    (Join-Path $repoRoot "launcher\ShioLauncher.ps1"), [ref]$null, [ref]$launcherErrors
)
function Import-LauncherFunction {
    param([string]$Name)
    $definition = $launcherAst.Find({
        param($node)
        $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $Name
    }, $true)
    $bodyText = $definition.Body.Extent.Text
    Set-Item -Path "function:script:$Name" -Value (
        [scriptblock]::Create($bodyText.Substring(1, $bodyText.Length - 2))
    )
}
Import-LauncherFunction "Test-Health"
Import-LauncherFunction "Test-OwnedProcess"
Import-LauncherFunction "Get-HealthyApiClassification"
$healthManifest = [pscustomobject]@{
    speechPack = [pscustomobject]@{
        serviceId = "shio.speech-api"
        contractVersion = "1.1"
        version = $manifest.speechPack.version
    }
}
& {
    function Get-Health {
        return [pscustomobject]@{
            status = "ok"
            ready = $true
            serviceId = "wrong.service"
            contractVersion = "1.1"
            speechPackVersion = $manifest.speechPack.version
            asr = [pscustomobject]@{ ready = $true }
            engines = [pscustomobject]@{ f5 = [pscustomobject]@{ ready = $true; mode = "real" } }
        }
    }
    if (Test-Health $healthManifest) { throw "Incompatible service identity was accepted." }
}
& {
    function Test-Health { return $true }
    function Read-Ownership { return [pscustomobject]@{ pid = 100 } }
    function Test-OwnedProcess { return $true }
    $classification = Get-HealthyApiClassification $healthManifest ([pscustomobject]@{ Root = "C:\managed" })
    if ($classification -ne "managed-existing") {
        throw "Existing managed API was not adopted after launcher restart."
    }
}
& {
    function Get-Health {
        return [pscustomobject]@{
            status = "ok"
            ready = $true
            serviceId = "shio.speech-api"
            contractVersion = "1.1"
            speechPackVersion = $manifest.speechPack.version
            asr = [pscustomobject]@{ ready = $true }
            engines = [pscustomobject]@{ f5 = [pscustomobject]@{ ready = $true; mode = "mock" } }
        }
    }
    if (Test-Health $healthManifest) { throw "Mock F5 mode was accepted by the release launcher." }
}
& {
    function Get-Process {
        return [pscustomobject]@{
            StartTime = [datetime]::Parse("2026-01-01T00:00:00Z")
        }
    }
    function Get-ProcessExecutablePath { return "C:\unowned\python.exe" }
    $owned = [pscustomobject]@{
        schemaVersion = 2
        pid = 100
        startTime = "2026-01-01T00:00:00.0000000Z"
        executablePath = "C:\managed\.venv\Scripts\python.exe"
        installRoot = "C:\managed"
        speechPackVersion = $manifest.speechPack.version
        host = "127.0.0.1"
        port = 8000
        serviceId = "shio.speech-api"
    }
    if (Test-OwnedProcess $owned $healthManifest "C:\managed") {
        throw "Owned process path mismatch was accepted."
    }
}

$tagRoot = Join-Path ([IO.Path]::GetTempPath()) "shio-tag-check-$PID"
$origin = Join-Path $tagRoot "origin.git"
$work = Join-Path $tagRoot "work"
New-Item -ItemType Directory -Force -Path $tagRoot | Out-Null
try {
    & git init --bare $origin | Out-Null
    & git clone $origin $work | Out-Null
    & git -C $work config user.email "release-check@example.invalid"
    & git -C $work config user.name "Release Check"
    Set-Content -LiteralPath (Join-Path $work "main.txt") -Value "main"
    & git -C $work add main.txt
    & git -C $work commit -m "main" | Out-Null
    & git -C $work branch -M main
    & git -C $work push -u origin main | Out-Null
    & git -C $work switch -c outside | Out-Null
    Set-Content -LiteralPath (Join-Path $work "outside.txt") -Value "outside"
    & git -C $work add outside.txt
    & git -C $work commit -m "outside" | Out-Null
    & git -C $work tag -a v0.0.0-alpha.1 -m "outside"
    $env:GITHUB_REF_TYPE = "tag"
    $env:GITHUB_REF_NAME = "v0.0.0-alpha.1"
    $env:GITHUB_SHA = (& git -C $work rev-parse "v0.0.0-alpha.1^{}").Trim()
    $outsideRejected = $false
    Push-Location $work
    try {
        & (Join-Path $repoRoot "scripts\verify-alpha-tag.ps1")
    } catch {
        $outsideRejected = $_.Exception.Message.Contains("outside origin/main")
    } finally {
        Pop-Location
    }
    if (-not $outsideRejected) { throw "Tag outside main was not rejected." }
} finally {
    if (Test-Path -LiteralPath $tagRoot) {
        $resolvedTagRoot = [IO.Path]::GetFullPath($tagRoot)
        $resolvedTemp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
        if (-not $resolvedTagRoot.StartsWith($resolvedTemp, [StringComparison]::OrdinalIgnoreCase)) {
            throw "Unsafe tag-test cleanup path."
        }
        Remove-Item -LiteralPath $resolvedTagRoot -Recurse -Force
    }
}

Write-Host "Alpha release integrity focused checks passed."
