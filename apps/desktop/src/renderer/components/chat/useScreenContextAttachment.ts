import { useEffect, useRef, useState } from 'react'

import {
  SCREEN_CONTEXT_IMPORT_LIMITS,
  type ScreenContextCaptureDescriptor,
} from '../../../shared/screen-context'
import { useTranslation } from '../../localization/useTranslation'
import { observeRendererPromise } from '../../reliability/observePromise'
import type { ChatSubmissionResult } from '../../speech/continuous-listening/types'
import { screenContextErrorMessage } from './screenContextErrorMessage'
import { isSupportedImageFile, isSupportedImageMimeType } from './screenContextImageInput'

export interface ScreenContextAttachmentController {
  state: ScreenContextAttachmentState
  pending: ScreenContextCaptureDescriptor | null
  error: string | null
  pickerOpen: boolean
  setPickerOpen: (isOpen: boolean) => void
  dragActive: boolean
  setDragActive: (active: boolean) => void
  importing: boolean
  recapturing: boolean
  attach: (capture: ScreenContextCaptureDescriptor) => void
  setInputError: (message: string) => void
  release: () => Promise<void>
  importFile: (file: File, sourceKind: 'clipboard' | 'file') => Promise<void>
  recapture: () => Promise<void>
  beginSubmission: () => Promise<string | undefined>
  settleSubmission: (result: ChatSubmissionResult) => void
}

export type ScreenContextAttachmentState =
  | 'empty'
  | 'pending'
  | 'submitting'
  | 'retryable'
  | 'expired'

