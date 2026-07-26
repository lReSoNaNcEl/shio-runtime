param(
    [Parameter(Mandatory = $true)][string]$Tag,
    [Parameter(Mandatory = $true)][string]$AssetsDirectory,
    [Parameter(Mandatory = $true)][string]$NotesFile
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if (-not $env:GITHUB_REPOSITORY) { throw "GITHUB_REPOSITORY is required." }
$targetCommit = if ($env:RELEASE_COMMIT) { $env:RELEASE_COMMIT } else { $env:GITHUB_SHA }
if (-not $targetCommit) { throw "RELEASE_COMMIT or GITHUB_SHA is required." }

$repoRoot = Split-Path -Parent $PSScriptRoot
$manifest = Get-Content -Raw -Encoding UTF8 (Join-Path $repoRoot "launcher\release-manifest.json") |
    ConvertFrom-Json
$baseName = "Shio-Runtime-$($manifest.productVersion)-win-x64.zip"
$expectedNames = @($baseName, "$baseName.sha256", "SHA256SUMS.txt") | Sort-Object
$assets = Get-ChildItem -LiteralPath $AssetsDirectory -File
$actualNames = @($assets.Name | Sort-Object)
if (($actualNames -join "`n") -ne ($expectedNames -join "`n")) {
    throw "Release assets do not match the exact expected names. Expected: $($expectedNames -join ', ')"
}

function Get-ReleaseByTag {
    $serializedReleases = @(gh api --paginate `
            "repos/$env:GITHUB_REPOSITORY/releases?per_page=100" `
            --jq ".[] | @json")
    if ($LASTEXITCODE -ne 0) { throw "Could not inspect existing releases." }
    $matches = @(
        $serializedReleases |
            ForEach-Object { $_ | ConvertFrom-Json } |
            Where-Object { $_.tag_name -eq $Tag }
    )
    if ($matches.Count -gt 1) { throw "Multiple releases unexpectedly use tag $Tag." }
    return $matches | Select-Object -First 1
}

$release = Get-ReleaseByTag
if ($null -ne $release -and -not $release.draft) {
    throw "Published release $Tag is immutable. Create and qualify a new version."
}
if ($null -ne $release) {
    if ($release.target_commitish -ne $targetCommit) {
        throw "Draft release $Tag targets $($release.target_commitish), not $targetCommit."
    }
    Write-Host "Recreating unpublished draft $Tag to resume from a clean asset set."
    gh api --method DELETE "repos/$env:GITHUB_REPOSITORY/releases/$($release.id)" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Could not delete the unpublished draft." }
}

$title = "Shio Runtime v$($Tag.TrimStart('v'))"
gh release create $Tag --draft --prerelease --target $targetCommit --title $title --notes-file $NotesFile
if ($LASTEXITCODE -ne 0) { throw "Could not create draft prerelease." }

$draft = Get-ReleaseByTag
if ($null -eq $draft -or -not $draft.draft -or $draft.target_commitish -ne $targetCommit) {
    throw "Release changed while the draft was being prepared; publication refused."
}
foreach ($asset in $assets) {
    $contentType = if ($asset.Extension -eq ".zip") { "application/zip" } else { "text/plain" }
    $encodedName = [Uri]::EscapeDataString($asset.Name)
    $uploadUrl = "https://uploads.github.com/repos/$env:GITHUB_REPOSITORY/releases/" +
        "$($draft.id)/assets?name=$encodedName"
    gh api --method POST -H "Content-Type: $contentType" $uploadUrl `
        --input $asset.FullName --silent
    if ($LASTEXITCODE -ne 0) { throw "Could not upload release asset $($asset.Name)." }
}

$draft = gh api "repos/$env:GITHUB_REPOSITORY/releases/$($draft.id)" | ConvertFrom-Json
if (-not $draft.draft -or $draft.target_commitish -ne $targetCommit) {
    throw "Release changed while the draft was being prepared; publication refused."
}
$uploadedNames = @(gh api "repos/$env:GITHUB_REPOSITORY/releases/$($draft.id)/assets" |
        ConvertFrom-Json | ForEach-Object { $_.name } | Sort-Object)
if (($uploadedNames -join "`n") -ne ($expectedNames -join "`n")) {
    throw "Draft asset verification failed; the draft remains unpublished."
}

gh api --method PATCH "repos/$env:GITHUB_REPOSITORY/releases/$($draft.id)" `
    -F draft=false -F prerelease=true | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Could not publish the verified draft prerelease." }
Write-Host "Published immutable prerelease $Tag."
