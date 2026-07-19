# Alpha release procedure

## Local build

```powershell
npm ci --prefix apps/desktop
npm run alpha:version:check
npm run alpha:launcher:check
npm run alpha:bundle
npm run alpha:bundle:verify
npm run alpha:checksums
```

Only the complete root `release/Shio-Runtime-<version>-win-x64.zip` is user-facing. Desktop Builder output and bundle staging are temporary.

## Manual GitHub Actions build

Run the `Release Windows Alpha` workflow with `workflow_dispatch`. It validates API and Desktop, builds and extracts the complete bundle, applies the denylist, and uploads ZIP plus checksums for 10 days. Manual runs never create a tag or GitHub Release.

Download the Actions artifact and qualify that artifact—not a local build—on a clean Windows 11 x64 NVIDIA machine.

## Tag and prerelease

After successful qualification and explicit release approval:

```powershell
$version = "0.1.0-alpha.2"
git tag -a "v$version" -m "Shio Runtime v$version"
git push origin "v$version"
```

The tag workflow checks every version source, then creates or updates a GitHub prerelease and replaces its ZIP/checksum assets safely.

## Rollback

Do not rewrite or reuse a published tag. If publication is defective, remove the prerelease assets or prerelease through GitHub, fix the source, increment the alpha version, qualify a new workflow artifact, and publish a new tag.

GitHub Actions success does not prove CUDA, F5-TTS, Whisper, microphone, avatar, or end-to-end runtime behavior. Clean-machine qualification remains mandatory.
