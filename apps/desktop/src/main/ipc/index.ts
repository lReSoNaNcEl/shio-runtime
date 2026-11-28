import { type BrowserWindow, ipcMain } from 'electron'
import { z } from 'zod'

import { characterReplyOriginSchema } from '../../shared/conversation'
import type { ActionConfirmationBroker, ActionRuntime } from '../action'
import type { MainConversationTurnService } from '../app/MainConversationTurnService'
import type { SpeechApplicationService } from '../app/SpeechApplicationService'
import type { BrowserControlPlugin } from '../browser-control'
import type { CapabilityCatalog } from '../capabilities'
import type { DesktopControlPlugin } from '../desktop-control'
import type { LlmCredentialStore, LlmGateway } from '../llm'
import type { MemoryRuntime } from '../memory'
import type { PluginRuntime } from '../plugins'
import type { ProjectAwarenessPlugin } from '../project-awareness'
import type { ScreenContextService } from '../screen-context'
import { IPC_ONE_PAYLOAD, type IpcAuthorization } from './IpcAuthorization'
import { registerActionIpc } from './registerActionIpc'
import { registerAvatarIpc } from './registerAvatarIpc'
import { registerBrowserControlIpc } from './registerBrowserControlIpc'
import { registerCapabilitiesIpc } from './registerCapabilitiesIpc'
import { registerConfigIpc } from './registerConfigIpc'
import { registerDesktopControlIpc } from './registerDesktopControlIpc'
import { registerLlmIpc } from './registerLlmIpc'
import { registerMemoryIpc } from './registerMemoryIpc'
import { registerNetworkDiagnosticsIpc } from './registerNetworkDiagnosticsIpc'
import { registerPluginIpc } from './registerPluginIpc'
import { registerProjectAwarenessIpc } from './registerProjectAwarenessIpc'
import { registerScreenContextIpc } from './registerScreenContextIpc'
import { registerSpeechIpc } from './registerSpeechIpc'
import { registerSystemIpc } from './registerSystemIpc'

export function registerIpcHandlers(
  llm: () => LlmGateway,
  llmCredentialStore: () => LlmCredentialStore,
  plugins: () => PluginRuntime,
  projectAwareness: () => ProjectAwarenessPlugin,
  desktopControl: () => DesktopControlPlugin,
  browserControl: () => BrowserControlPlugin,
  screenContext: ScreenContextService,
  semanticMemory: MemoryRuntime,
  capabilityCatalog: CapabilityCatalog,
  conversationTurns: MainConversationTurnService,
  speechService: SpeechApplicationService,
  actions: ActionRuntime,
  confirmations: ActionConfirmationBroker,
  win: BrowserWindow,
  authorization: IpcAuthorization,
  onFlashMotionChanged?: () => Promise<void>,
): void {
  registerSpeechIpc({
    service: speechService,
    onCapabilitiesProbe: (probe) => capabilityCatalog.reportSpeechCapabilities(probe),
    authorization,
  })

  registerLlmIpc({
    llm,
    credentials: llmCredentialStore,
    window: win,
    authorization,
    onCapabilitiesChanged: () => capabilityCatalog.invalidate(),
  })
  registerCapabilitiesIpc(capabilityCatalog, win, authorization)
  registerScreenContextIpc(screenContext, authorization)

  const replyPayloadSchema = z
    .object({
      turnId: z.string().trim().min(1).max(100),
      userText: z.string().trim().min(1).max(20_000),
      screenContextId: z.string().trim().min(1).max(100).optional(),
      origin: characterReplyOriginSchema.optional(),
    })
    .strict()
    .superRefine((value, context) => {
      if (value.origin && value.origin !== 'user' && value.screenContextId) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['screenContextId'],
          message: 'Autonomous replies cannot attach screen context',
        })
      }
    })
  ipcMain.handle(
    'llm:reply',
    authorization.handlePayload('llm:reply', IPC_ONE_PAYLOAD, async (event, payload: unknown) => {
      const parsed = replyPayloadSchema.safeParse(payload)
      if (!parsed.success) return { ok: false, error: 'Invalid LLM reply request' }
      return conversationTurns.createReply(event.sender.id, parsed.data, (streamEvent) => {
        if (!event.sender.isDestroyed()) event.sender.send('llm:reply-stream-event', streamEvent)
      })
    }),
  )
  const cancelReplySchema = z
    .object({
      turnId: z.string().trim().min(1).max(100),
      visibleReplyCharacters: z.number().int().positive().optional(),
    })
    .strict()
  ipcMain.handle(
    'llm:cancel-reply',
    authorization.handlePayload(
      'llm:cancel-reply',
      IPC_ONE_PAYLOAD,
      async (event, payload: unknown) => {
        const { turnId, visibleReplyCharacters } = cancelReplySchema.parse(payload)
        await conversationTurns.cancelReply(turnId, event.sender.id, visibleReplyCharacters)
        return { ok: true }
      },
    ),
  )

  ipcMain.handle(
    'memory:clear',
    authorization.handle('memory:clear', async () => {
      await conversationTurns.clearHistory()
      return { ok: true }
    }),
  )

  registerProjectAwarenessIpc({
    plugin: projectAwareness,
    actions,
    authorization,
  })
  registerMemoryIpc(semanticMemory, authorization)
  registerDesktopControlIpc(desktopControl, authorization)
  registerBrowserControlIpc(browserControl, actions, authorization)
  registerPluginIpc(plugins, authorization)
  registerNetworkDiagnosticsIpc(authorization)

  registerActionIpc({
    actions,
    confirmations,
    window: win,
    capabilityCatalog,
    authorization,
  })

  registerConfigIpc(win, authorization, () => capabilityCatalog.invalidate(), onFlashMotionChanged)
  registerAvatarIpc(win, authorization)

  registerSystemIpc(authorization)
}
