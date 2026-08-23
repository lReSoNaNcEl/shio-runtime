import { ipcMain, shell } from 'electron'
import { z } from 'zod'

import { translate } from '../../shared/localization'
import { isValidProjectBranch, isValidProjectRepository } from '../../shared/project-awareness'
import { getConfig } from '../config'
import type { ProjectAwarenessPlugin } from '../project-awareness'
import { IPC_ONE_PAYLOAD, type IpcAuthorization } from './IpcAuthorization'

export interface ProjectAwarenessIpcDependencies {
  plugin: () => ProjectAwarenessPlugin
  authorization: IpcAuthorization
}

export function registerProjectAwarenessIpc({
  plugin,
  authorization,
}: ProjectAwarenessIpcDependencies): void {
  ipcMain.handle(
    'project-awareness:get-config',
    authorization.handle('project-awareness:get-config', () => plugin().getConfig()),
  )
  ipcMain.handle(
    'project-awareness:get-status',
    authorization.handle('project-awareness:get-status', () => plugin().getStatus()),
  )
  const configSchema = z
    .object({
      provider: z.literal('github'),
      repository: z.string().trim().max(200),
      branch: z.string().trim().max(255),
    })
    .superRefine((config, context) => {
      if (!isValidProjectRepository(config.repository)) {
        context.addIssue({
          code: 'custom',
          path: ['repository'],
          message: translate(getConfig().uiLocale, 'main.error.project.repositoryFormat'),
        })
      }
      if (!isValidProjectBranch(config.branch)) {
        context.addIssue({
          code: 'custom',
          path: ['branch'],
          message: translate(getConfig().uiLocale, 'main.error.project.branchInvalid'),
        })
      }
    })
  ipcMain.handle(
    'project-awareness:configure',
    authorization.handlePayload(
      'project-awareness:configure',
      IPC_ONE_PAYLOAD,
      async (_event, input: unknown) => {
        const config = configSchema.strict().parse(input)
        return plugin().configure(config)
      },
    ),
  )
  const credentialSchema = z
    .string()
    .trim()
    .min(20)
    .max(500)
    .refine((token) => !/\s/.test(token))
  ipcMain.handle(
    'project-awareness:save-credential',
    authorization.handlePayload(
      'project-awareness:save-credential',
      IPC_ONE_PAYLOAD,
      async (_event, token: unknown) => {
        return plugin().saveCredential(credentialSchema.parse(token))
      },
    ),
  )
  ipcMain.handle(
    'project-awareness:forget-credential',
    authorization.handle('project-awareness:forget-credential', async () => {
      return plugin().forgetCredential()
    }),
  )
  ipcMain.handle(
    'project-awareness:open-token-settings',
    authorization.handle('project-awareness:open-token-settings', () =>
      shell.openExternal('https://github.com/settings/personal-access-tokens/new'),
    ),
  )
  ipcMain.handle(
    'project-awareness:connect',
    authorization.handle('project-awareness:connect', () => plugin().connect()),
  )
  ipcMain.handle(
    'project-awareness:disconnect',
    authorization.handle('project-awareness:disconnect', () => plugin().disconnect()),
  )
  ipcMain.handle(
    'project-awareness:refresh-snapshot-status',
    authorization.handlePayload(
      'project-awareness:refresh-snapshot-status',
      IPC_ONE_PAYLOAD,
      (_event, force: unknown) => plugin().refreshSnapshotStatus(z.boolean().parse(force)),
    ),
  )
  ipcMain.handle(
    'project-awareness:sync',
    authorization.handle('project-awareness:sync', () => plugin().sync()),
  )
  ipcMain.handle(
    'project-awareness:rebuild-index',
    authorization.handle('project-awareness:rebuild-index', () => plugin().rebuildIndex()),
  )
  ipcMain.handle(
    'project-awareness:get-project-map',
    authorization.handle('project-awareness:get-project-map', () => plugin().getProjectMap()),
  )

  const searchSchema = z.object({
    query: z.string().min(1).max(500),
    limit: z.number().int().min(1).max(10).optional(),
    maxCharacters: z.number().int().min(1_000).max(20_000).optional(),
  })
  const readFileSchema = z.object({
    path: z
      .string()
      .min(1)
      .max(500)
      .refine((path) => !path.includes('..')),
    startLine: z.number().int().positive().optional(),
    endLine: z.number().int().positive().optional(),
  })
  const readSymbolSchema = z.object({
    name: z.string().min(1).max(300),
    path: z
      .string()
      .min(1)
      .max(500)
      .refine((path) => !path.includes('..'))
      .optional(),
  })
  const recentChangesSchema = z.object({
    limit: z.number().int().min(1).max(10).optional(),
    query: z.string().max(300).optional(),
  })
  ipcMain.handle(
    'project-awareness:search',
    authorization.handlePayload(
      'project-awareness:search',
      IPC_ONE_PAYLOAD,
      (_event, input: unknown) => plugin().search(searchSchema.strict().parse(input)),
    ),
  )
  ipcMain.handle(
    'project-awareness:read-file',
    authorization.handlePayload(
      'project-awareness:read-file',
      IPC_ONE_PAYLOAD,
      (_event, input: unknown) => plugin().readFile(readFileSchema.strict().parse(input)),
    ),
  )
  ipcMain.handle(
    'project-awareness:read-symbol',
    authorization.handlePayload(
      'project-awareness:read-symbol',
      IPC_ONE_PAYLOAD,
      (_event, input: unknown) => plugin().readSymbol(readSymbolSchema.strict().parse(input)),
    ),
  )
  ipcMain.handle(
    'project-awareness:get-recent-changes',
    authorization.handlePayload(
      'project-awareness:get-recent-changes',
      IPC_ONE_PAYLOAD,
      (_event, input: unknown) =>
        plugin().getRecentChanges(recentChangesSchema.strict().parse(input)),
    ),
  )
}
