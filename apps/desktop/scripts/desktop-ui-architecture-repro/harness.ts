import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { extname, join, relative } from 'node:path'

const desktopRoot = process.cwd().endsWith('apps\\desktop')
  ? process.cwd()
  : join(process.cwd(), 'apps', 'desktop')

function source(relativePath: string): string {
  return readFileSync(join(desktopRoot, relativePath), 'utf8')
}

function filesBelow(relativeDirectory: string, extension: string): string[] {
  const root = join(desktopRoot, relativeDirectory)
  const pending = [root]
  const files: string[] = []
  while (pending.length > 0) {
    const directory = pending.pop()
    assert.ok(directory)
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        pending.push(path)
      } else if (extname(entry.name) === extension) {
        files.push(path)
      }
    }
  }
  return files
}

function assertSemanticAppShell(): void {
  const shell = source('src/renderer/components/shell/AppShell.tsx')
  const mainStart = shell.indexOf('<main')
  const contentStart = shell.indexOf('section-content', mainStart)
  const mainEnd = shell.indexOf('</main>', contentStart)
  assert.ok(mainStart >= 0 && contentStart > mainStart && mainEnd > contentStart)

  const app = source('src/renderer/components/App.tsx')
  assert.match(app, /heading=\{\s*!setupOpen/)
  assert.doesNotMatch(app, /<AppShell[^>]*\/>/)
}

function assertSpectrumInteractiveSurface(): void {
  const forbidden = /<(?:button|input|select|textarea|details|summary|h[1-6]|p)(?:\s|>)/
  for (const file of filesBelow('src/renderer/components', '.tsx')) {
    const match = source(relative(desktopRoot, file)).match(forbidden)
    assert.equal(
      match,
      null,
      `${relative(desktopRoot, file)} contains a native UI primitive: ${match?.[0] ?? ''}`,
    )
  }
}

function assertCssOwnership(): void {
  const base = source('src/renderer/styles/base.css')
  assert.ok(base.split(/\r?\n/).length < 200, 'base.css must remain a compact global baseline')
  assert.doesNotMatch(
    base,
    /\.(?:app-shell|chat-|settings-|avatar-preview|health-|diagnostics-)/,
    'feature selectors must not return to base.css',
  )
  for (const feature of [
    'shell',
    'chat',
    'settings',
    'avatar-preview',
    'health',
    'plugins',
    'diagnostics',
  ]) {
    assert.ok(source(`src/renderer/styles/${feature}.css`).trim(), `${feature}.css must be owned`)
  }
  const entry = source('src/renderer/main.tsx')
  for (const feature of [
    'shell',
    'chat',
    'settings',
    'avatar-preview',
    'health',
    'plugins',
    'diagnostics',
  ]) {
    assert.match(entry, new RegExp(`styles/${feature}\\.css`))
  }
}

function assertViewHierarchy(): void {
  const health = source('src/renderer/components/views/RuntimeHealthView.tsx')
  assert.doesNotMatch(health, /health-dashboard-title|health-dashboard-subtitle/)
  assert.match(health, /health-dashboard-toolbar/)

  const avatar = source('src/renderer/components/views/AvatarPreviewView.tsx')
  for (const ownedRegion of [
    'animation-library',
    'preview-viewport-header',
    'preview-camera-toolbar',
    'preview-playback',
  ]) {
    assert.match(avatar, new RegExp(ownedRegion))
  }

  const responsive =
    source('src/renderer/styles/shell.css') + source('src/renderer/styles/avatar-preview.css')
  assert.match(responsive, /@media \(max-width: 760px\)/)
  assert.match(responsive, /@media \(max-width: 820px\)/)

  const settings = source('src/renderer/components/settings/SettingsDialog.tsx')
  const shell = source('src/renderer/components/shell/AppShell.tsx')
  const plugins = source('src/renderer/components/plugins/PluginsView.tsx')
  assert.doesNotMatch(settings, /ProjectSettings|activeSection === 'project'/)
  assert.match(shell, /id: 'plugins'/)
  assert.match(plugins, /@react-spectrum\/s2/)
  assert.match(plugins, /window\.api\.plugins\.(?:enable|disable)/)
}

assertSemanticAppShell()
assertSpectrumInteractiveSurface()
assertCssOwnership()
assertViewHierarchy()

console.log('Desktop UI Architecture Cleanup focused repro: PASS')
