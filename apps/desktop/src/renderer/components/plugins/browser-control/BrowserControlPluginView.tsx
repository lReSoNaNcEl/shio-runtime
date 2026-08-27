import {
  ActionButton,
  Button,
  Content,
  Disclosure,
  DisclosurePanel,
  DisclosureTitle,
  Heading,
  InlineAlert,
  StatusLight,
  Text,
} from '@react-spectrum/s2'
import ChevronLeftIcon from '@react-spectrum/s2/icons/ChevronLeft'
import { useEffect, useState } from 'react'

import { type BrowserControlStatus } from '../../../../shared/browser-control'
import { type PluginStatus } from '../../../../shared/plugins'
import { useTranslation } from '../../../localization/useTranslation'
import { PluginToggle } from '../PluginSummary'
import { BrowserVisualModelSettings } from './BrowserVisualModelSettings'

export function BrowserControlPluginView({
  plugin,
  status,
  operation,
  error,
  onBack,
  onPluginChange,
  onPause,
  onResume,
  onStop,
}: {
  plugin: PluginStatus
  status: BrowserControlStatus
  operation: 'pause' | 'resume' | 'stop' | null
  error: string
  onBack(): void
  onPluginChange(enabled: boolean): void
  onPause(): void
  onResume(): void
  onStop(): void
}) {
  const { t } = useTranslation()
  const session = status.session
  const [currentTime, setCurrentTime] = useState(Date.now())
  useEffect(() => {
    if (!session || !['running', 'paused', 'waiting-user'].includes(session.state)) return
    const timer = setInterval(() => setCurrentTime(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [session])
  const continuous = session?.termination.type !== 'goal-completed'
  return (
    <section className="plugin-detail page-container">
      <ActionButton isQuiet onPress={onBack} UNSAFE_className="plugin-back-button">
        <ChevronLeftIcon />
        <Text>{t('plugins.backToCatalog')}</Text>
      </ActionButton>
      <div className="plugin-detail-heading">
        <div>
          <Heading level={2}>{t('plugins.browserControl.name')}</Heading>
          <Text>{t('plugins.browserControl.description')}</Text>
        </div>
        <PluginToggle plugin={plugin} onChange={onPluginChange} />
      </div>

      <section className="plugin-detail-section">
        <Heading level={3}>{t('plugins.browserControl.backend')}</Heading>
        <dl className="plugin-status-list">
          <div>
            <dt>{t('plugins.browserControl.browser')}</dt>
            <dd>{status.browserName}</dd>
          </div>
          <div>
            <dt>{t('plugins.browserControl.backend')}</dt>
            <dd>
              {status.backend} {status.backendVersion}
            </dd>
          </div>
          <div>
            <dt>{t('plugins.browserControl.profile')}</dt>
            <dd>{t('plugins.browserControl.isolated')}</dd>
          </div>
          <div>
            <dt>{t('plugins.browserControl.semantic')}</dt>
            <dd>{t(`plugins.browserControl.control.${status.semanticControl}`)}</dd>
          </div>
          <div>
            <dt>{t('plugins.browserControl.visual')}</dt>
            <dd>{t(`plugins.browserControl.control.${status.visualControl}`)}</dd>
          </div>
          <div>
            <dt>{t('plugins.browserControl.model')}</dt>
            <dd>{status.visualModel}</dd>
          </div>
        </dl>
        <BrowserVisualModelSettings />
      </section>

      <section className="plugin-detail-section">
        <Heading level={3}>{t('plugins.browserControl.session')}</Heading>
        {session ? (
          <>
            <StatusLight
              variant={
                session.state === 'failed'
                  ? 'negative'
                  : session.state === 'waiting-user'
                    ? 'notice'
                    : 'informative'
              }
            >
              {session.state === 'running'
                ? t('plugins.browserControl.activeLabel')
                : t(`plugins.browserControl.state.${session.state}`)}
            </StatusLight>
            <dl className="plugin-status-list">
              <div>
                <dt>{t('plugins.browserControl.goal')}</dt>
                <dd>{session.goal}</dd>
              </div>
              <div>
                <dt>{t('plugins.browserControl.activity')}</dt>
                <dd>{t(`plugins.browserControl.activity.${session.activity}`)}</dd>
              </div>
              <div>
                <dt>{t('plugins.browserControl.progress')}</dt>
                <dd>
                  {continuous
                    ? `${session.stepCount}; ${session.actionCount}`
                    : `${session.stepCount}/${session.maxSteps}; ${session.actionCount}/${session.maxActions}`}
                </dd>
              </div>
              <div>
                <dt>{t('plugins.browserControl.controlMode')}</dt>
                <dd>
                  {continuous ? `${t('plugins.browserControl.continuous')} · ` : ''}
                  {t(`plugins.browserControl.controlMode.${session.controlMode}`)}
                </dd>
              </div>
              <div>
                <dt>{t('plugins.browserControl.time')}</dt>
                <dd>{formatElapsed(currentTime - session.startedAt)}</dd>
              </div>
              <div>
                <dt>{t('plugins.browserControl.mode')}</dt>
                <dd>
                  {session.mode} ·{' '}
                  {t(`plugins.browserControl.termination.${session.termination.type}`)}
                </dd>
              </div>
            </dl>
            <div className="plugin-action-row">
              <Button
                variant="secondary"
                isPending={operation === 'pause'}
                isDisabled={Boolean(operation) || session.state !== 'running'}
                onPress={onPause}
              >
                {t('plugins.browserControl.pause')}
              </Button>
              <Button
                variant="secondary"
                isPending={operation === 'resume'}
                isDisabled={
                  Boolean(operation) || !['paused', 'waiting-user'].includes(session.state)
                }
                onPress={onResume}
              >
                {t('plugins.browserControl.resume')}
              </Button>
              <Button
                variant="negative"
                isPending={operation === 'stop'}
                isDisabled={
                  Boolean(operation) || ['completed', 'failed', 'stopped'].includes(session.state)
                }
                onPress={onStop}
              >
                {t('plugins.browserControl.stop')}
              </Button>
            </div>
            <Disclosure isQuiet>
              <DisclosureTitle level={4}>{t('plugins.browserControl.diagnostics')}</DisclosureTitle>
              <DisclosurePanel>
                <dl className="plugin-status-list">
                  <div>
                    <dt>{t('plugins.browserControl.captureFps')}</dt>
                    <dd>{session.diagnostics.captureFps.toFixed(1)} FPS</dd>
                  </div>
                  <div>
                    <dt>{t('plugins.browserControl.droppedFrames')}</dt>
                    <dd>
                      {session.diagnostics.framesReceived} / {session.diagnostics.framesProcessed} /{' '}
                      {session.diagnostics.framesDropped}
                    </dd>
                  </div>
                  <div>
                    <dt>{t('plugins.browserControl.trackingConfidence')}</dt>
                    <dd>{Math.round(session.diagnostics.trackingConfidence * 100)}%</dd>
                  </div>
                  <div>
                    <dt>{t('plugins.browserControl.fastInputHz')}</dt>
                    <dd>{session.diagnostics.fastInputHz.toFixed(1)} Hz</dd>
                  </div>
                  <div>
                    <dt>{t('plugins.browserControl.vlmLatency')}</dt>
                    <dd>
                      {formatLatencyPair(
                        session.diagnostics.vlmLatencyP50Ms,
                        session.diagnostics.vlmLatencyP95Ms,
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>{t('plugins.browserControl.trackingLatency')}</dt>
                    <dd>
                      {formatLatencyPair(
                        session.diagnostics.trackingLatencyP50Ms,
                        session.diagnostics.trackingLatencyP95Ms,
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>{t('plugins.browserControl.frameToInputLatency')}</dt>
                    <dd>
                      {formatLatencyPair(
                        session.diagnostics.frameToInputP50Ms,
                        session.diagnostics.frameToInputP95Ms,
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>{t('plugins.browserControl.planAge')}</dt>
                    <dd>{Math.round(session.diagnostics.planAgeMs)} ms</dd>
                  </div>
                  <div>
                    <dt>{t('plugins.browserControl.reanchors')}</dt>
                    <dd>{session.diagnostics.reanchors}</dd>
                  </div>
                  <div>
                    <dt>{t('plugins.browserControl.planLifecycle')}</dt>
                    <dd>
                      {session.diagnostics.planReplacements} / {session.diagnostics.planExpirations}{' '}
                      / {session.diagnostics.modeTransitions}
                    </dd>
                  </div>
                  <div>
                    <dt>{t('plugins.browserControl.inputAndVlmTotals')}</dt>
                    <dd>
                      {session.diagnostics.inputEventsTotal} /{' '}
                      {session.diagnostics.vlmRequestsTotal}
                    </dd>
                  </div>
                  <div>
                    <dt>{t('plugins.browserControl.resources')}</dt>
                    <dd>
                      CDP {session.diagnostics.activeCdpSessions}; Worker{' '}
                      {session.diagnostics.workerActive
                        ? t('common.enabled')
                        : t('common.disabled')}
                    </dd>
                  </div>
                </dl>
              </DisclosurePanel>
            </Disclosure>
          </>
        ) : (
          <Text>{t('plugins.browserControl.noSession')}</Text>
        )}
      </section>

      {error ? (
        <InlineAlert variant="negative" fillStyle="subtleFill">
          <Heading>{t('common.error')}</Heading>
          <Content>{error}</Content>
        </InlineAlert>
      ) : null}
    </section>
  )
}

function formatElapsed(durationMs: number): string {
  const seconds = Math.max(0, Math.floor(durationMs / 1_000))
  const hours = Math.floor(seconds / 3_600)
  const minutes = Math.floor((seconds % 3_600) / 60)
  const remainder = seconds % 60
  return [hours, minutes, remainder].map((value) => value.toString().padStart(2, '0')).join(':')
}

function formatLatencyPair(p50: number, p95: number): string {
  return `${Math.round(p50)} / ${Math.round(p95)} ms`
}
