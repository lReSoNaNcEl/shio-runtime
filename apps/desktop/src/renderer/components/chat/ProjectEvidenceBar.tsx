import {
  Badge,
  Disclosure,
  DisclosurePanel,
  DisclosureTitle,
  StatusLight,
  Text,
} from '@react-spectrum/s2'

import { type ProjectReplyProvenance } from '../../../shared/project-awareness'
import { useTranslation } from '../../localization/useTranslation'
import { groupProjectEvidence } from './projectEvidence'

function lineRange(
  range: { startLine?: number; endLine?: number },
  t: ReturnType<typeof useTranslation>['t'],
): string | null {
  if (!range.startLine) return null
  if (!range.endLine || range.endLine === range.startLine) {
    return t('chat.evidence.line', { line: range.startLine })
  }
  return t('chat.evidence.lines', { start: range.startLine, end: range.endLine })
}

export function ProjectEvidenceBar({ provenance }: { provenance: ProjectReplyProvenance }) {
  const { t } = useTranslation()
  const sources = groupProjectEvidence(provenance.sources)
  const shortCommit = provenance.snapshotCommit.slice(0, 7)

  return (
    <div className="project-evidence">
      <div className="project-evidence-summary">
        <Text>{t('chat.evidence.projectSources', { count: sources.length })}</Text>
        <div className="project-evidence-chips">
          <Badge size="S" variant="informative">
            {shortCommit}
          </Badge>
        </div>
      </div>
      {provenance.freshnessAtGeneration === 'stale' && (
        <StatusLight variant="notice" size="S">
          {t('chat.evidence.staleWarning', { branch: provenance.branch })}
        </StatusLight>
      )}
      <Disclosure isQuiet UNSAFE_className="project-evidence-disclosure">
        <DisclosureTitle level={3}>{t('chat.evidence.showProjectSources')}</DisclosureTitle>
        <DisclosurePanel>
          <dl className="project-evidence-metadata">
            <div>
              <dt>{t('common.repository')}</dt>
              <dd>{provenance.repository}</dd>
            </div>
            <div>
              <dt>{t('common.branch')}</dt>
              <dd>{provenance.branch}</dd>
            </div>
            <div>
              <dt>{t('chat.evidence.snapshot')}</dt>
              <dd className="project-evidence-code">{provenance.snapshotCommit}</dd>
            </div>
          </dl>
          {sources.length > 0 && (
            <ul className="project-evidence-source-list">
              {sources.map((source) => (
                <li key={source.path}>
                  <span className="project-evidence-path">{source.path}</span>
                  {source.ranges.map((range) => {
                    const label = lineRange(range, t)
                    return label ? <span key={label}>{label}</span> : null
                  })}
                </li>
              ))}
            </ul>
          )}
        </DisclosurePanel>
      </Disclosure>
    </div>
  )
}
