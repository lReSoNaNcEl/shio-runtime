param([string]$Tag = $env:GITHUB_REF_NAME)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ($env:GITHUB_REF_TYPE -ne "tag") {
    Write-Host "Not a tag build; ancestry verification skipped."
    exit 0
}
if (-not $Tag) { throw "Tag name is required." }

& git fetch --force --prune --tags origin "+refs/heads/main:refs/remotes/origin/main"
if ($LASTEXITCODE -ne 0) { throw "Could not fetch full origin/main history and tags." }

$tagType = (& git cat-file -t "refs/tags/$Tag").Trim()
if ($LASTEXITCODE -ne 0 -or $tagType -ne "tag") {
    throw "Release tag must be annotated: $Tag"
}
$tagCommit = (& git rev-parse "$Tag^{}").Trim()
if ($LASTEXITCODE -ne 0 -or -not $tagCommit) { throw "Could not resolve annotated tag commit." }
$tagObject = (& git rev-parse "refs/tags/$Tag").Trim()
& git merge-base --is-ancestor $tagCommit "origin/main"
if ($LASTEXITCODE -ne 0) {
    throw "Tag $Tag ($tagCommit) is outside origin/main. Merge the release commit and use a new version."
}
if ($env:GITHUB_SHA -and $env:GITHUB_SHA -notin @($tagCommit, $tagObject)) {
    throw "Workflow SHA $env:GITHUB_SHA does not match tag object or annotated tag commit."
}
if ($env:GITHUB_ENV) {
    Add-Content -LiteralPath $env:GITHUB_ENV -Encoding UTF8 -Value "RELEASE_COMMIT=$tagCommit"
}
Write-Host "Verified annotated tag $Tag at origin/main commit $tagCommit."
