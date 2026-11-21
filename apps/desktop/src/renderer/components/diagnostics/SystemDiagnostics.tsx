import {
  Button,
  ButtonGroup,
  Disclosure,
  DisclosurePanel,
  DisclosureTitle,
  Heading,
  StatusLight,
  Text,
} from '@react-spectrum/s2'
import { useMemo, useState } from 'react'

import { controller } from '../../Controller'
import { useControllerState } from '../../hooks/useControllerState'
import { useRuntimeSupportBundle } from '../../hooks/useRuntimeSupportBundle'
import { useTranslation } from '../../localization/useTranslation'
import { observeRendererPromise } from '../../reliability/observePromise'
import { buildRuntimeHealthProjection, type HealthSeverity } from '../../runtime/runtimeHealth'

const TONE: Record<HealthSeverity, 'positive' | 'notice' | 'negative'> = {
  healthy: 'positive',
  notice: 'notice',
  degraded: 'notice',
  error: 'negative',
}

type DiagnosticRead =
  | { status: 'available'; rows: readonly unknown[] }
  | { status: 'private' | 'unavailable' }

function DiagnosticReader({
  title,
  action,
  empty,
  load,
}: {
  title: string
  action: string
  empty: string
  load(): Promise<DiagnosticRead>
}) {
  const { t } = useTranslation()
  const [pending, setPending] = useState(false)
  const [result, setResult] = useState<DiagnosticRead | null>(null)

  const read = async (): Promise<void> => {
    setPending(true)
    setResult(null)
    try {
      setResult(await load())
    } finally {
      setPending(false)
    }
  }

  return (
    <section>
      <div className="diagnostics-toolbar">
        <Heading level={3}>{title}</Heading>
        <Button
          variant="secondary"
          isPending={pending}
          onPress={() =>
            observeRendererPromise(read(), 'read System diagnostics on demand', () =>
              setResult({ status: 'unavailable' }),
            )
          }
        >
          {action}
        </Button>
      </div>
      {result?.status === 'available' &&
        (result.rows.length ? (
          <pre className="diagnostics-json">{JSON.stringify(result.rows, null, 2)}</pre>
        ) : (
          <Text>{empty}</Text>
        ))}
      {result?.status === 'unavailable' && (
        <StatusLight variant="notice">{t('common.unavailable')}</StatusLight>
      )}
      {result?.status === 'private' && (
        <StatusLight variant="neutral">{t('diagnostics.system.applications.private')}</StatusLight>
      )}
    </section>
  )
}

/** Technical health details moved from the removed primary Runtime Health page. */
export function SystemDiagnostics() {
  const { t } = useTranslation()
  const state = useControllerState()
  const support = useRuntimeSupportBundle(true)
  const [refreshing, setRefreshing] = useState(false)
  const [copying, setCopying] = useState(false)
  const projection = useMemo(
    () => buildRuntimeHealthProjection(state, support.bundle),
    [state, support.bundle],
  )

  const refresh = async (): Promise<void> => {
    if (refreshing) return
    setRefreshing(true)
    try {
      await Promise.all([controller.checkHealth(), controller.checkLlmHealth(), support.refresh()])
    } finally {
      setRefreshing(false)
    }
  }

  const copyReport = async (): Promise<void> => {
    if (copying) return
    setCopying(true)
    try {
      const report = await support.refresh()
      await navigator.clipboard.writeText(JSON.stringify(report, null, 2))
    } finally {
      setCopying(false)
    }
  }

  return (
    <section className="diagnostics-system">
      <div className="diagnostics-toolbar">
        <Heading level={2}>{t('systemStatus.title')}</Heading>
        <ButtonGroup>
          <Button
            variant="secondary"
            isPending={refreshing}
            onPress={() => observeRendererPromise(refresh(), 'refresh System diagnostics')}
          >
            {t('health.refresh')}
          </Button>
          <Button
            variant="secondary"
            isPending={copying}
            onPress={() => observeRendererPromise(copyReport(), 'copy System diagnostics')}
          >
            {t('health.support.copyReport')}
          </Button>
        </ButtonGroup>
      </div>
      <div className="diagnostics-system-grid">
        {projection.components.map((component) => (
          <section className="diagnostics-system-component" key={component.id}>
            <StatusLight variant={TONE[component.severity]}>{t(component.titleKey)}</StatusLight>
            <Text>{t(component.summaryKey)}</Text>
            <code>{`${component.id} · enabled=${component.enabled} · ${component.severity}`}</code>
          </section>
        ))}
      </div>
      <DiagnosticReader
        title={t('diagnostics.system.audit.title')}
        action={t('diagnostics.system.audit.load')}
        empty={t('diagnostics.system.audit.empty')}
        load={async () => ({
          status: 'available',
          rows: await window.api.diagnostics.getAliveAudit(),
        })}
      />
      {state.alive?.settings.privacyMode ? (
        <StatusLight variant="neutral">{t('diagnostics.system.applications.private')}</StatusLight>
      ) : (
        <DiagnosticReader
          title={t('diagnostics.system.applications.title')}
          action={t('diagnostics.system.applications.load')}
          empty={t('diagnostics.system.applications.empty')}
          load={async () => {
            const result = await window.api.diagnostics.getRunningApplications()
            return result.status === 'available'
              ? { status: 'available', rows: result.applications }
              : result
          }}
        />
      )}
      {support.bundle && (
        <Disclosure UNSAFE_className="diagnostics-system-report">
          <DisclosureTitle>{t('health.support.copyRuntimeHealth')}</DisclosureTitle>
          <DisclosurePanel>
            <pre className="diagnostics-json">{JSON.stringify(support.bundle, null, 2)}</pre>
          </DisclosurePanel>
        </Disclosure>
      )}
    </section>
  )
}
