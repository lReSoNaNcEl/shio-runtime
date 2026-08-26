import {
  ActionButton,
  Button,
  Content,
  Heading,
  InlineAlert,
  StatusLight,
  Text,
} from '@react-spectrum/s2'
import ChevronLeftIcon from '@react-spectrum/s2/icons/ChevronLeft'

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
              {t(`plugins.browserControl.state.${session.state}`)}
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
                  {session.stepCount}/{session.maxSteps}; {session.actionCount}/{session.maxActions}
                </dd>
              </div>
              <div>
                <dt>{t('plugins.browserControl.mode')}</dt>
                <dd>{session.mode}</dd>
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
