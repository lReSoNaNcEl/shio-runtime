import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = path.resolve(process.argv[2] ?? 'D:/AI-tools/shio-2d')
const target = path.join(repository, 'apps/shio-2d/public/shio-2d')
const pending = ['source/v22/runtime/runtime.mjs', 'source/v22/runtime/rig-renderer.mjs']
const files = new Map()

while (pending.length) {
  const relative = pending.pop().replaceAll('\\', '/')
  if (files.has(relative)) continue
  const absolute = path.resolve(source, relative)
  if (!absolute.startsWith(`${source}${path.sep}`)) throw new Error(`Invalid source: ${relative}`)
  const bytes = await fs.readFile(absolute)
  const output = relative.startsWith('source/v22/runtime/') ? path.basename(relative) : relative
  files.set(relative, { output, sha256: createHash('sha256').update(bytes).digest('hex'), sourceSha256: createHash('sha256').update(bytes).digest('hex'), bytes })
  if (!/\.(mjs|json)$/.test(relative)) continue
  const text = bytes.toString('utf8')
  for (const match of text.matchAll(/['"](\/assets\/[^'"\s]+)['"]/g)) {
    const resource = match[1].slice(1)
    if (resource.endsWith('/')) {
      for (const entry of await fs.readdir(path.join(source, resource))) pending.push(resource + entry)
    } else pending.push(resource)
  }
  if (relative.endsWith('.mjs')) {
    for (const match of text.matchAll(/(?:from\s*|import\s*)['"](\.[^'"]+)['"]/g)) {
      pending.push(path.posix.normalize(path.posix.join(path.posix.dirname(relative), match[1])))
    }
  }
}

for (const { output, bytes } of files.values()) {
  const destination = path.join(target, output)
  await fs.mkdir(path.dirname(destination), { recursive: true })
  let content = bytes
  if (/\.mjs$/.test(output)) {
    content = bytes.toString('utf8').replace(/(['"])\/assets\//g, (_, quote) => {
      const prefix = path.posix.relative(path.posix.dirname(output), 'assets') || '.'
      return `${quote}${prefix.startsWith('.') ? prefix : `./${prefix}`}/`
    })
    // Resource URLs resolve relative to the owning module, including packaged file:// builds.
    content = content.replace(/load\(url='\.\/assets\/v22\/model\.json'\)/, "load(url=new URL('./assets/v22/model.json',import.meta.url).href)")
    content = content.replace(/load\(base='[^']*psd2live\/'\)/, "load(base=new URL('./psd2live/',import.meta.url).href)")
    if (output === 'runtime.mjs') {
      content = content.replace(/blink=(bt>=0&&bt<\.(?:2|24)\?Math\.sin\(bt\/\.(?:2|24)\*Math\.PI\)\*\*2:0)/g, 'blink=this.externalBlink??($1)')
      content = content.replace('if(this.motion&&this.time>=this.nextBlink', 'if(this.externalBlink===undefined&&this.motion&&this.time>=this.nextBlink')
    }
  }
  if (/\.json$/.test(output)) {
    const prefix = path.posix.relative(path.posix.dirname(output), 'assets') || '.'
    content = bytes.toString('utf8').replace(/"\/assets\//g, `"${prefix}/`)
  }
  await fs.writeFile(destination, content)
  files.get([...files.entries()].find(([, value]) => value.output === output)[0]).sha256 = createHash('sha256').update(content).digest('hex')
}
const manifest = {
  version: 22,
  source: 'Shio S22',
  files: [...files.entries()].map(([sourcePath, { output, sha256, sourceSha256 }]) => ({ path: output, sha256, sourcePath, sourceSha256 })),
}
await fs.writeFile(path.join(target, 'provenance.json'), `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`Imported S22: ${files.size} files, ${(Array.from(files.values()).reduce((n, f) => n + f.bytes.length, 0) / 1024 / 1024).toFixed(1)} MiB`)
