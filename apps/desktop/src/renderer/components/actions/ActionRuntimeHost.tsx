import {
  ActionButton,
  Button,
  ButtonGroup,
  Content,
  Dialog,
  DialogContainer,
  Heading,
  InlineAlert,
  ProgressCircle,
  Text,
  Tooltip,
  TooltipTrigger,
} from '@react-spectrum/s2'
import StopProcessing from '@react-spectrum/s2/icons/StopProcessing'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

import {
  type ActionConfirmationRequest,
  type ActionRuntimeSnapshot,
  type AuthorityChangeRequest,
  type DesktopWorkflowCapability,
} from '../../../shared/actions'
import { type BrowserOperation } from '../../../shared/desktop-control'
import { type TranslationKey } from '../../../shared/localization'
import { useTranslation } from '../../localization/useTranslation'
import { observeRendererPromise } from '../../reliability/observePromise'
import { actionRuntimeActivity } from './actionRuntimePresentation'

const CAPABILITY_LABELS: Record<DesktopWorkflowCapability, TranslationKey> = {
  browser: 'actions.capability.browser',
  'desktop-ui': 'actions.capability.desktopUi',
  filesystem: 'actions.capability.filesystem',
  shell: 'actions.capability.shell',
}

const BROWSER_OPERATION_LABELS: Record<BrowserOperation['operation'], TranslationKey> = {
  observe: 'actions.confirm.browserObserve',
  open: 'actions.confirm.browserOpen',
  click: 'actions.confirm.browserClick',
  fill: 'actions.confirm.browserFill',
  select: 'actions.confirm.browserSelect',
  scroll: 'actions.confirm.browserScroll',
  back: 'actions.confirm.browserBack',
  forward: 'actions.confirm.browserForward',
  tabs: 'actions.confirm.browserTabs',
  'switch-tab': 'actions.confirm.browserSwitchTab',
}

function browserOperationDetail(operation: BrowserOperation): string {
  switch (operation.operation) {
    case 'observe':
    case 'tabs':
    case 'back':
    case 'forward':
      return ''
    case 'open':
      return operation.url
    case 'click':
      return operation.target.kind === 'semantic-ref'
        ? `@${operation.target.ref}`
        : `${operation.target.role} “${operation.target.name}”`
    case 'fill':
    case 'select':
      return operation.target.kind === 'semantic-ref'
        ? `@${operation.target.ref}`
        : `${operation.target.role} “${operation.target.name}”`
    case 'scroll':
      return `${operation.direction} ${operation.amount}px`
    case 'switch-tab':
      return operation.tabId
  }
}