export function useScreenContextAttachment(): ScreenContextAttachmentController {
  const { t } = useTranslation()
  const [pending, setPending] = useState<ScreenContextCaptureDescriptor | null>(null)
  const [state, setState] = useState<ScreenContextAttachmentState>('empty')
  const [error, setError] = useState<string | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const [importing, setImporting] = useState(false)
  const [recapturing, setRecapturing] = useState(false)
  const pendingRef = useRef<ScreenContextCaptureDescriptor | null>(null)
  const operationIdRef = useRef(0)
  const mainOperationIdRef = useRef<string | null>(null)
  const operationActiveRef = useRef(false)

  useEffect(
    () => () => {
      operationIdRef.current += 1
      operationActiveRef.current = false
      const mainOperationId = mainOperationIdRef.current
      mainOperationIdRef.current = null
      const capture = pendingRef.current
      pendingRef.current = null
      if (mainOperationId) {
        observeRendererPromise(
          window.api.screenContext.cancelOperation(mainOperationId),
          'cancel Screen Context operation during cleanup',
        )
      }
      if (capture) {
        observeRendererPromise(
          window.api.screenContext.release(capture.captureId),
          'release Screen Context capture during cleanup',
        )
      }
    },
    [],
  )

  const setInputError = (message: string): void => {
    setError(message)
  }

  const release = async (): Promise<void> => {
    operationIdRef.current += 1
    operationActiveRef.current = false
    const mainOperationId = mainOperationIdRef.current
    mainOperationIdRef.current = null
    setImporting(false)
    setRecapturing(false)
    setDragActive(false)
    const capture = pendingRef.current
    pendingRef.current = null
    setPending(null)
    setState('empty')
    setError(null)
    setPickerOpen(false)
    if (mainOperationId) {
      await window.api.screenContext.cancelOperation(mainOperationId)
    }
    if (capture) await window.api.screenContext.release(capture.captureId)
  }

  const attach = (capture: ScreenContextCaptureDescriptor): void => {
    operationIdRef.current += 1
    operationActiveRef.current = false
    setImporting(false)
    setRecapturing(false)
    const previousCapture = pendingRef.current
    pendingRef.current = capture
    setPending(capture)
    setState('pending')
    setError(null)
    if (previousCapture && previousCapture.captureId !== capture.captureId) {
      observeRendererPromise(
        window.api.screenContext.release(previousCapture.captureId),
        'release replaced Screen Context capture',
      )
    }
  }

  const importFile = async (file: File, sourceKind: 'clipboard' | 'file'): Promise<void> => {
    if (operationActiveRef.current) return
    if (!isSupportedImageMimeType(file.type)) {
      setError(t('screenContext.input.unsupportedType'))
      return
    }
    if (sourceKind === 'file' && !isSupportedImageFile(file)) {
      setError(t('screenContext.input.unsupportedType'))
      return
    }
    if (file.size <= 0 || file.size > SCREEN_CONTEXT_IMPORT_LIMITS.maxInputBytes) {
      setError(t('screenContext.input.tooLarge'))
      return
    }
    const operationId = ++operationIdRef.current
    const mainOperationId = crypto.randomUUID()
    mainOperationIdRef.current = mainOperationId
    operationActiveRef.current = true
    setImporting(true)
    setError(null)
    try {
      const capabilities = await window.api.llm.getActiveCapabilities()
      if (operationId !== operationIdRef.current) return
      if (!capabilities.supportsVision) {
        setError(t('screenContext.error.visionUnsupported'))
        return
      }
      const bytes = await file.arrayBuffer()
      if (operationId !== operationIdRef.current) return
      const result = await window.api.screenContext.importImage({
        operationId: mainOperationId,
        bytes,
        mimeType: file.type,
        sourceKind,
        sourceName: sourceKind === 'file' ? file.name.slice(0, 255) : undefined,
      })
      if (operationId !== operationIdRef.current) {
        if (result.ok) await window.api.screenContext.release(result.value.captureId)
        return
      }
      if (!result.ok) {
        setError(screenContextErrorMessage(result.error.code, t))
        return
      }
      const previousCapture = pendingRef.current
      pendingRef.current = result.value
      setPending(result.value)
      setState('pending')
      setError(null)
      if (previousCapture && previousCapture.captureId !== result.value.captureId) {
        observeRendererPromise(
          window.api.screenContext.release(previousCapture.captureId),
          'release replaced imported Screen Context capture',
        )
      }
    } catch {
      if (operationId === operationIdRef.current) {
        setError(t('screenContext.error.unknown'))
      }
    } finally {
      if (operationId === operationIdRef.current) {
        if (mainOperationIdRef.current === mainOperationId) {
          mainOperationIdRef.current = null
        }
        operationActiveRef.current = false
        setImporting(false)
      }
    }
  }

  const recapture = async (): Promise<void> => {
    const capture = pendingRef.current
    if (!capture?.canRecapture || operationActiveRef.current) return
    const operationId = ++operationIdRef.current
    const mainOperationId = crypto.randomUUID()
    mainOperationIdRef.current = mainOperationId
    operationActiveRef.current = true
    setRecapturing(true)
    setError(null)
    try {
      const result = await window.api.screenContext.recapture({
        operationId: mainOperationId,
        captureId: capture.captureId,
      })
      if (operationId !== operationIdRef.current) {
        if (result.ok) await window.api.screenContext.release(result.value.captureId)
        return
      }
      if (!result.ok) {
        setError(screenContextErrorMessage(result.error.code, t))
        return
      }
      pendingRef.current = result.value
      setPending(result.value)
      setState('pending')
      if (capture.captureId !== result.value.captureId) {
        observeRendererPromise(
          window.api.screenContext.release(capture.captureId),
          'release replaced recaptured Screen Context capture',
        )
      }
    } catch {
      if (operationId === operationIdRef.current) {
        setError(t('screenContext.error.unknown'))
      }
    } finally {
      if (operationId === operationIdRef.current) {
        if (mainOperationIdRef.current === mainOperationId) {
          mainOperationIdRef.current = null
        }
        operationActiveRef.current = false
        setRecapturing(false)
      }
    }
  }

  const beginSubmission = async (): Promise<string | undefined> => {
    if (operationActiveRef.current) return undefined
    const capture = pendingRef.current
    if (!capture) return undefined
    try {
      const capabilities = await window.api.llm.getActiveCapabilities()
      if (!capabilities.supportsVision) {
        setError(t('screenContext.error.visionUnsupported'))
        return undefined
      }
    } catch {
      setError(t('screenContext.error.unknown'))
      return undefined
    }
    if (operationActiveRef.current || pendingRef.current?.captureId !== capture.captureId) {
      return undefined
    }
    setError(null)
    setState('submitting')
    return capture.captureId
  }

  const settleSubmission = (result: ChatSubmissionResult): void => {
    if (!pendingRef.current) {
      setState('empty')
      return
    }
    if (result.status === 'completed') {
      pendingRef.current = null
      setPending(null)
      setState('empty')
      return
    }
    if (result.status === 'cancelled') {
      setState('retryable')
      return
    }
    if (result.failure.attachmentDisposition === 'retained') {
      setState('retryable')
      return
    }
    pendingRef.current = null
    setPending(null)
    setState(result.failure.attachmentDisposition === 'expired' ? 'expired' : 'empty')
  }

  return {
    state,
    pending,
    error,
    pickerOpen,
    setPickerOpen,
    dragActive,
    setDragActive,
    importing,
    recapturing,
    attach,
    setInputError,
    release,
    importFile,
    recapture,
    beginSubmission,
    settleSubmission,
  }
}
