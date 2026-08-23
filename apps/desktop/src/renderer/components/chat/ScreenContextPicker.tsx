import {
  Badge,
  Button,
  Content,
  Dialog,
  DialogContainer,
  Footer,
  Heading,
  ProgressCircle,
  Text,
  ToggleButton,
} from '@react-spectrum/s2'
import { useCallback, useEffect, useRef, useState } from 'react'

import {
  type ScreenContextCaptureDescriptor,
  type ScreenContextErrorCode,
  type ScreenContextSource,
} from '../../../shared/screen-context'
import { useTranslation } from '../../localization/useTranslation'
import { observeRendererPromise } from '../../reliability/observePromise'
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
  onAttach: (capture: ScreenContextCaptureDescriptor) => void
}

export function ScreenContextPicker({ isOpen, onDismiss, onChangeModel, onAttach }: Props) {
  const { t } = useTranslation()
  const [state, setState] = useState<PickerState>('checking-capability')
  const [sources, setSources] = useState<ScreenContextSource[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [errorCode, setErrorCode] = useState<ScreenContextErrorCode | null>(null)
  const operationIdRef = useRef(0)
  const mainOperationIdRef = useRef<string | null>(null)

  const loadSources = useCallback(async (existingOperationId?: number): Promise<void> => {
    const operationId = existingOperationId ?? ++operationIdRef.current
    setState('loading-sources')
    setErrorCode(null)
    setSelectedId(null)
    try {
      const result = await window.api.screenContext.listSources()
      if (operationId !== operationIdRef.current) return
      if (!result.ok) {
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
    observeRendererPromise(refreshCapabilities(), 'load Screen Context capabilities')
    const unsubscribe = window.api.config.onUpdated(() => {
      observeRendererPromise(refreshCapabilities(), 'refresh Screen Context capabilities')
    })
    return () => {
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
  }, [isOpen, refreshCapabilities])

  const attach = async (): Promise<void> => {
    if (!selectedId) return
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
      onAttach(result.value)
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
        <Dialog size="L" isDismissible>
          <Heading>{t('screenContext.picker.title')}</Heading>
          <Content>
            <div className="screen-context-picker">
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
                  <Button variant="accent" onPress={onChangeModel}>
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
                <div className="screen-context-source-grid">
                  {sources.map((source) => {
                    const selected = source.id === selectedId
                    return (
                      <ToggleButton
                        key={source.id}
                        isSelected={selected}
                        UNSAFE_className="screen-context-source"
                        onChange={(isSelected) => setSelectedId(isSelected ? source.id : null)}
                      >
                        <img src={source.previewDataUrl} alt="" />
                        <span className="screen-context-source-info">
                          <span className="screen-context-source-name" title={source.name}>
                            {source.name}
                          </span>
                          <Badge
                            size="S"
                            variant={source.kind === 'screen' ? 'informative' : 'gray'}
                          >
                            {source.kind === 'screen'
                              ? t('screenContext.source.screen')
                              : t('screenContext.source.window')}
                          </Badge>
                        </span>
                      </ToggleButton>
                    )
                  })}
                </div>
              )}
            </div>
          </Content>
          <Footer>
            <div className="screen-context-picker-actions">
              {state === 'source-list' && (
                <Button
                  variant="secondary"
                  onPress={() =>
                    observeRendererPromise(loadSources(), 'retry Screen Context sources')
                  }
                >
                  {t('screenContext.picker.refresh')}
                </Button>
              )}
              <Button variant="secondary" onPress={onDismiss}>
                {t('common.cancel')}
              </Button>
              {state === 'source-list' && (
                <Button
                  variant="accent"
                  isDisabled={!selectedId}
                  onPress={() =>
                    observeRendererPromise(attach(), 'attach selected Screen Context source')
                  }
                >
                  {t('screenContext.picker.attach')}
                </Button>
              )}
            </div>
          </Footer>
        </Dialog>
      )}
    </DialogContainer>
  )
}
