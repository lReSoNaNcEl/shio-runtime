import { ActionButton, Text } from '@react-spectrum/s2'
import Copy from '@react-spectrum/s2/icons/Copy'

import { type RuntimeDebugSnapshot } from '../../Controller'
import { useTranslation } from '../../localization/useTranslation'
import { observeRendererPromise } from '../../reliability/observePromise'

export interface DiagnosticsSnapshotSection {
  id: string
  title: string
  fields: Array<{ label: string; value: unknown }>
}

export function RuntimeSnapshotDiagnostics({
  snapshot,
  sections,
  collapsed,
  onToggleSection,
  onCopy,
}: {
  snapshot: RuntimeDebugSnapshot | null
  sections: readonly DiagnosticsSnapshotSection[]
  collapsed: ReadonlySet<string>
  onToggleSection(id: string): void
  onCopy(value: unknown): Promise<void>
}) {
  const { t } = useTranslation()
  return (
    <div className="diagnostics-snapshot">
      <div className="diagnostics-snapshot-toolbar">
        <Text>{t('diagnostics.snapshot.technicalKeys')}</Text>
        <ActionButton
          isDisabled={!snapshot}
          onPress={() => observeRendererPromise(onCopy(snapshot), 'copy Runtime snapshot')}
        >
          <Copy />
          <Text>{t('diagnostics.copy.snapshot')}</Text>
        </ActionButton>
      </div>
      {sections.map((section) => {
        const isCollapsed = collapsed.has(section.id)
        return (
          <section className="diagnostics-snapshot-section" key={section.id}>
            <ActionButton
              UNSAFE_className="diagnostics-snapshot-heading"
              aria-expanded={!isCollapsed}
              onPress={() => onToggleSection(section.id)}
            >
              <strong>{section.title}</strong>
              <span>{t('diagnostics.snapshot.fieldCount', { count: section.fields.length })}</span>
            </ActionButton>
            {!isCollapsed && (
              <div className="diagnostics-snapshot-fields">
                {section.fields.map((field) => (
                  <div className="diagnostics-snapshot-field" key={field.label}>
                    <code>{field.label}</code>
                    <SnapshotValue value={field.value} />
                  </div>
                ))}
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}

function SnapshotValue({ value }: { value: unknown }) {
  const { t } = useTranslation()
  if (value === null || value === undefined) return <span>{t('common.none')}</span>
  if (typeof value === 'boolean') return <span>{value ? t('common.yes') : t('common.no')}</span>
  if (typeof value === 'object') {
    return <pre className="diagnostics-json">{JSON.stringify(value, null, 2)}</pre>
  }
  return <span>{String(value)}</span>
}
