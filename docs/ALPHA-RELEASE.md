# Alpha release procedure

## Local build

```powershell
npm ci --prefix apps/desktop
npm run alpha:version:check
npm run alpha:launcher:check
npm run alpha:integrity:check
npm run alpha:bundle
npm run alpha:bundle:verify
npm run alpha:checksums
```

Only the complete root `release/Shio-Runtime-<version>-win-x64.zip` is user-facing. Desktop Builder output and bundle staging are temporary.

## Manual GitHub Actions build

Run the `Release Windows Alpha` workflow with `workflow_dispatch`. It validates API and Desktop, builds and extracts the complete bundle, applies the denylist, and uploads ZIP plus checksums for 10 days. Manual runs never create a tag or GitHub Release.

Download and verify the Actions artifact—not a local build. By default, qualify that artifact on a clean Windows 11 x64 NVIDIA machine.

## Tag and prerelease

After successful qualification and explicit release approval, or after the release operator explicitly waives reported incomplete live checks:

```powershell
$version = "0.1.0-alpha.5"
git tag -a "v$version" -m "Shio Runtime v$version"
git push origin "v$version"
```

The tag workflow requires an annotated tag whose commit is in `origin/main`, checks every version source, creates a draft prerelease, verifies the exact ZIP/checksum asset names, and only then publishes it. An unpublished draft for the same commit may be safely recreated. A published release and its assets are immutable; rerunning the workflow fails and requires a new version.

## Rollback

Do not rewrite, remove, or reuse a published tag or mutate a published release. If publication is defective, record the defect, fix the source, increment the alpha version, qualify a new workflow artifact, and publish a new tag.

GitHub Actions success does not prove CUDA, F5-TTS, Whisper, microphone, avatar, or end-to-end runtime behavior. Clean-machine qualification is the default release gate. An operator may explicitly waive incomplete live checks after they are reported; every waived check must remain visible in the release notes and final release report.
