import { type BrowserWindow, ipcMain, shell } from 'electron'
import { z } from 'zod'

import { translate } from '../../shared/localization'
import {
  isValidProjectBranch,
  isValidProjectRepository,
  type ProjectAwarenessPublicConfig,
  type ProjectReadFileInput,
  type ProjectReadSymbolInput,
  type ProjectRecentChangesInput,
  type ProjectSearchInput,
} from '../../shared/project-awareness'
import { getConfig, getRendererConfig, saveConfig } from '../config'
import type {
  LoadedProjectCredential,
  ProjectAwarenessRuntime,
  ProjectCredentialStore,
} from '../project-awareness'

export interface ProjectAwarenessIpcDependencies {
  runtime: () => ProjectAwarenessRuntime
  credentials: () => ProjectCredentialStore
  window: BrowserWindow
}

export function registerProjectAwarenessIpc({
  runtime,
  credentials,
  window,
}: ProjectAwarenessIpcDependencies): void {
  ipcMain.handle('project-awareness:get-status', () => runtime().getStatus())
  const configSchema = z
    .object({
      enabled: z.boolean(),
      provider: z.literal('github'),
      repository: z.string().trim().max(200),
      branch: z.string().trim().max(255),
    })
    .superRefine((config, context) => {
      if (!config.enabled) return
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
    async (_event, input: ProjectAwarenessPublicConfig) => {
      const config = configSchema.parse(input)
      saveConfig({ projectAwareness: config })
      window.webContents.send('config:updated', getRendererConfig())
      return runtime().configure(config)
    },
  )
  const credentialSchema = z
    .string()
    .trim()
    .min(20)
    .max(500)
    .refine((token) => !/\s/.test(token))
  const applyCredential = (
    projectRuntime: ProjectAwarenessRuntime,
    credential: LoadedProjectCredential,
  ): void => {
    projectRuntime.setCredential(credential.token, {
      configured: credential.configured,
      source: credential.source,
      secureStorageAvailable: credential.secureStorageAvailable,
      lastError: credential.lastError,
    })
  }
  ipcMain.handle('project-awareness:save-credential', async (_event, token: string) => {
    const projectRuntime = runtime()
    const credential = await credentials().save(credentialSchema.parse(token))
    await projectRuntime.disconnect()
    applyCredential(projectRuntime, credential)
    return projectRuntime.getStatus()
  })
  ipcMain.handle('project-awareness:forget-credential', async () => {
    const projectRuntime = runtime()
    await projectRuntime.disconnect()
    applyCredential(projectRuntime, await credentials().clear())
    return projectRuntime.getStatus()
  })
  ipcMain.handle('project-awareness:open-token-settings', () =>
    shell.openExternal('https://github.com/settings/personal-access-tokens/new'),
  )
  ipcMain.handle('project-awareness:connect', () => runtime().connect())
  ipcMain.handle('project-awareness:disconnect', () => runtime().disconnect())
  ipcMain.handle('project-awareness:sync', () => runtime().sync())
  ipcMain.handle('project-awareness:rebuild-index', () => runtime().rebuildIndex())
  ipcMain.handle('project-awareness:get-project-map', () => runtime().getProjectMap())

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
  ipcMain.handle('project-awareness:search', (_event, input: ProjectSearchInput) =>
    runtime().search(searchSchema.parse(input)),
  )
  ipcMain.handle('project-awareness:read-file', (_event, input: ProjectReadFileInput) =>
    runtime().readFile(readFileSchema.parse(input)),
  )
  ipcMain.handle('project-awareness:read-symbol', (_event, input: ProjectReadSymbolInput) =>
    runtime().readSymbol(readSymbolSchema.parse(input)),
  )
  ipcMain.handle(
    'project-awareness:get-recent-changes',
    (_event, input: ProjectRecentChangesInput) =>
      runtime().getRecentChanges(recentChangesSchema.parse(input)),
  )
}
