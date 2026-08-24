import { ipcMain } from 'electron'
import { z } from 'zod'

import type { MemoryApiResult, MemoryErrorCode } from '../../shared/memory'
import {
  manualMemoryCreateInputSchema,
  memoryForgetInputSchema,
  memoryListInputSchema,
  memorySearchInputSchema,
  memoryUpdateInputSchema,
} from '../../shared/memory'
import { MemoryPolicyError, type MemoryRuntime } from '../memory'
import { IPC_ONE_PAYLOAD, type IpcAuthorization } from './IpcAuthorization'

function errorResult(error: unknown): MemoryApiResult<never> {
  if (error instanceof MemoryPolicyError) {
    return { ok: false, error: { code: error.code, message: error.message } }
  }
  if (error instanceof z.ZodError) {
    return {
      ok: false,
      error: { code: 'INVALID_REQUEST', message: 'The memory request was invalid.' },
    }
  }
  return {
    ok: false,
    error: {
      code: 'MEMORY_UNAVAILABLE' satisfies MemoryErrorCode,
      message: 'Long-term memory is currently unavailable.',
    },
  }
}

function safe<T>(operation: () => T): MemoryApiResult<T> {
  try {
    return { ok: true, data: operation() }
  } catch (error) {
    return errorResult(error)
  }
}

export function registerMemoryIpc(runtime: MemoryRuntime, authorization: IpcAuthorization): void {
  ipcMain.handle(
    'memory:get-status',
    authorization.handle('memory:get-status', () => safe(() => runtime.status())),
  )
  ipcMain.handle(
    'memory:set-enabled',
    authorization.handlePayload('memory:set-enabled', IPC_ONE_PAYLOAD, (_event, input: unknown) =>
      safe(() => runtime.setEnabled(z.boolean().parse(input))),
    ),
  )
  ipcMain.handle(
    'memory:search',
    authorization.handlePayload('memory:search', IPC_ONE_PAYLOAD, (_event, input: unknown) =>
      safe(() => runtime.searchForUi(memorySearchInputSchema.parse(input))),
    ),
  )
  ipcMain.handle(
    'memory:list',
    authorization.handlePayload('memory:list', IPC_ONE_PAYLOAD, (_event, input: unknown) =>
      safe(() => runtime.listForUi(memoryListInputSchema.parse(input))),
    ),
  )
  ipcMain.handle(
    'memory:create',
    authorization.handlePayload('memory:create', IPC_ONE_PAYLOAD, (_event, input: unknown) =>
      safe(() => runtime.createManual(manualMemoryCreateInputSchema.parse(input))),
    ),
  )
  ipcMain.handle(
    'memory:update',
    authorization.handlePayload('memory:update', IPC_ONE_PAYLOAD, (_event, input: unknown) =>
      safe(() => runtime.updateManual(memoryUpdateInputSchema.parse(input))),
    ),
  )
  ipcMain.handle(
    'memory:forget',
    authorization.handlePayload('memory:forget', IPC_ONE_PAYLOAD, (_event, input: unknown) =>
      safe(() => runtime.forgetManual(memoryForgetInputSchema.parse(input))),
    ),
  )
  ipcMain.handle(
    'memory:clear-all',
    authorization.handle('memory:clear-all', () =>
      safe(() => {
        runtime.clearManual()
        return { cleared: true as const }
      }),
    ),
  )
}
