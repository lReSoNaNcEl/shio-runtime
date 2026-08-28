import type { ShioCapabilitySnapshot } from '../../../shared/capabilities'
import type { TranslationKey } from '../../../shared/localization'

export type ChatQuickActionEffect = 'submit' | 'prepare-screen-context'

export interface ChatQuickAction {
  id: string
  label: string
  prompt: string
  effect: ChatQuickActionEffect
}

export interface ChatQuickActionGroups {
  starter: readonly ChatQuickAction[]
  tools: readonly ChatQuickAction[]
}

interface QuickActionSpec {
  id: string
  labelKey: TranslationKey
  promptKey: TranslationKey
  effect?: ChatQuickActionEffect
  capabilityId?: string
}

type Translate = (key: TranslationKey) => string

const STARTER_ACTIONS: readonly QuickActionSpec[] = [
  {
    id: 'greet',
    labelKey: 'chat.quick.greet',
    promptKey: 'chat.quick.greetPrompt',
  },
  {
    id: 'joke',
    labelKey: 'chat.quick.joke',
    promptKey: 'chat.quick.jokePrompt',
  },
  {
    id: 'capabilities',
    labelKey: 'chat.quick.capabilities',
    promptKey: 'chat.quick.capabilitiesPrompt',
  },
]

const TOOL_ACTIONS: readonly QuickActionSpec[] = [
  {
    id: 'web-search',
    capabilityId: 'web-search',
    labelKey: 'chat.quick.tool.webSearch',
    promptKey: 'chat.quick.tool.webSearchPrompt',
  },
  {
    id: 'project-awareness',
    capabilityId: 'project-awareness',
    labelKey: 'chat.quick.tool.project',
    promptKey: 'chat.quick.tool.projectPrompt',
  },
  {
    id: 'project-desktop-packages',
    capabilityId: 'project-awareness',
    labelKey: 'chat.quick.tool.projectPackages',
    promptKey: 'chat.quick.tool.projectPackagesPrompt',
  },
  {
    id: 'screen-understanding',
    capabilityId: 'screen-understanding',
    labelKey: 'chat.quick.tool.screen',
    promptKey: 'chat.quick.tool.screenPrompt',
    effect: 'prepare-screen-context',
  },
  {
    id: 'long-term-memory',
    capabilityId: 'long-term-memory',
    labelKey: 'chat.quick.tool.memory',
    promptKey: 'chat.quick.tool.memoryPrompt',
  },
  {
    id: 'alive-autonomy',
    capabilityId: 'alive-autonomy',
    labelKey: 'chat.quick.tool.goals',
    promptKey: 'chat.quick.tool.goalsPrompt',
  },
  {
    id: 'browser-control',
    capabilityId: 'browser-control',
    labelKey: 'chat.quick.tool.browser',
    promptKey: 'chat.quick.tool.browserPrompt',
  },
  {
    id: 'browser-computer-use',
    capabilityId: 'browser-computer-use',
    labelKey: 'chat.quick.tool.visualBrowser',
    promptKey: 'chat.quick.tool.visualBrowserPrompt',
  },
  {
    id: 'computer-control',
    capabilityId: 'computer-control',
    labelKey: 'chat.quick.tool.powershell',
    promptKey: 'chat.quick.tool.powershellPrompt',
  },
]

function localizeAction(spec: QuickActionSpec, t: Translate): ChatQuickAction {
  return {
    id: spec.id,
    label: t(spec.labelKey),
    prompt: t(spec.promptKey),
    effect: spec.effect ?? 'submit',
  }
}

export function createChatQuickActions(
  snapshot: ShioCapabilitySnapshot | null,
  t: Translate,
): ChatQuickActionGroups {
  const availableCapabilities = new Set(
    snapshot?.capabilities
      .filter((capability) => capability.availability === 'available')
      .map((capability) => capability.id) ?? [],
  )

  return {
    starter: STARTER_ACTIONS.map((spec) => localizeAction(spec, t)),
    tools: TOOL_ACTIONS.filter(
      (spec) => spec.capabilityId && availableCapabilities.has(spec.capabilityId),
    ).map((spec) => localizeAction(spec, t)),
  }
}
