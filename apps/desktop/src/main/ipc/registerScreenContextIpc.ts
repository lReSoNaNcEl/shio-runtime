import { ipcMain } from 'electron'
import { z } from 'zod'

import {
  SCREEN_CONTEXT_IMPORT_LIMITS,
  type ScreenContextErrorCode,
  type ScreenContextImportRequest,
  type ScreenContextResult,
} from '../../shared/screen-context'
import { ScreenContextError, type ScreenContextService } from '../screen-context'

export function registerScreenContextIpc(screenContext: ScreenContextService): void {
  const failure = <T>(code: ScreenContextErrorCode): ScreenContextResult<T> => ({
    ok: false,
    error: { code },
  })
  const errorCode = (error: unknown): ScreenContextErrorCode =>
    error instanceof ScreenContextError ? error.code : 'UNKNOWN'
  const operationIdSchema = z.string().uuid()

  ipcMain.handle('screen-context:list-sources', async (event) => {
    try {
      return {
        ok: true,
        value: await screenContext.listSources(event.sender.id),
      } satisfies ScreenContextResult<Awaited<ReturnType<ScreenContextService['listSources']>>>
    } catch (error) {
      return failure(errorCode(error))
    }
  })

  const captureSchema = z.object({
    operationId: operationIdSchema,
    sourceId: z.string().trim().min(1).max(500),
  })
  ipcMain.handle('screen-context:capture', async (event, payload: unknown) => {
    const parsed = captureSchema.safeParse(payload)
    if (!parsed.success) return failure('SOURCE_NOT_FOUND')
    try {
      return {
        ok: true,
        value: await screenContext.capture(
          event.sender.id,
          parsed.data.operationId,
          parsed.data.sourceId,
        ),
      } satisfies ScreenContextResult<Awaited<ReturnType<ScreenContextService['capture']>>>
    } catch (error) {
      return failure(errorCode(error))
    }
  })

  const importSchema = z.object({
    operationId: operationIdSchema,
    bytes: z
      .instanceof(ArrayBuffer)
      .refine(
        (bytes) =>
          bytes.byteLength > 0 && bytes.byteLength <= SCREEN_CONTEXT_IMPORT_LIMITS.maxInputBytes,
      ),
    mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
    sourceKind: z.enum(['clipboard', 'file']),
    sourceName: z.string().max(255).optional(),
  })
  ipcMain.handle('screen-context:import-image', async (event, payload: unknown) => {
    const parsed = importSchema.safeParse(payload)
    if (!parsed.success) {
      if (typeof payload !== 'object' || payload === null) return failure('UNKNOWN')
      const rawMimeType = 'mimeType' in payload ? payload.mimeType : undefined
      if (
        rawMimeType !== 'image/jpeg' &&
        rawMimeType !== 'image/png' &&
        rawMimeType !== 'image/webp'
      ) {
        return failure('UNSUPPORTED_IMAGE_TYPE')
      }
      const rawBytes = 'bytes' in payload ? payload.bytes : undefined
      if (!(rawBytes instanceof ArrayBuffer) || rawBytes.byteLength === 0) {
        return failure('CAPTURE_EMPTY')
      }
      if (rawBytes.byteLength > SCREEN_CONTEXT_IMPORT_LIMITS.maxInputBytes) {
        return failure('CAPTURE_TOO_LARGE')
      }
      return failure('UNKNOWN')
    }
    try {
      return {
        ok: true,
        value: await screenContext.importImage(
          event.sender.id,
          parsed.data satisfies ScreenContextImportRequest,
        ),
      } satisfies ScreenContextResult<Awaited<ReturnType<ScreenContextService['importImage']>>>
    } catch (error) {
      return failure(errorCode(error))
    }
  })

  const recaptureSchema = z.object({
    operationId: operationIdSchema,
    captureId: z.string().trim().min(1).max(100),
  })
  ipcMain.handle('screen-context:recapture', async (event, payload: unknown) => {
    const parsed = recaptureSchema.safeParse(payload)
    if (!parsed.success) return failure('CAPTURE_NOT_OWNED')
    try {
      return {
        ok: true,
        value: await screenContext.recapture(
          event.sender.id,
          parsed.data.operationId,
          parsed.data.captureId,
        ),
      } satisfies ScreenContextResult<Awaited<ReturnType<ScreenContextService['recapture']>>>
    } catch (error) {
      return failure(errorCode(error))
    }
  })

  ipcMain.handle('screen-context:cancel-operation', (event, operationId: unknown) => {
    const parsed = operationIdSchema.safeParse(operationId)
    if (!parsed.success) return failure('OPERATION_STALE')
    return {
      ok: true,
      value: screenContext.cancelOperation(event.sender.id, parsed.data),
    } satisfies ScreenContextResult<boolean>
  })
  ipcMain.handle('screen-context:release', (event, captureId: unknown) => {
    const parsed = z.string().trim().min(1).max(100).safeParse(captureId)
    if (!parsed.success) return failure('CAPTURE_NOT_OWNED')
    return {
      ok: true,
      value: screenContext.release(event.sender.id, parsed.data),
    } satisfies ScreenContextResult<boolean>
  })
}
