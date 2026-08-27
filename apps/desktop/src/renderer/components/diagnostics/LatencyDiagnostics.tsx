import { Text } from '@react-spectrum/s2'

import { type LatencySnapshot } from '../../../shared/latency'
import { useTranslation } from '../../localization/useTranslation'

export function LatencyDiagnostics({ latency }: { latency: LatencySnapshot | null }) {
  const { t } = useTranslation()
  return (
    <div className="diagnostics-latency">
      <Text UNSAFE_className="diagnostics-network-privacy">
        {t('diagnostics.latency.description')}
      </Text>
      <div className="diagnostics-latency-grid">
        {latency && Object.entries(latency.metrics).length > 0 ? (
          Object.entries(latency.metrics).map(([name, metric]) => (
            <article className="diagnostics-latency-card" key={name}>
              <Text UNSAFE_className="diagnostics-latency-title">{name}</Text>
              <Text>
                p50 {metric.p50Ms} ms · p95 {metric.p95Ms} ms · max {metric.maxMs} ms
              </Text>
              <Text>{t('diagnostics.latency.samples', { count: metric.count })}</Text>
            </article>
          ))
        ) : (
          <Text>{t('diagnostics.latency.empty')}</Text>
        )}
      </div>
      <div className="diagnostics-latency-traces">
        {latency?.recentTraces.map((trace) => (
          <article className="diagnostics-latency-card" key={trace.turnId}>
            <Text UNSAFE_className="diagnostics-latency-title">
              {trace.turnId} · {trace.status ?? 'active'}
            </Text>
            <Text>
              {trace.provider ?? '—'} · {trace.model ?? '—'} · {trace.milestones.length} milestones
            </Text>
          </article>
        ))}
      </div>
    </div>
  )
}
