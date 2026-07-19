import { useEffect, useRef, useState } from 'react'

import type { ScreenContextCaptureDescriptor } from '../../../shared/screen-context'
import { useTranslation } from '../../localization/useTranslation'

export function useScreenContextAttachment(): {
  pending: ScreenContextCaptureDescriptor | null
  submitError: string | null
  pickerOpen: boolean
  setPickerOpen: (isOpen: boolean) => void
  attach: (capture: ScreenContextCaptureDescriptor) => void
  release: () => Promise<void>
  submitCaptureId: () => Promise<string | undefined>
} {
  const { t } = useTranslation()
  const [pending, setPending] = useState<ScreenContextCaptureDescriptor | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const pendingRef = useRef<ScreenContextCaptureDescriptor | null>(null)

  useEffect(
    () => () => {
      const capture = pendingRef.current
      if (capture) void window.api.screenContext.release(capture.captureId)
    },
    [],
  )

  const release = async (): Promise<void> => {
    const capture = pendingRef.current
    pendingRef.current = null
    setPending(null)
    setSubmitError(null)
    setPickerOpen(false)
    if (capture) await window.api.screenContext.release(capture.captureId)
  }

  const attach = (capture: ScreenContextCaptureDescriptor): void => {
    pendingRef.current = capture
    setPending(capture)
    setSubmitError(null)
  }

  const submitCaptureId = async (): Promise<string | undefined> => {
    const capture = pendingRef.current
    if (!capture) return undefined
    try {
      const capabilities = await window.api.llm.getActiveCapabilities()
      if (!capabilities.supportsVision) {
        setSubmitError(t('screenContext.error.visionUnsupported'))
        return undefined
      }
    } catch {
      setSubmitError(t('screenContext.error.unknown'))
      return undefined
    }
    if (pendingRef.current?.captureId !== capture.captureId) return undefined
    setSubmitError(null)
    pendingRef.current = null
    setPending(null)
    return capture.captureId
  }

  return { pending, submitError, pickerOpen, setPickerOpen, attach, release, submitCaptureId }
}
