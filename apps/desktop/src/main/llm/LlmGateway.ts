import { LlmCapabilityError, LlmCredentialMissingError } from './errors'
import {
  type FailoverCandidate,
  FailoverLlmProvider,
  type FailoverObserver,
} from './FailoverLlmProvider'
import {
  createLLMProvider,
  createModelCatalog,
  enrichModelCatalog,
  getProviderProfile,
  hasLoadedModelCatalog,
  resolveModelCapabilities,
} from './registry'
import type {
  ChatMessage,
  LLMProvider,
  LlmCapabilities,
  LlmCompletion,
  LlmCompletionOptions,
  LlmGatewaySettings,
  LlmRequestOptions,
  LlmStreamOptions,
} from './types'

export class LlmGateway implements LLMProvider {
  /**
   * @param getFallbacks ordered fallback settings of the same role; each passes the
   * same admission in `prepare()` and serves only before the first response byte.
   */
  constructor(
    private readonly getSettings: () => LlmGatewaySettings,
    private readonly getFallbacks: () => readonly LlmGatewaySettings[] = () => [],
    private readonly failoverObserver?: FailoverObserver,
  ) {}

  getActiveCapabilities(): LlmCapabilities {
    const { provider, model, accountId } = this.getSettings()
    return resolveModelCapabilities(provider, model, { accountId })
  }

  capabilities(): LlmCapabilities {
    return this.getActiveCapabilities()
  }

  async refreshActiveCapabilities(): Promise<LlmCapabilities> {
    const { provider, apiKey, accountId } = this.getSettings()
    if (!hasLoadedModelCatalog(provider, { accountId })) {
      const catalog = createModelCatalog(provider, { accountId })
      enrichModelCatalog(provider, await catalog.fetchModels(apiKey), { accountId })
    }
    return this.getActiveCapabilities()
  }

  async chat(messages: readonly ChatMessage[], options: LlmRequestOptions = {}): Promise<string> {
    const failover = this.failover(messages)
    if (failover) return failover.chat(messages, options)
    return this.prepare(messages).chat(messages, options)
  }

  async complete(
    messages: readonly ChatMessage[],
    options: LlmCompletionOptions = {},
  ): Promise<LlmCompletion> {
    const failover = this.failover(messages)
    if (failover) return failover.complete(messages, options)
    const active = this.prepare(messages)
    if (!active.complete) {
      return {
        content: await active.chat(messages, options),
        toolCalls: Object.freeze([]),
        finishReason: 'stop',
      }
    }
    return active.complete(messages, options)
  }

  stream(messages: readonly ChatMessage[], options: LlmStreamOptions = {}) {
    const failover = this.failover(messages, true)
    if (failover) return failover.stream(messages, options)
    const active = this.prepare(messages, { streaming: true })
    if (!active.stream) throw new LlmCapabilityError()
    return active.stream(messages, options)
  }

  /** A role with fallbacks is served by the failover decorator over the same admission. */
  private failover(
    messages: readonly ChatMessage[],
    streaming = false,
  ): FailoverLlmProvider | null {
    const fallbacks = this.getFallbacks()
    if (fallbacks.length === 0) return null
    const candidates: FailoverCandidate[] = [this.getSettings(), ...fallbacks].map((settings) => ({
      label: `${settings.provider}/${settings.model}`,
      provider: () => this.prepare(messages, { streaming }, settings),
    }))
    return new FailoverLlmProvider(() => candidates, this.failoverObserver)
  }

  /** Shared request admission: credentials, then streaming, then vision, then the adapter. */
  private prepare(
    messages: readonly ChatMessage[],
    { streaming = false }: { streaming?: boolean } = {},
    settings: LlmGatewaySettings = this.getSettings(),
  ): LLMProvider {
    const { provider, apiKey, model, accountId } = settings
    const profile = getProviderProfile(provider)
    if (
      (profile.requiresApiKey && !apiKey.trim()) ||
      (profile.requiresAccountId && !accountId?.trim())
    ) {
      throw new LlmCredentialMissingError()
    }
    const capabilities = resolveModelCapabilities(provider, model, { accountId })
    if (streaming && !capabilities.supportsStreaming) throw new LlmCapabilityError()
    const hasImage = messages.some(
      (message) =>
        typeof message.content !== 'string' &&
        message.content.some((part) => part.type === 'image'),
    )
    if (hasImage && !capabilities.supportsVision) throw new LlmCapabilityError()
    return createLLMProvider({ ...settings, capabilities })
  }
}
