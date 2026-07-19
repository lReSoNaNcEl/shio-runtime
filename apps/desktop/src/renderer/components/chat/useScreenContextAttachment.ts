import { useEffect, useRef, useState } from 'react'

import {
  SCREEN_CONTEXT_IMPORT_LIMITS,
  type ScreenContextCaptureDescriptor,
} from '../../../shared/screen-context'
import { useTranslation } from '../../localization/useTranslation'
import { screenContextErrorMessage } from './screenContextErrorMessage'
import { isSupportedImageFile } from './screenContextImageInput'

export interface ScreenContextAttachmentController {
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
  submitCaptureId: () => Promise<string | undefined>
}

export function useScreenContextAttachment(): ScreenContextAttachmentController {
  const { t } = useTranslation()
  const [pending, setPending] = useState<ScreenContextCaptureDescriptor | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const [importing, setImporting] = useState(false)
  const [recapturing, setRecapturing] = useState(false)
  const pendingRef = useRef<ScreenContextCaptureDescriptor | null>(null)
  const operationIdRef = useRef(0)
  const operationActiveRef = useRef(false)

  useEffect(
    () => () => {
      operationIdRef.current += 1
      operationActiveRef.current = false
      const capture = pendingRef.current
      pendingRef.current = null
      if (capture) void window.api.screenContext.release(capture.captureId)
    },
    [],
  )

  const setInputError = (message: string): void => {
    setError(message)
  }

  const release = async (): Promise<void> => {
    operationIdRef.current += 1
    operationActiveRef.current = false
    setImporting(false)
    setRecapturing(false)
    setDragActive(false)
    const capture = pendingRef.current
    pendingRef.current = null
    setPending(null)
    setError(null)
    setPickerOpen(false)
    if (capture) await window.api.screenContext.release(capture.captureId)
  }

  const attach = (capture: ScreenContextCaptureDescriptor): void => {
    operationIdRef.current += 1
    operationActiveRef.current = false
    setImporting(false)
    setRecapturing(false)
    pendingRef.current = capture
    setPending(capture)
    setError(null)
  }

  const importFile = async (file: File, sourceKind: 'clipboard' | 'file'): Promise<void> => {
    if (operationActiveRef.current) return
    if (!isSupportedImageFile(file)) {
      setError(t('screenContext.input.unsupportedType'))
      return
    }
    if (file.size <= 0 || file.size > SCREEN_CONTEXT_IMPORT_LIMITS.maxInputBytes) {
      setError(t('screenContext.input.tooLarge'))
      return
    }
    const operationId = ++operationIdRef.current
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
      pendingRef.current = result.value
      setPending(result.value)
      setError(null)
    } catch {
      if (operationId === operationIdRef.current) {
        setError(t('screenContext.error.unknown'))
      }
    } finally {
      if (operationId === operationIdRef.current) {
        operationActiveRef.current = false
        setImporting(false)
      }
    }
  }

  const recapture = async (): Promise<void> => {
    const capture = pendingRef.current
    if (!capture?.canRecapture || operationActiveRef.current) return
    const operationId = ++operationIdRef.current
    operationActiveRef.current = true
    setRecapturing(true)
    setError(null)
    try {
      const result = await window.api.screenContext.recapture(capture.captureId)
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
    } catch {
      if (operationId === operationIdRef.current) {
        setError(t('screenContext.error.unknown'))
      }
    } finally {
      if (operationId === operationIdRef.current) {
        operationActiveRef.current = false
        setRecapturing(false)
      }
    }
  }

  const submitCaptureId = async (): Promise<string | undefined> => {
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
    pendingRef.current = null
    setPending(null)
    return capture.captureId
  }

  return {
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
    submitCaptureId,
  }
}
