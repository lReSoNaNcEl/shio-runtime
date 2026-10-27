// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { ProjectEvidenceBar } from '../../../src/renderer/components/chat/ProjectEvidenceBar'
import { translate } from '../../../src/shared/localization'
import type { ProjectReplyProvenance } from '../../../src/shared/project-awareness'
import { localizedWrapper } from '../../support/rendering'

afterEach(cleanup)

describe.each(['light', 'dark'] as const)('Project evidence in %s theme', (theme) => {
  it('discloses exact turn provenance and marks stale evidence without discarding its sources', async () => {
    const provenance: ProjectReplyProvenance = {
      pluginId: 'project-awareness',
      repository: 'fixture/project',
      branch: 'main',
      snapshotCommit: 'abcdef0123456',
      freshnessAtGeneration: 'stale',
      sources: [{ path: 'src/fixture.ts', startLine: 4, endLine: 9 }],
    }
    const view = render(<ProjectEvidenceBar provenance={provenance} />, {
      wrapper: localizedWrapper('en', theme),
    })
    expect(screen.getByText('abcdef0')).toBeInTheDocument()
    const warning = translate('en', 'chat.evidence.staleWarning', { branch: 'main' })
    expect(screen.getByText(warning)).toBeInTheDocument()
    expect(
      screen.getByText(translate('en', 'chat.evidence.projectSources', { count: 1 })),
    ).toBeInTheDocument()
    fireEvent.click(
      screen.getByRole('button', { name: translate('en', 'chat.evidence.showProjectSources') }),
    )
    expect(await screen.findByText('fixture/project')).toBeVisible()
    expect(screen.getByText('src/fixture.ts')).toBeVisible()
    expect(screen.getByText('abcdef0123456')).toBeVisible()
    expect(
      screen.getByText(translate('en', 'chat.evidence.lines', { start: 4, end: 9 })),
    ).toBeVisible()
    view.rerender(
      <ProjectEvidenceBar provenance={{ ...provenance, freshnessAtGeneration: 'current' }} />,
    )
    expect(screen.queryByText(warning)).not.toBeInTheDocument()
  })
})
