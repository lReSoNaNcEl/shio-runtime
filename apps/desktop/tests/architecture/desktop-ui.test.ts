import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { extname, join, relative } from 'node:path'

import { describe, it } from 'vitest'

function main(): void {
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
    assert.match(app, /sidebarAction=/)
    assert.match(shell, /sidebar-primary-action/)
    assert.match(shell, /sidebar-mobile-more/)
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
      'capabilities',
      'settings',
      'avatar-preview',
      'plugins',
      'diagnostics',
    ]) {
      assert.ok(source(`src/renderer/styles/${feature}.css`).trim(), `${feature}.css must be owned`)
    }
    const entry = source('src/renderer/main.tsx')
    for (const feature of [
      'shell',
      'chat',
      'capabilities',
      'settings',
      'avatar-preview',
      'plugins',
      'diagnostics',
    ]) {
      assert.match(entry, new RegExp(`styles/${feature}\\.css`))
    }
  }

  function assertViewHierarchy(): void {
    const status = source('src/renderer/components/shell/RuntimeStatusIndicator.tsx')
    const statusStyles = source('src/renderer/styles/shell.css')
    const systemDiagnostics = source('src/renderer/components/views/DiagnosticsView.tsx')
    assert.match(status, /system-status-popover/)
    assert.match(status, /padding="none"/)
    assert.match(status, /system-status-title/)
    assert.match(statusStyles, /\.system-status-popover \{[^}]*padding: 16px/s)
    assert.match(statusStyles, /\.system-status-title \{[^}]*margin: 0/s)
    assert.match(status, /issues\.map/)
    assert.match(systemDiagnostics, /SystemDiagnostics/)

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
    const generalSettings = source(
      'src/renderer/components/settings/sections/GeneralSettingsSection.tsx',
    )
    const settingsStyles = source('src/renderer/styles/settings.css')
    const shell = source('src/renderer/components/shell/AppShell.tsx')
    const pluginCatalog = source('src/renderer/components/plugins/PluginsView.tsx')
    const plugins =
      pluginCatalog +
      source('src/renderer/components/plugins/PluginSummary.tsx') +
      source('src/renderer/components/plugins/project-awareness/ProjectAwarenessPluginView.tsx') +
      source('src/renderer/components/plugins/desktop-control/DesktopControlPluginView.tsx') +
      source('src/renderer/components/plugins/web-search/WebSearchPluginView.tsx') +
      source('src/renderer/components/plugins/browser-control/BrowserControlPluginView.tsx')
    assert.doesNotMatch(settings, /ProjectSettings|activeSection === 'project'/)
    assert.match(generalSettings, /className="settings-grid settings-general-grid"/)
    assert.match(
      settingsStyles,
      /\.settings-content \.settings-general-grid \{[^}]*padding-top: 14px/s,
    )
    assert.match(shell, /id: 'plugins'/)
    assert.match(shell, /id: 'capabilities'/)
    assert.match(plugins, /@react-spectrum\/s2/)
    assert.match(pluginCatalog, /window\.api\.plugins\.(?:enable|disable)/)
    assert.match(pluginCatalog, /plugin-card plugin-card-compact/)
    assert.match(pluginCatalog, /plugin-card-title/)
    assert.match(pluginCatalog, /PluginCatalogStatus/)
    assert.doesNotMatch(
      plugins,
      /plugin\.enabled \? t\('common\.enabled'\) : t\('common\.disabled'\)/,
    )
    assert.match(plugins, /plugins\.disableLabel/)
    assert.match(
      pluginCatalog,
      /if \(!plugin\.enabled\) return <Badge variant="gray">\{t\('common\.disabled'\)\}<\/Badge>/,
    )
    assert.match(plugins, /plugin-section-heading/)
    assert.match(plugins, /plugins\.project\.projectTitle/)
    assert.match(plugins, /plugins\.project\.freshnessTitle/)
    assert.match(plugins, /plugins\.project\.indexTitle/)
    assert.match(plugins, /plugins\.project\.connectionTitle/)
    assert.match(plugins, /status\.freshness\.state === 'check-failed'/)
    assert.match(plugins, /<ProgressBar/)
    assert.doesNotMatch(plugins, /refreshSnapshotStatus\(false\)/)
    assert.match(plugins, /plugin-feedback/)
    assert.match(plugins, /<Disclosure/)
    const pluginStyles = source('src/renderer/styles/plugins.css')
    assert.match(pluginStyles, /\.plugin-detail-heading h2 \{[\s\S]*?margin: 0;/)
    assert.match(plugins, /plugins\.desktopControl\.accessMode\.confirm/)
    assert.doesNotMatch(
      plugins,
      /<Badge variant="negative">\{t\('actions\.fullAccessBadge'\)\}<\/Badge>/,
    )
    assert.doesNotMatch(plugins, /window\.api\.desktopControl\.(?:save|forget)Credential/)

    const projectEvidence = source('src/renderer/components/chat/ProjectEvidenceBar.tsx')
    assert.match(projectEvidence, /chat\.evidence\.projectSources/)
    assert.match(projectEvidence, /freshnessAtGeneration === 'stale'/)
    assert.match(projectEvidence, /chat\.evidence\.showProjectSources/)

    const capabilities = source('src/renderer/components/views/CapabilitiesView.tsx')
    assert.match(capabilities, /@react-spectrum\/s2/)
    assert.match(capabilities, /capabilities\.availability\.available/)
    assert.match(capabilities, /capabilities\.availability\.disabled/)
    assert.match(capabilities, /capabilities\.availability\.needsSetup/)
    assert.match(capabilities, /capabilities\.availability\.degraded/)
    assert.match(capabilities, /capabilities\.availability\.unavailable/)
    assert.match(capabilities, /CapabilityCategory/)
    assert.match(capabilities, /capabilities\.category\.communication/)
    assert.match(capabilities, /<ToggleButton/)
    assert.match(capabilities, /capabilities\.authority\.readOnly/)
    assert.match(capabilities, /capability\.id !== 'avatar-presence'/)
    const capabilityStyles = source('src/renderer/styles/capabilities.css')
    assert.match(capabilityStyles, /repeat\(auto-fill, minmax\(min\(100%, 420px\), 1fr\)\)/)
    assert.match(capabilityStyles, /min-height: 158px/)

    const diagnostics =
      source('src/renderer/components/views/DiagnosticsView.tsx') +
      source('src/renderer/components/diagnostics/EventsDiagnostics.tsx') +
      source('src/renderer/components/diagnostics/NetworkDiagnostics.tsx')
    assert.match(diagnostics, /pausedNetworkRequests/)
    assert.match(diagnostics, /diagnostics\.stream\.live/)
    assert.match(diagnostics, /copyDiagnostic/)

    const setup = source('src/renderer/components/setup/SetupCenter.tsx')
    assert.match(setup, /credentialConfigured && !replaceCredential/)
    assert.match(setup, /setup\.ai\.credentialSaved/)
    assert.match(setup, /navigator\.mediaDevices\.getUserMedia/)
    assert.match(setup, /setup\.plugins\.open/)
    assert.match(setup, /showCapabilities/)
    assert.match(setup, /showVisionFilter/)
    assert.match(setup, /onToggleOverlay\(false\)/)
    assert.match(setup, /setup\.overlay\.disable/)
    assert.doesNotMatch(setup, /setup\.voice\.label/)

    const memory = source('src/renderer/components/views/MemoryView.tsx')
    assert.match(memory, /className="memory-toolbar"/)
    assert.match(memory, /<MenuTrigger>/)
    assert.match(memory, /setClearConfirmation\(true\)/)
    assert.doesNotMatch(memory, /className="memory-overview"/)

    assert.match(shell, /https:\/\/t\.me\/IReSoNaNcEI/)
    assert.match(shell, /window\.api\.system\.openExternalLink/)
    assert.match(shell, /id="creator"/)
    assert.match(shell, /function TelegramLogo/)
    assert.match(shell, /className="telegram-logo"/)
    assert.match(shell, /isQuiet\s+UNSAFE_className="sidebar-creator"/)
    assert.doesNotMatch(shell, /@react-spectrum\/s2\/icons\/Send/)
    assert.match(shell, /useState<ReleaseInfo>/)
    assert.match(shell, /className="sidebar-meta"/)
    assert.match(shell, /TooltipTrigger delay=\{500\} placement="right" containerPadding=\{12\}/)
    assert.match(shell, /TooltipTrigger delay=\{200\} placement="right" containerPadding=\{12\}/)
    assert.doesNotMatch(shell, /app\.creator\.handle/)

    const shellStyles = source('src/renderer/styles/shell.css')
    assert.match(shellStyles, /\.sidebar-creator \{[^}]*background: transparent/s)
    assert.match(shellStyles, /\.sidebar-creator:hover \{[^}]*var\(--surface-hover\)/s)
    assert.doesNotMatch(shellStyles, /\.sidebar-creator-copy/)
    assert.doesNotMatch(shellStyles, /\.sidebar-creator-handle/)

    const ru = source('src/shared/localization/messages/ru.ts')
    assert.match(ru, /'app\.creator\.badge': 'Автор · Resonance'/)
    assert.match(ru, /'plugins\.projectAwareness\.name': 'Контекст проекта'/)
    assert.match(ru, /'plugins\.desktopControl\.name': 'Управление компьютером'/)
    assert.match(ru, /'setup\.title': 'Центр настройки'/)
    assert.match(ru, /'setup\.overlay\.title': 'Зеркальный оверлей'/)
  }

  function assertScreenContextPickerLayout(): void {
    const picker = source('src/renderer/components/chat/ScreenContextPicker.tsx')
    const chatStyles = source('src/renderer/styles/chat.css')

    assert.match(picker, /<ToggleButton/)
    assert.match(picker, /source\.appIconDataUrl/)
    assert.match(picker, /className="screen-context-source-name"[^>]*>[\s\S]*?\{source\.name\}/)
    assert.match(chatStyles, /\.screen-context-source \{[\s\S]*?flex-direction: column;/)
    assert.match(chatStyles, /\.screen-context-source \{[\s\S]*?height: auto;/)
    assert.match(chatStyles, /\.screen-context-source \{[\s\S]*?block-size: auto;/)
    assert.match(chatStyles, /\.screen-context-source > img \{[\s\S]*?aspect-ratio: 16 \/ 9;/)
  }

  function assertMicrophoneGateLayout(): void {
    const gate = source('src/renderer/components/overlays/MicrophoneGateOverlay.tsx')
    const chatStyles = source('src/renderer/styles/chat.css')

    assert.match(gate, /<div className="mic-device-list">[\s\S]*?<RadioGroup/)
    assert.match(gate, /description=\{validating/)
    assert.doesNotMatch(gate, /UNSAFE_className="mic-device-row"/)
    assert.doesNotMatch(chatStyles, /\.mic-device-row/)
    assert.doesNotMatch(chatStyles, /\.mic-gate-card \{[^}]*max-height:/)
    assert.match(chatStyles, /\.mic-gate-empty \{[^}]*display: block;/)
    assert.doesNotMatch(chatStyles, /\.mic-gate-empty \{[^}]*border: 1px dashed/)
  }

  function assertMicrophoneRecordingControl(): void {
    const composer = source('src/renderer/components/chat/ChatComposer.tsx')

    assert.match(composer, /aria-pressed=\{listening\}/)
    assert.match(composer, /\{listening \? <Stop \/> : <Microphone \/>\}/)
  }

  function assertChatQuickActionsLayout(): void {
    const chatStyles = source('src/renderer/styles/chat.css')

    assert.match(chatStyles, /container-name: chat-message-list/)
    assert.match(chatStyles, /container-type: inline-size/)
    assert.match(chatStyles, /\.chat-starter-action \{[^}]*width: max-content/s)
    assert.match(chatStyles, /\.chat-starter-action \{[^}]*white-space: nowrap/s)
    assert.match(
      chatStyles,
      /@container chat-message-list \(max-width: 760px\) \{[\s\S]*?\.chat-quick-action-grid \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/,
    )
  }

  assertSemanticAppShell()
  assertSpectrumInteractiveSurface()
  assertCssOwnership()
  assertViewHierarchy()
  assertScreenContextPickerLayout()
  assertMicrophoneGateLayout()
  assertMicrophoneRecordingControl()
  assertChatQuickActionsLayout()

  console.log('Desktop UI Architecture Cleanup focused repro: PASS')
}

describe('desktop UI architecture', () => {
  it('keeps semantic structure and Spectrum ownership', () => {
    main()
  })
})
