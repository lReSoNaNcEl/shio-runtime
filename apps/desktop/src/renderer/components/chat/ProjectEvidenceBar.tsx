import {
  Badge,
  Disclosure,
  DisclosurePanel,
  DisclosureTitle,
  Text,
  Tooltip,
  TooltipTrigger,
} from '@react-spectrum/s2'

import { type ProjectReplyProvenance } from '../../../shared/project-awareness'
import { useTranslation } from '../../localization/useTranslation'
import { evidenceFileName, groupProjectEvidence } from './projectEvidence'

const MAX_VISIBLE_CHIPS = 2

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
  const visibleSources = sources.slice(0, MAX_VISIBLE_CHIPS)
  const omitted = Math.max(0, sources.length - visibleSources.length)
  const shortCommit = provenance.snapshotCommit.slice(0, 7)

  return (
    <div className="project-evidence">
      <div className="project-evidence-summary">
        <Text>{t('chat.evidence.summary', { count: sources.length })}</Text>
        <div className="project-evidence-chips">
          {visibleSources.map((source) => (
            <Badge key={source.path} size="S" variant="gray">
              {evidenceFileName(source.path)}
            </Badge>
          ))}
          {omitted > 0 && (
            <Badge size="S" variant="gray">
              +{omitted}
            </Badge>
          )}
          <TooltipTrigger delay={200}>
            <Badge size="S" variant="informative">
              {shortCommit}
            </Badge>
            <Tooltip>
              {t('chat.evidence.snapshotCommit', { sha: provenance.snapshotCommit })}
            </Tooltip>
          </TooltipTrigger>
        </div>
      </div>
      <Disclosure isQuiet UNSAFE_className="project-evidence-disclosure">
        <DisclosureTitle level={3}>{t('chat.evidence.show')}</DisclosureTitle>
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