export function ActionRuntimeHost() {
  const { t } = useTranslation()
  const [snapshot, setSnapshot] = useState<ActionRuntimeSnapshot | null>(null)
  const [confirmation, setConfirmation] = useState<ActionConfirmationRequest | null>(null)
  const [authorityChange, setAuthorityChange] = useState<AuthorityChangeRequest | null>(null)
  const [responding, setResponding] = useState(false)

  useEffect(() => {
    let active = true
    observeRendererPromise(
      window.api.actions.snapshot().then((value) => {
        if (active) {
          setSnapshot(value)
          setConfirmation(value.pendingConfirmation)
          setAuthorityChange(value.pendingAuthorityChange)
        }
      }),
      'load Action Runtime snapshot',
    )
    const unsubscribeConfirmation = window.api.actions.onConfirmationRequested((request) => {
      setConfirmation(request)
    })
    const unsubscribeAuthority = window.api.actions.onAuthorityChangeRequested((request) => {
      setAuthorityChange(request)
    })
    const unsubscribeChanged = window.api.actions.onChanged((value) => {
      setSnapshot(value)
      setConfirmation(value.pendingConfirmation)
      setAuthorityChange(value.pendingAuthorityChange)
    })
    return () => {
      active = false
      unsubscribeConfirmation()
      unsubscribeAuthority()
      unsubscribeChanged()
    }
  }, [])

  const answerAction = (decision: 'confirm' | 'cancel'): void => {
    if (!confirmation || responding) return
    const actionId = confirmation.actionId
    setResponding(true)
    observeRendererPromise(
      window.api.actions.respondToConfirmation({ actionId, decision }).then(() => {
        setConfirmation((current) => (current?.actionId === actionId ? null : current))
        setResponding(false)
      }),
      `respond to Action Runtime confirmation: ${decision}`,
      () => setResponding(false),
    )
  }

  const answerAuthority = (decision: 'confirm' | 'cancel'): void => {
    if (!authorityChange || responding) return
    const requestId = authorityChange.requestId
    setResponding(true)
    observeRendererPromise(
      window.api.actions.respondToAuthorityChange({ requestId, decision }).then(() => {
        setAuthorityChange((current) => (current?.requestId === requestId ? null : current))
        setResponding(false)
      }),
      `respond to Full Control confirmation: ${decision}`,
      () => setResponding(false),
    )
  }

  const emergencyStop = (): void => {
    if (responding) return
    setResponding(true)
    observeRendererPromise(
      window.api.actions.emergencyStop().then(() => {
        setConfirmation(null)
        setAuthorityChange(null)
        setResponding(false)
      }),
      'Action Runtime Emergency Stop',
      () => setResponding(false),
    )
  }

  const activity = actionRuntimeActivity(snapshot)
  const activityLabel = t(
    activity === 'awaiting-confirmation'
      ? 'actions.awaitingConfirmation'
      : activity === 'verifying'
        ? 'actions.verifying'
        : activity === 'recovering'
          ? 'actions.recovering'
          : 'actions.activeTask',
  )
  const statusTarget = document.getElementById('action-runtime-status-slot')

  return (
    <>
      {activity &&
        statusTarget &&
        createPortal(
          <div
            className="action-runtime-active"
            role="status"
            aria-live="polite"
            aria-label={activityLabel}
          >
            <ProgressCircle isIndeterminate size="S" aria-label={activityLabel} />
            <Text UNSAFE_className="action-runtime-active-label">{activityLabel}</Text>
            <TooltipTrigger delay={200}>
              <ActionButton isQuiet aria-label={t('actions.emergencyStop')} onPress={emergencyStop}>
                <StopProcessing />
              </ActionButton>
              <Tooltip>{t('actions.emergencyStop')}</Tooltip>
            </TooltipTrigger>
          </div>,
          statusTarget,
        )}
      <DialogContainer onDismiss={() => answerAction('cancel')}>
        {confirmation && (
          <Dialog size="M" aria-label={t('actions.confirm.title')}>
            <Heading slot="title">{t('actions.confirm.title')}</Heading>
            <Content>
              <div className="action-confirmation-content">
                {confirmation.risk === 'destructive' && (
                  <InlineAlert variant="negative" fillStyle="subtleFill">
                    <Heading>{t('actions.confirm.destructiveTitle')}</Heading>
                    <Content>{t('actions.confirm.destructiveDescription')}</Content>
                  </InlineAlert>
                )}
                <Text>{confirmation.goal}</Text>
                {confirmation.tool === 'desktop.workflow' && confirmation.shellCommand && (
                  <div>
                    <Text UNSAFE_className="action-confirmation-label">
                      {t('actions.confirm.command')}
                    </Text>
                    <code className="action-confirmation-command">{confirmation.shellCommand}</code>
                  </div>
                )}
                {confirmation.tool === 'desktop.workflow' && confirmation.browserOperation && (
                  <div>
                    <Text UNSAFE_className="action-confirmation-label">
                      {t(BROWSER_OPERATION_LABELS[confirmation.browserOperation.operation])}
                    </Text>
                    <code className="action-confirmation-command">
                      {browserOperationDetail(confirmation.browserOperation)}
                    </code>
                  </div>
                )}
                {confirmation.tool === 'browser.game-session' && (
                  <div>
                    <Text UNSAFE_className="action-confirmation-label">
                      {t('actions.confirm.gameSession')}
                    </Text>
                    <dl className="action-confirmation-capabilities">
                      <div>
                        <dt>{t('actions.confirm.gameOrigin')}</dt>
                        <dd>{confirmation.origin}</dd>
                      </div>
                      <div>
                        <dt>{t('actions.confirm.gameSurface')}</dt>
                        <dd>{confirmation.surfaceLabel ?? confirmation.surfaceId}</dd>
                      </div>
                      <div>
                        <dt>{t('actions.confirm.gameDuration')}</dt>
                        <dd>
                          {Math.ceil(confirmation.maxDurationMs / 60_000)}{' '}
                          {t('actions.confirm.minutesShort')}
                        </dd>
                      </div>
                      <div>
                        <dt>{t('actions.confirm.gameInputBudget')}</dt>
                        <dd>
                          {confirmation.maxInputEvents} · {confirmation.maxInputEventsPerSecond}/s
                        </dd>
                      </div>
                      <div>
                        <dt>{t('actions.confirm.gameInputs')}</dt>
                        <dd>
                          {confirmation.allowedInputs
                            .map((input) =>
                              t(
                                input === 'pointer'
                                  ? 'actions.confirm.gameInputPointer'
                                  : 'actions.confirm.gameInputKeyboard',
                              ),
                            )
                            .join(', ')}
                        </dd>
                      </div>
                      <div>
                        <dt>{t('actions.confirm.gameNavigation')}</dt>
                        <dd>
                          {t(
                            confirmation.navigation === 'none'
                              ? 'actions.confirm.gameNavigationNone'
                              : 'actions.confirm.gameNavigationSameOrigin',
                          )}
                        </dd>
                      </div>
                    </dl>
                  </div>
                )}
                <div>
                  <Text UNSAFE_className="action-confirmation-label">
                    {t('actions.confirm.scope')}
                  </Text>
                  <ul className="action-confirmation-capabilities">
                    {confirmation.requestedCapabilities.map((capability) => (
                      <li key={capability}>
                        {capability === 'browser-game-control'
                          ? t('actions.capability.browserGameControl')
                          : t(CAPABILITY_LABELS[capability])}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </Content>
            <ButtonGroup slot="buttonGroup">
              <Button
                variant="secondary"
                onPress={() => answerAction('cancel')}
                isDisabled={responding}
              >
                {t('common.cancel')}
              </Button>
              <Button variant="negative" onPress={emergencyStop} isDisabled={responding}>
                {t('actions.emergencyStop')}
              </Button>
              <Button
                variant="accent"
                onPress={() => answerAction('confirm')}
                isDisabled={responding}
                UNSAFE_className="shio-accent-button"
              >
                {t('actions.confirm.execute')}
              </Button>
            </ButtonGroup>
          </Dialog>
        )}
      </DialogContainer>
      <DialogContainer onDismiss={() => answerAuthority('cancel')}>
        {authorityChange && (
          <Dialog size="M" aria-label={t('actions.fullControl.title')}>
            <Heading slot="title">{t('actions.fullControl.title')}</Heading>
            <Content>
              <Text>{t('actions.fullControl.description')}</Text>
            </Content>
            <ButtonGroup slot="buttonGroup">
              <Button
                variant="secondary"
                onPress={() => answerAuthority('cancel')}
                isDisabled={responding}
              >
                {t('common.cancel')}
              </Button>
              <Button
                variant="negative"
                onPress={() => answerAuthority('confirm')}
                isDisabled={responding}
              >
                {t('actions.fullControl.enable')}
              </Button>
            </ButtonGroup>
          </Dialog>
        )}
      </DialogContainer>
    </>
  )
}
