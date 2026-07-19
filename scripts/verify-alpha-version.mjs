import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'

const root = resolve(import.meta.dirname, '..')
const readJson = (path) => JSON.parse(readFileSync(resolve(root, path), 'utf8'))
const rootPackage = readJson('package.json')
const desktopPackage = readJson('apps/desktop/package.json')
const manifest = readJson('launcher/release-manifest.json')
const builder = readFileSync(resolve(root, 'apps/desktop/electron-builder.yml'), 'utf8')
const changelog = readFileSync(resolve(root, 'CHANGELOG.md'), 'utf8')

const values = new Map([
  ['root package', rootPackage.version],
  ['Desktop package', desktopPackage.version],
  ['release manifest', manifest.productVersion],
  ['Speech Pack', manifest.speechPack?.version],
])
const expected = rootPackage.version
for (const [label, value] of values) {
  if (value !== expected) {
    console.error(`Version mismatch: ${label}=${value ?? '(missing)'}, expected=${expected}`)
    process.exit(1)
  }
}
if (!builder.includes('artifactName: Shio-Runtime-${version}-win-${arch}.${ext}')) {
  console.error('electron-builder artifactName does not derive its version from Desktop package.json')
  process.exit(1)
}
if (!changelog.includes(`## [${expected}]`)) {
  console.error(`CHANGELOG.md has no release heading for ${expected}`)
  process.exit(1)
}

const tag = process.env.GITHUB_REF_TYPE === 'tag'
  ? process.env.GITHUB_REF_NAME
  : process.argv.find((value) => value.startsWith('v'))
if (tag) {
  if (!/^v\d+\.\d+\.\d+-alpha\.\d+$/.test(tag)) {
    console.error(`Invalid alpha release tag: ${tag}`)
    process.exit(1)
  }
  if (tag.slice(1) !== expected) {
    console.error(`Tag version mismatch: ${tag.slice(1)}, expected=${expected}`)
    process.exit(1)
  }
}
console.log(`Alpha version verified: ${expected}${tag ? ` (${tag})` : ''}`)
