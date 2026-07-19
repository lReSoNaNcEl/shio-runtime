import {
  Badge,
  Button,
  Content,
  Dialog,
  DialogContainer,
  Footer,
  Heading,
  ProgressCircle,
} from '@react-spectrum/s2'
import { useCallback, useEffect, useRef, useState } from 'react'

import type {
  ScreenContextCaptureDescriptor,
  ScreenContextErrorCode,
  ScreenContextSource,
} from '../../shared/screen-context/contracts'
import { useTranslation } from '../localization/useTranslation'

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
  onBeforeCapture: () => Promise<void>
  onAttach: (capture: ScreenContextCaptureDescriptor) => void
}

export function ScreenContextPicker({
  isOpen,
  onDismiss,
  onChangeModel,
  onBeforeCapture,
  onAttach,
}: Props): React.JSX.Element {
  const { t } = useTranslation()
  const [state, setState] = useState<PickerState>('checking-capability')
  const [sources, setSources] = useState<ScreenContextSource[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [errorCode, setErrorCode] = useState<ScreenContextErrorCode | null>(null)
  const operationIdRef = useRef(0)

  const errorMessage = (code: ScreenContextErrorCode): string => {
    const keys: Record<ScreenContextErrorCode, Parameters<typeof t>[0]> = {
      VISION_UNSUPPORTED: 'screenContext.error.visionUnsupported',
      PERMISSION_DENIED: 'screenContext.error.permissionDenied',
      NO_SOURCES: 'screenContext.error.noSources',
      SOURCE_NOT_FOUND: 'screenContext.error.sourceNotFound',
      CAPTURE_EMPTY: 'screenContext.error.captureEmpty',
      CAPTURE_TOO_LARGE: 'screenContext.error.captureTooLarge',
      CAPTURE_EXPIRED: 'screenContext.error.captureExpired',
      CAPTURE_NOT_OWNED: 'screenContext.error.captureNotOwned',
      UNKNOWN: 'screenContext.error.unknown',
    }
    return t(keys[code])
  }

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
      return
    }
    void refreshCapabilities()
    const unsubscribe = window.api.config.onUpdated(() => {
      void refreshCapabilities()
    })
    return () => {
      operationIdRef.current += 1
      unsubscribe()
    }
  }, [isOpen, refreshCapabilities])

  const attach = async (): Promise<void> => {
    if (!selectedId) return
    setState('capturing')
    setErrorCode(null)
    try {
      await onBeforeCapture()
      const result = await window.api.screenContext.capture(selectedId)
      if (!result.ok) {
        setErrorCode(result.error.code)
        setState('error')
        return
      }
      onAttach(result.value)
      onDismiss()
    } catch {
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
                  <p>
                    {state === 'checking-capability'
                      ? t('screenContext.picker.checking')
                      : state === 'capturing'
                        ? t('screenContext.picker.capturing')
                        : t('screenContext.picker.loading')}
                  </p>
                </div>
              )}
              {state === 'unsupported' && (
                <div className="screen-context-picker-state" role="status">
                  <Heading level={3}>{t('screenContext.unsupported.title')}</Heading>
                  <p>{t('screenContext.unsupported.description')}</p>
                  <Button variant="accent" onPress={onChangeModel}>
                    {t('screenContext.unsupported.changeModel')}
                  </Button>
                </div>
              )}
              {state === 'error' && errorCode && (
                <div className="screen-context-picker-state" role="alert">
                  <Heading level={3}>{t('common.error')}</Heading>
                  <p>{errorMessage(errorCode)}</p>
                  <Button variant="secondary" onPress={() => void loadSources()}>
                    {t('common.retry')}
                  </Button>
                </div>
              )}
              {state === 'source-list' && (
                <div className="screen-context-source-grid">
                  {sources.map((source) => {
                    const selected = source.id === selectedId
                    return (
                      <button
                        key={source.id}
                        type="button"
                        className={`screen-context-source${selected ? ' selected' : ''}`}
                        aria-pressed={selected}
                        onClick={() => setSelectedId(source.id)}
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
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </Content>
          <Footer>
            <div className="screen-context-picker-actions">
              {state === 'source-list' && (
                <Button variant="secondary" onPress={() => void loadSources()}>
                  {t('screenContext.picker.refresh')}
                </Button>
              )}
              <Button variant="secondary" onPress={onDismiss}>
                {t('common.cancel')}
              </Button>
              {state === 'source-list' && (
                <Button variant="accent" isDisabled={!selectedId} onPress={() => void attach()}>
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
