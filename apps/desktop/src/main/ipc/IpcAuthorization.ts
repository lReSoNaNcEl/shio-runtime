import type { IpcMainInvokeEvent } from 'electron'
import { z } from 'zod'

export type IpcSenderRole = 'main' | 'overlay'

export const IPC_ONE_PAYLOAD = z.tuple([z.unknown()])
export const IPC_THREE_PAYLOADS = z.tuple([z.unknown(), z.unknown(), z.unknown()])
const IPC_NO_PAYLOAD = z.tuple([])

const mainOnly = ['main'] as const
const mainAndOverlay = ['main', 'overlay'] as const
const overlayOnly = ['overlay'] as const

/** Canonical inventory of every renderer -> main invoke channel and its capability set. */
export const IPC_CHANNEL_CAPABILITIES = {
  'actions:emergency-stop': mainOnly,
  'actions:request-authority-mode': mainOnly,
  'actions:respond-authority-change': mainOnly,
  'actions:respond-confirmation': mainOnly,
  'actions:snapshot': mainOnly,
  'asr:recognize': mainOnly,
  'avatar-mouth:get': overlayOnly,
  'avatar-mouth:publish': mainOnly,
  'avatar-runtime:publish-health': mainOnly,
  'avatar-state:get': overlayOnly,
  'avatar-state:publish': mainOnly,
  'capabilities:snapshot': mainOnly,
  'config:get': mainOnly,
  'config:save': mainOnly,
  'debug:write-transition-recording': mainOnly,
  'diagnostics:get-network-requests': mainOnly,
  'diagnostics:get-network-request-details': mainOnly,
  'desktop-control:get-status': mainOnly,
  'desktop-control:start-runtime': mainOnly,
  'desktop-control:stop-runtime': mainOnly,
  'health:check': mainOnly,
  'llm:arbitrate-backlog': mainOnly,
  'llm:cancel-reply': mainOnly,
  'llm:fetch-models': mainOnly,
  'llm:forget-credential': mainOnly,
  'llm:get-active-capabilities': mainOnly,
  'llm:get-credential-status': mainOnly,
  'llm:get-readiness': mainOnly,
  'llm:providers': mainOnly,
  'llm:reply': mainOnly,
  'llm:save-credential': mainOnly,
  'llm:validate-credential': mainOnly,
  'memory:clear': mainOnly,
  'memory:clear-all': mainOnly,
  'memory:create': mainOnly,
  'memory:forget': mainOnly,
  'memory:get-status': mainOnly,
  'memory:list': mainOnly,
  'memory:search': mainOnly,
  'memory:set-enabled': mainOnly,
  'memory:update': mainOnly,
  'overlay-presentation:config:get': overlayOnly,
  'overlay:apply-settings': mainOnly,
  'overlay:is-visible': mainOnly,
  'overlay:reload-avatar': mainOnly,
  'overlay:toggle': mainOnly,
  'plugins:disable': mainOnly,
  'plugins:enable': mainOnly,
  'plugins:get': mainOnly,
  'plugins:list': mainOnly,
  'project-awareness:configure': mainOnly,
  'project-awareness:connect': mainOnly,
  'project-awareness:disconnect': mainOnly,
  'project-awareness:forget-credential': mainOnly,
  'project-awareness:get-project-map': mainOnly,
  'project-awareness:get-config': mainOnly,
  'project-awareness:get-recent-changes': mainOnly,
  'project-awareness:get-status': mainOnly,
  'project-awareness:open-token-settings': mainOnly,
  'project-awareness:read-file': mainOnly,
  'project-awareness:read-symbol': mainOnly,
  'project-awareness:refresh-snapshot-status': mainOnly,
  'project-awareness:rebuild-index': mainOnly,
  'project-awareness:save-credential': mainOnly,
  'project-awareness:search': mainOnly,
  'project-awareness:sync': mainOnly,
  'screen-context:cancel-operation': mainOnly,
  'screen-context:capture': mainOnly,
  'screen-context:import-image': mainOnly,
  'screen-context:list-sources': mainOnly,
  'screen-context:recapture': mainOnly,
  'screen-context:release': mainOnly,
  'system:get-release-info': mainOnly,
  'system:get-runtime-support-bundle': mainOnly,
  'system:open-external-link': mainOnly,
  'system:open-logs-folder': mainOnly,
  'system:report-renderer-failure': mainOnly,
  'tts:cancel-synthesis': mainOnly,
  'tts:synthesize-reply': mainOnly,
  'tts:warmup': mainOnly,
  'vrm:pick': mainOnly,
  'vrm:read': mainAndOverlay,
  'vrma:pick': mainOnly,
} as const

export type IpcChannel = keyof typeof IPC_CHANNEL_CAPABILITIES

interface SenderIdResolvers {
  main: () => number | null
  overlay: () => number | null
}

export class IpcAuthorization {
  constructor(private readonly senderIds: SenderIdResolvers) {}

  assert(event: Pick<IpcMainInvokeEvent, 'sender'>, channel: IpcChannel): IpcSenderRole {
    const senderId = event.sender.id
    const role =
      senderId === this.senderIds.main()
        ? 'main'
        : senderId === this.senderIds.overlay()
          ? 'overlay'
          : null
    const allowedRoles = IPC_CHANNEL_CAPABILITIES[channel] as readonly IpcSenderRole[]
    if (!role || !allowedRoles.includes(role)) {
      throw new Error(`IPC sender is not authorized for ${channel}`)
    }
    return role
  }

  handle<TResult>(
    channel: IpcChannel,
    handler: (event: IpcMainInvokeEvent) => TResult,
  ): (event: IpcMainInvokeEvent, ...args: unknown[]) => TResult {
    return (event, ...args) => {
      this.assert(event, channel)
      IPC_NO_PAYLOAD.parse(args)
      return handler(event)
    }
  }

  handlePayload<TSchema extends z.ZodType<unknown[]>, TResult>(
    channel: IpcChannel,
    schema: TSchema,
    handler: (event: IpcMainInvokeEvent, ...args: z.output<TSchema>) => TResult,
  ): (event: IpcMainInvokeEvent, ...args: unknown[]) => TResult {
    return (event, ...args) => {
      this.assert(event, channel)
      const payloads = schema.parse(args) as z.output<TSchema>
      return handler(event, ...payloads)
    }
  }
}
