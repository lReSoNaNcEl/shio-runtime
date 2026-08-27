import { Heading, Text } from '@react-spectrum/s2'

import { type RuntimeDebugSnapshot } from '../../Controller'
import { useTranslation } from '../../localization/useTranslation'

export function StreamingDiagnostics({ snapshot }: { snapshot: RuntimeDebugSnapshot | null }) {
  const { t } = useTranslation()
  if (!snapshot) return <Text>{t('common.loading')}</Text>

  return (
    <section className="diagnostics-streaming">
      <Heading level={2}>{t('diagnostics.streaming.lifecycle')}</Heading>
      <pre className="diagnostics-json">
        {JSON.stringify(snapshot.continuousListening, null, 2)}
      </pre>
      <Heading level={2}>{t('diagnostics.streaming.backlog')}</Heading>
      <dl className="diagnostics-streaming-counters">
        {Object.entries(snapshot.backlogArbitration).map(([key, value]) => (
          <div key={key}>
            <dt>{key}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
