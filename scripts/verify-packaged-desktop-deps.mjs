import { existsSync, readFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'

const [packageDirectory, runtimeDirectory] = process.argv.slice(2)
const runtime = resolve(runtimeDirectory)
const visited = new Set()
const missing = new Set()
const readPackage = (path) => JSON.parse(readFileSync(path, 'utf8'))

function findPackage(name, directory) {
  let path = directory
  for (;;) {
    if (basename(path) !== 'node_modules') {
      const manifest = join(path, 'node_modules', name, 'package.json')
      if (existsSync(manifest)) return manifest
    }
    if (path === runtime) return
    path = dirname(path)
  }
}

function visit(name, directory, owner) {
  const manifest = findPackage(name, directory)
  if (!manifest) {
    missing.add(`${owner} requires ${name}`)
    return
  }
  if (visited.has(manifest)) return
  visited.add(manifest)
  const pkg = readPackage(manifest)
  for (const dependency of Object.keys({ ...pkg.dependencies, ...pkg.peerDependencies })) {
    if (!pkg.optionalDependencies?.[dependency] && !pkg.peerDependenciesMeta?.[dependency]?.optional)
      visit(dependency, dirname(manifest), pkg.name)
  }
}

const root = readPackage(join(packageDirectory, 'package.json'))
for (const name of Object.keys(root.dependencies)) visit(name, runtime, root.name)
if (missing.size > 0) {
  console.error([...missing].sort().join('\n'))
  process.exitCode = 1
} else {
  console.log(`Verified ${visited.size} bundled Desktop dependencies`)
}
