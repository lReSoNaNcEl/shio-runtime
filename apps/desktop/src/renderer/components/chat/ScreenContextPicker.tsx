import {
  ActionButton,
  Button,
  Content,
  Dialog,
  DialogContainer,
  Disclosure,
  DisclosurePanel,
  DisclosureTitle,
  Footer,
  Heading,
  ProgressCircle,
  StatusLight,
  Text,
  TextField,
  Tooltip,
  TooltipTrigger,
} from '@react-spectrum/s2'
import RefreshIcon from '@react-spectrum/s2/icons/Refresh'
import { useCallback, useEffect, useRef, useState } from 'react'

import {
  type ScreenContextCaptureDescriptor,
  type ScreenContextErrorCode,
  type ScreenContextSource,
} from '../../../shared/screen-context'
import { watchReferenceUrl } from '../../../shared/watchTogether'
import { useTranslation } from '../../localization/useTranslation'
import { observeRendererPromise } from '../../reliability/observePromise'
import { ScreenSourceGrid } from './ScreenSourceGrid'
import { screenContextErrorMessage } from './screenContextErrorMessage'

type PickerState =
  | 'checking-capability'
  | 'unsupported'
  | 'loading-sources'
  | 'source-list'
  | 'capturing'
  | 'error'

interface Props {
  isOpen: boolean
  onDismiss: () => void
  onChangeModel: () => void
  referenceAvailable?: boolean
  onWatch?: (sourceId: string, sourceName: string, reference?: string) => void
  onAttach?: (capture: ScreenContextCaptureDescriptor) => void
}

