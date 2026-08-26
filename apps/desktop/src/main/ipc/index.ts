import { type BrowserWindow, ipcMain } from 'electron'
import { z } from 'zod'

import { characterReplyOriginSchema } from '../../shared/conversation'
import { translate } from '../../shared/localization'
import type { ActionConfirmationBroker, ActionRuntime } from '../action'
import type { MainConversationTurnService } from '../app/MainConversationTurnService'
import type { SpeechApplicationService } from '../app/SpeechApplicationService'
import type { BrowserControlPlugin } from '../browser-control'
import type { CapabilityCatalog } from '../capabilities'
import { getConfig } from '../config'
import type { DesktopControlPlugin } from '../desktop-control'
import {
  createLLMProvider,
  getProviderProfile,
  isLlmProviderId,
  type LlmCredentialStore,
  type LlmGateway,
  resolveLlmProviderAccountId,
} from '../llm'
import type { MemoryRuntime } from '../memory'
import type { Orchestrator } from '../orchestrator'
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
  orchestrator: () => Orchestrator,
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
): void {
  let backlogArbitrationInFlight = false

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
      if (value.origin === 'autonomous' && value.screenContextId) {
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
  ipcMain.handle(
    'llm:cancel-reply',
    authorization.handlePayload(
      'llm:cancel-reply',
      IPC_ONE_PAYLOAD,
      async (_event, payload: unknown) => {
        const turnId = z.string().trim().min(1).max(100).parse(payload)
        await conversationTurns.cancelReply(turnId)
        return { ok: true }
      },
    ),
  )

  const backlogResultSchema = z
    .object({
      action: z.enum(['select', 'merge', 'discard_all']),
      selectedIds: z.array(z.string()).max(10),
      text: z.string().max(600).optional(),
      reason: z.string().max(200),
      confidence: z.number().min(0).max(1),
      backlogVersion: z.number().int().nonnegative(),
    })
    .superRefine((value, context) => {
      if (
        value.action !== 'discard_all' &&
        (!value.text?.trim() || value.selectedIds.length === 0)
      ) {
        context.addIssue({ code: 'custom', message: 'Selection requires text and selectedIds' })
      }
    })

  ipcMain.handle(
    'llm:arbitrate-backlog',
    authorization.handlePayload(
      'llm:arbitrate-backlog',
      IPC_ONE_PAYLOAD,
      async (_event, rawPayload: unknown) => {
        const payloadSchema = z
          .object({
            items: z
              .array(
                z
                  .object({
                    id: z.string().min(1).max(100),
                    text: z.string().min(1).max(2_000),
                    priorityClass: z.string().min(1).max(50),
                    attentionScore: z.number().finite(),
                    createdAt: z.number().finite(),
                  })
                  .strict(),
              )
              .max(10),
            backlogVersion: z.number().int().nonnegative(),
            providerId: z.string().refine(isLlmProviderId),
            model: z.string().trim().min(1).max(500),
          })
          .strict()
        const parsed = payloadSchema.safeParse(rawPayload)
        if (!parsed.success) {
          return { ok: false, error: translate(getConfig().uiLocale, 'main.error.invalidBacklog') }
        }
        const payload = parsed.data
        const config = getConfig()
        const role = config.llm.roles.backlogSelector
        if (
          !role.enabled ||
          role.providerId !== payload.providerId ||
          role.model !== payload.model
        ) {
          return {
            ok: false,
            error: translate(getConfig().uiLocale, 'main.error.selectorDisabled'),
          }
        }
        if (!role.providerId)
          return {
            ok: false,
            error: translate(getConfig().uiLocale, 'main.error.selectorProviderMissing'),
          }
        const providerId = role.providerId
        const credential = llmCredentialStore().resolve(providerId)
        const accountId = resolveLlmProviderAccountId(
          providerId,
          config.llm.providers[providerId].accountId,
        )
        if (!credential.apiKey || (getProviderProfile(providerId).requiresAccountId && !accountId))
          return {
            ok: false,
            error: translate(getConfig().uiLocale, 'main.error.selectorKeyMissing'),
          }
        if (backlogArbitrationInFlight)
          return {
            ok: false,
            error: translate(getConfig().uiLocale, 'main.error.arbitrationActive'),
          }
        const prompt = [
          'You are a conversation backlog arbitration classifier.',
          'You inspect completed user utterances captured through continuous microphone listening while the assistant was busy.',
          'Do not answer the user, roleplay, or invent wording. Select, merge, or discard only.',
          'Prefer direct corrections, direct questions, direct follow-ups, then recent relevant continuation.',
          'Reject self-echo, duplicates, stale utterances, filler, and unrelated background speech.',
          'Return valid JSON only with action, selectedIds, optional text, reason, confidence, backlogVersion.',
          'Select at most one next user turn. When merging, preserve the user wording and meaning.',
        ].join(' ')
        try {
          backlogArbitrationInFlight = true
          const arbitrationController = new AbortController()
          const arbitrationTimeout = setTimeout(
            () => arbitrationController.abort(new Error('Backlog arbitration deadline exceeded')),
            role.timeoutMs,
          )
          const provider = createLLMProvider({
            provider: providerId,
            apiKey: credential.apiKey,
            model: role.model,
            accountId,
          })
          try {
            const raw = await provider.chat(
              [
                { role: 'system', content: prompt },
                {
                  role: 'user',
                  content: JSON.stringify({
                    backlogVersion: payload.backlogVersion,
                    items: payload.items,
                  }),
                },
              ],
              {
                signal: arbitrationController.signal,
                timeoutMs: role.timeoutMs,
                maxTokens: 300,
                traceId: `backlog:${payload.backlogVersion}`,
              },
            )
            const json = JSON.parse(
              raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''),
            ) as unknown
            return { ok: true, result: backlogResultSchema.parse(json) }
          } finally {
            clearTimeout(arbitrationTimeout)
          }
        } catch (error) {
          return { ok: false, error: error instanceof Error ? error.message : String(error) }
        } finally {
          backlogArbitrationInFlight = false
        }
      },
    ),
  )

  ipcMain.handle(
    'memory:clear',
    authorization.handle('memory:clear', async () => {
      await orchestrator().clearHistory()
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

  registerConfigIpc(win, authorization, () => capabilityCatalog.invalidate())
  registerAvatarIpc(win, authorization)

  registerSystemIpc(authorization)
}
