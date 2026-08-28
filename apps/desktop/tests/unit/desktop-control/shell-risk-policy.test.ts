import { describe, expect, it } from 'vitest'

import { CharacterToolRegistry } from '../../../src/main/character-tools'
import { DesktopControlPlugin, ShellRiskPolicy } from '../../../src/main/desktop-control'

describe('Shell risk policy', () => {
  it('classifies read-only, mutating, destructive, and unknown commands', () => {
    const policy = new ShellRiskPolicy()
    expect(policy.classify('Get-Process | Select-Object Name')).toEqual({
      classification: 'read-only',
      effectiveRisk: 'normal',
      commands: ['Get-Process', 'Select-Object'],
      reason: 'parsed_read-only',
    })
    expect(policy.classify('Get-Host | Select-Object -ExpandProperty Version')).toEqual({
      classification: 'read-only',
      effectiveRisk: 'normal',
      commands: ['Get-Host', 'Select-Object'],
      reason: 'parsed_read-only',
    })
    expect(policy.classify('Set-Content -Path note.txt -Value ready').classification).toBe(
      'mutating',
    )
    expect(policy.classify('Remove-Item note.txt').effectiveRisk).toBe('destructive')
    expect(policy.classify('Invoke-Expression $command').classification).toBe('unknown')
  })

  it('allows only read-only version checks through Windows Node command shims', () => {
    const policy = new ShellRiskPolicy()

    expect(policy.classify('npx.cmd --version')).toEqual({
      classification: 'read-only',
      effectiveRisk: 'normal',
      commands: ['npx.cmd'],
      reason: 'parsed_read-only',
    })
    expect(policy.classify('npm.cmd --version').classification).toBe('read-only')
    expect(policy.classify('npx.cmd some-package').classification).toBe('unknown')
  })

  it('keeps effective risk Main-owned and absent from Character tool input', () => {
    const plugin = new DesktopControlPlugin({
      adapter: { onChanged: () => () => undefined },
      browser: { observationSnapshot: () => null },
      authorityMode: () => 'full',
    } as never)
    const reclassified = plugin.validateWorkflowRequest({
      type: 'desktop.workflow',
      goal: 'Delete the exact temporary file',
      shellCommand: 'Remove-Item note.txt',
      requestedCapabilities: ['shell'],
      risk: 'normal',
    })
    expect(reclassified.risk).toBe('destructive')
    expect(reclassified.shellRisk?.classification).toBe('destructive')

    const registry = new CharacterToolRegistry({
      projectAvailable: false,
      capabilityContext: {
        schemaVersion: 1,
        generatedAt: 1,
        capabilities: [
          {
            id: 'computer-control',
            category: 'action',
            source: { kind: 'plugin', pluginId: 'desktop-control' },
            titleKey: 'capabilities.computer.title',
            descriptionKey: 'capabilities.computer.description',
            availability: 'available',
            authority: 'full',
          },
        ],
      },
      browserObservation: null,
      actionsAvailable: true,
    })
    const shell = registry.definitions().find((tool) => tool.id === 'shell.execute')
    expect(shell).toBeDefined()
    const properties = shell?.llmInputSchema.properties as Record<string, unknown>
    expect(properties).not.toHaveProperty('risk')
  })
})