export function ScreenContextPicker({
  isOpen,
  onDismiss,
  onChangeModel,
  onAttach,
  onWatch,
  referenceAvailable,
}: Props) {
  const { t } = useTranslation()
  const [state, setState] = useState<PickerState>('checking-capability')
  const [sources, setSources] = useState<ScreenContextSource[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [checkingSource, setCheckingSource] = useState(false)
  const [warmup, setWarmup] = useState<'pending' | 'ready' | 'failed'>('ready')
  const isWatchPicker = Boolean(onWatch)
  const [reference, setReference] = useState('')
  const referenceUrl = watchReferenceUrl(reference.trim())
  const invalidReference = Boolean(reference.trim() && !referenceUrl)
  const [errorCode, setErrorCode] = useState<ScreenContextErrorCode | null>(null)
  const operationIdRef = useRef(0)
  const mainOperationIdRef = useRef<string | null>(null)

  const loadSources = useCallback(async (existingOperationId?: number): Promise<void> => {
    const operationId = existingOperationId ?? ++operationIdRef.current
    setState('loading-sources')
    setErrorCode(null)
    setSelectedId(null)
    setCheckingSource(false)
    try {
      const result = await window.api.screenContext.listSources()
      if (operationId !== operationIdRef.current) return
      if (!result.ok) {
        if (result.error.code === 'NO_SOURCES') {
          setSources([])
          setState('source-list')
          return
        }
        setErrorCode(result.error.code)
        setState('error')
        return
      }
      setSources(result.value)
      setState('source-list')
    } catch {
      if (operationId !== operationIdRef.current) return
      setErrorCode('UNKNOWN')
      setState('error')
    }
  }, [])

  const refreshCapabilities = useCallback(async (): Promise<void> => {
    const operationId = ++operationIdRef.current
    setState('checking-capability')
    setErrorCode(null)
    setSelectedId(null)
    setCheckingSource(false)
    try {
      const capabilities = await window.api.llm.getActiveCapabilities()
      if (operationId !== operationIdRef.current) return
      if (!capabilities.supportsVision) {
        setState('unsupported')
        return
      }
      await loadSources(operationId)
    } catch {
      if (operationId !== operationIdRef.current) return
      setErrorCode('UNKNOWN')
      setState('error')
    }
  }, [loadSources])

  useEffect(() => {
    if (!isOpen) {
      setReference('')
      operationIdRef.current += 1
      const mainOperationId = mainOperationIdRef.current
      mainOperationIdRef.current = null
      if (mainOperationId) {
        observeRendererPromise(
          window.api.screenContext.cancelOperation(mainOperationId),
          'cancel closed Screen Context picker operation',
        )
      }
      return
    }
    let revision = 0
    const prepare = () => {
      if (!isWatchPicker) return
      const current = ++revision
      setWarmup('pending')
      void window.api.watchTogether.prepareModel().then(
        (ready) => {
          if (revision === current) setWarmup(ready ? 'ready' : 'failed')
        },
        () => {
          if (revision === current) setWarmup('failed')
        },
      )
    }
    prepare()
    observeRendererPromise(refreshCapabilities(), 'load Screen Context capabilities')
    const unsubscribe = window.api.config.onUpdated((_config, key) => {
      if (key === 'llm' || key === undefined) prepare()
      observeRendererPromise(refreshCapabilities(), 'refresh Screen Context capabilities')
    })
    return () => {
      ++revision
      operationIdRef.current += 1
      const mainOperationId = mainOperationIdRef.current
      mainOperationIdRef.current = null
      if (mainOperationId) {
        observeRendererPromise(
          window.api.screenContext.cancelOperation(mainOperationId),
          'cancel Screen Context picker operation during cleanup',
        )
      }
      unsubscribe()
    }
  }, [isOpen, isWatchPicker, refreshCapabilities])

  const selectSource = async (source: ScreenContextSource | null): Promise<void> => {
    const operationId = ++operationIdRef.current
    setErrorCode(null)
    setSelectedId(source?.id ?? null)
    setCheckingSource(Boolean(source))
    if (!source) return
    try {
      const result = await window.api.screenContext.checkSource(source.id)
      if (operationId !== operationIdRef.current || result.ok) return
      setSelectedId(null)
      setErrorCode(result.error.code)
      if (result.error.code === 'SOURCE_NOT_FOUND')
        setSources((current) => current.filter((candidate) => candidate.id !== source.id))
    } catch {
      if (operationId !== operationIdRef.current) return
      setSelectedId(null)
      setErrorCode('UNKNOWN')
    } finally {
      if (operationId === operationIdRef.current) setCheckingSource(false)
    }
  }

  const attach = async (): Promise<void> => {
    if (!selectedId || checkingSource) return
    if (onWatch) {
      const source = sources.find((candidate) => candidate.id === selectedId)
      if (!source) return
      if (referenceAvailable && invalidReference) return
      const onlyScreen =
        source.kind === 'screen' &&
        !sources.some((candidate) => candidate.kind === 'screen' && candidate.id !== source.id)
      const name = onlyScreen ? t('watch.source.entireScreen') : source.name
      onWatch(source.id, name, referenceAvailable ? referenceUrl : undefined)
      onDismiss()
      return
    }
    setState('capturing')
    setErrorCode(null)
    const operationId = ++operationIdRef.current
    const mainOperationId = crypto.randomUUID()
    mainOperationIdRef.current = mainOperationId
    try {
      const result = await window.api.screenContext.capture({
        operationId: mainOperationId,
        sourceId: selectedId,
      })
      if (operationId !== operationIdRef.current) {
        if (result.ok) await window.api.screenContext.release(result.value.captureId)
        return
      }
      mainOperationIdRef.current = null
      if (!result.ok) {
        setErrorCode(result.error.code)
        setState('error')
        return
      }
      onAttach?.(result.value)
      onDismiss()
    } catch {
      if (operationId !== operationIdRef.current) return
      mainOperationIdRef.current = null
      setErrorCode('UNKNOWN')
      setState('error')
    }
  }

  const busy =
    state === 'checking-capability' || state === 'loading-sources' || state === 'capturing'

  return (
    <DialogContainer onDismiss={onDismiss}>
      {isOpen && (
        <Dialog size="L" isDismissible UNSAFE_className="screen-context-picker-dialog">
          <Heading slot="title">
            {t(onWatch ? 'watch.picker.title' : 'screenContext.picker.title')}
          </Heading>
          <Content UNSAFE_className="screen-context-picker-content">
            <div className="screen-context-picker">
              {onWatch && warmup !== 'ready' && (
                <StatusLight variant={warmup === 'pending' ? 'informative' : 'notice'}>
                  {t(warmup === 'pending' ? 'watch.model.warming' : 'watch.model.failed')}
                </StatusLight>
              )}
              {onWatch && state === 'source-list' && sources.length > 0 && (
                <Text UNSAFE_className="screen-context-share-hint">{t('watch.description')}</Text>
              )}
              {busy && (
                <div className="screen-context-picker-state">
                  <ProgressCircle aria-label={t('common.loading')} isIndeterminate size="L" />
                  <Text>
                    {state === 'checking-capability'
                      ? t('screenContext.picker.checking')
                      : state === 'capturing'
                        ? t('screenContext.picker.capturing')
                        : t('screenContext.picker.loading')}
                  </Text>
                </div>
              )}
              {state === 'unsupported' && (
                <div className="screen-context-picker-state" role="status">
                  <Heading level={3}>{t('screenContext.unsupported.title')}</Heading>
                  <Text>{t('screenContext.unsupported.description')}</Text>
                  <Button
                    variant="accent"
                    onPress={onChangeModel}
                    UNSAFE_className="shio-accent-button"
                  >
                    {t('screenContext.unsupported.changeModel')}
                  </Button>
                </div>
              )}
              {state === 'error' && errorCode && (
                <div className="screen-context-picker-state" role="alert">
                  <Heading level={3}>{t('common.error')}</Heading>
                  <Text>{screenContextErrorMessage(errorCode, t)}</Text>
                  <Button
                    variant="secondary"
                    onPress={() =>
                      observeRendererPromise(loadSources(), 'reload Screen Context sources')
                    }
                  >
                    {t('common.retry')}
                  </Button>
                </div>
              )}
              {state === 'source-list' && (
                <ScreenSourceGrid
                  sources={sources}
                  selectedId={selectedId}
                  onSelect={(source) =>
                    observeRendererPromise(
                      selectSource(source),
                      'check selected Screen Context source',
                    )
                  }
                />
              )}
              {state === 'source-list' && checkingSource && (
                <StatusLight size="S" variant="neutral" role="status">
                  {t('screenContext.picker.checkingSource')}
                </StatusLight>
              )}
              {state === 'source-list' && errorCode && (
                <StatusLight size="S" variant="notice" role="status">
                  {errorCode === 'UNKNOWN'
                    ? t('screenContext.picker.checkSourceFailed')
                    : screenContextErrorMessage(errorCode, t)}
                </StatusLight>
              )}
              {state === 'source-list' && sources.length === 0 && (
                <div role="status">
                  <Text>{t('screenContext.picker.noSources')}</Text>
                </div>
              )}
              {onWatch && referenceAvailable && state === 'source-list' && sources.length > 0 && (
                <Disclosure isQuiet>
                  <DisclosureTitle level={3}>
                    {invalidReference
                      ? t('watch.reference.fix')
                      : referenceUrl
                        ? t('watch.reference.selected', { host: new URL(referenceUrl).host })
                        : t('watch.reference.group')}
                  </DisclosureTitle>
                  <DisclosurePanel>
                    <TextField
                      label={t('watch.reference.label')}
                      type="url"
                      value={reference}
                      onChange={setReference}
                      description={t('watch.reference.description')}
                      isInvalid={invalidReference}
                      errorMessage={t('watch.reference.invalid')}
                      UNSAFE_className="screen-context-reference-url"
                    />
                  </DisclosurePanel>
                </Disclosure>
              )}
            </div>
          </Content>
          <Footer>
            <div className="screen-context-picker-actions">
              {state === 'source-list' && (
                <TooltipTrigger delay={200}>
                  <ActionButton
                    isQuiet
                    aria-label={t('screenContext.picker.refresh')}
                    UNSAFE_className="screen-context-picker-refresh"
                    onPress={() =>
                      observeRendererPromise(loadSources(), 'refresh Screen Context sources')
                    }
                  >
                    <RefreshIcon />
                  </ActionButton>
                  <Tooltip>{t('screenContext.picker.refresh')}</Tooltip>
                </TooltipTrigger>
              )}
              <Button variant="secondary" onPress={onDismiss}>
                {t('common.cancel')}
              </Button>
              {state === 'source-list' && (
                <Button
                  variant="accent"
                  isDisabled={
                    !selectedId ||
                    (isWatchPicker && warmup === 'pending') ||
                    checkingSource ||
                    Boolean(onWatch && referenceAvailable && invalidReference)
                  }
                  onPress={() =>
                    observeRendererPromise(attach(), 'attach selected Screen Context source')
                  }
                  UNSAFE_className="shio-accent-button"
                >
                  {t(onWatch ? 'watch.start' : 'screenContext.picker.attach')}
                </Button>
              )}
            </div>
          </Footer>
        </Dialog>
      )}
    </DialogContainer>
  )
}
