import { z } from 'zod'

import {
  type CharacterEmbodimentIntent,
  characterEmbodimentIntentSchema,
  EMBODIMENT_CONVERSATION_GUIDANCE,
  EMBODIMENT_GESTURE_DEFINITIONS,
  type EmbodimentAvailability,
} from '../../shared/character-response'
import {
  CHARACTER_TOOL_IDS,
  type CharacterToolRequirement,
  characterToolPlanningResultSchema,
  characterToolRequirementSchema,
  type InitialCharacterToolPlan,
  initialCharacterToolPlanSchema,
  type TurnToolEvidenceSummary,
} from '../../shared/character-tools'
import type { ChatMessage, LlmToolDefinition } from '../llm'
import type { CharacterToolRegistry } from './CharacterToolRegistry'
import { toLlmToolJsonSchema } from './CharacterToolSpecifications'

/**
 * Tool Requirement planning inputs and outputs for the Character LLM's typed planning phase:
 * the planning schema, the classification prompt, bounded planning conversation, and strict
 * parsing of the returned plan. The semantic decision stays with the Character LLM; request
 * execution and retries stay in the Character Tool Loop.
 */
export const CHARACTER_TOOL_REQUIREMENT_NATIVE_NAME = 'character_tool_requirement'
const CHARACTER_TOOL_PLANNING_JSON_SCHEMA = JSON.stringify(
  toLlmToolJsonSchema(characterToolPlanningResultSchema.required({ embodiment: true })),
)

export interface CharacterToolPlanningResult {
  requirement: CharacterToolRequirement
  initialPlan: InitialCharacterToolPlan
  embodiment?: CharacterEmbodimentIntent | null
}

export function characterToolRequirementDefinition(
  registry: CharacterToolRegistry,
): LlmToolDefinition {
  return Object.freeze({
    name: CHARACTER_TOOL_REQUIREMENT_NATIVE_NAME,
    description:
      'Classify the terminal source/tool obligation and the separate initial tool plan for the current user turn.',
    parameters: toLlmToolJsonSchema(
      characterToolPlanningResultSchema.required({ embodiment: true }),
      registry.schemaCapabilities(),
    ),
  })
}

export function constrainedPlanningSchema(
  registry: CharacterToolRegistry,
  availability?: EmbodimentAvailability,
): Record<string, unknown> {
  const available = registry.definitions().map((tool) => tool.id)
  const visual = characterEmbodimentIntentSchema
    .omit({ bodyAction: true, gestureHint: true })
    .extend({
      ...(availability?.availableSemanticIntents.length
        ? { gestureHint: z.enum(availability.availableSemanticIntents).optional() }
        : {}),
      ...(availability?.availableBodyActions?.includes('turn-in-place')
        ? { bodyAction: characterEmbodimentIntentSchema.shape.bodyAction }
        : {}),
    })
  const schema = characterToolPlanningResultSchema.extend({
    plannedTools: z
      .array(z.enum(available.length ? available : CHARACTER_TOOL_IDS))
      .max(available.length),
    embodiment: availability ? visual.nullable() : z.null(),
  })
  const { $schema: _schema, ...json } = z.toJSONSchema(schema, { target: 'draft-07', io: 'input' })
  return json
}

function previousTurnEvidence(
  messages: readonly ChatMessage[],
): TurnToolEvidenceSummary | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role === 'assistant') return message.toolEvidence
  }
  return undefined
}

export function previousTurnEvidencePrompt(
  messages: readonly ChatMessage[],
): ChatMessage | undefined {
  const evidence = previousTurnEvidence(messages)
  if (!evidence) return undefined
  return {
    role: 'system',
    content: [
      '## Previous Turn Runtime Evidence',
      'These are trusted bounded Runtime facts about the immediately preceding assistant turn. Use them only for retrospective claims about what was actually called or verified. They do not satisfy a source requirement for the current turn.',
      JSON.stringify(evidence),
    ].join('\n\n'),
  }
}

function toolRequirementPrompt(
  registry: CharacterToolRegistry,
  previousEvidence: TurnToolEvidenceSummary | undefined,
  currentWorldContextAvailable: boolean,
  currentScreenContextAvailable: boolean,
  embodimentAvailability?: EmbodimentAvailability,
  constrained = false,
): string {
  return [
    '## Character Tool Requirement Planning',
    'Classify the meaning of the current user turn before writing any user-visible response. This typed planning phase is performed by the same Character LLM, not a keyword router.',
    'Ordinary social conversation, feelings, imagined scenarios, explanations and physical gestures normally require direct-answer with no planned tools. Select a source or tool only when the current user goal actually needs its evidence or operation. Prior conversation, available tool names and your own intended reply do not introduce a new requirement. A greeting or wave does not need Memory retrieval.',
    'Return two independent decisions: requirement is the minimum obligation that must reach a typed terminal result before a terminal reply; plannedTools is the bounded set of available tools that may materially help fulfill the original user goal, including later authority-bearing work. Requirement is never the tool allowlist.',
    'Also return embodiment: null for quiet presence, or one semantic visual intent with intensity and optional gestureHint/gazeHint. Choose a fitting available act when your reply naturally explains, compares, agrees, reassures or reacts; an explicit animation request is not required. Quiet presence remains valid; do not gesture on every turn or infer agreement/disagreement from emotion alone. For a direct gesture request choose an available fitting hint, even if unspecified. This is presentation metadata, never a tool, Action or proof of execution. Listing abilities, evidence and previous replies cannot request a gesture.',
    `Semantic gesture meanings: ${EMBODIMENT_GESTURE_DEFINITIONS.map(({ id, meaning }) => `${id}=${meaning}`).join('; ')}.`,
    EMBODIMENT_CONVERSATION_GUIDANCE,
    'Your initial embodiment decision is authoritative for this turn: later prose or a later visual envelope cannot replace embodiment:null. When the current user explicitly requests a supported physical gesture, represent that request in this decision. Example: a request to greet with a wave selects greeting when available. Do not choose greeting merely because a prior message greeted someone or because your own answer starts with a greeting. Do not promise in prose a gesture you did not request here.',
    `Current request-scoped Avatar facts: ${embodimentAvailability ? JSON.stringify(embodimentAvailability) : 'unavailable; return embodiment:null'}. Choose gestureHint only from availableSemanticIntents. bodyAction is permitted only from availableBodyActions: for turn-in-place use {action:"turn-in-place",turns:1,direction:"clockwise" or "counterclockwise",tempo:0.75..1.2,finishFacing:"viewer"}. Never return profile IDs, bone transforms, [fox-paw] or shio markers in this JSON plan.`,
    'Return explicit-tool whenever one exact Character tool is semantically required. An explicit request to use a named tool is always part of the user goal even when phrased softly; preserve that exact tool requirement even when it is currently unavailable.',
    'Use required-source web for current public facts, freshness, recent announcements, current pricing, availability, dates, releases, or external sources when no exact tool was named.',
    "Use required-source project when the request asks to inspect, verify, find, or make claims about the connected project's current real source, dependencies, technology stack, configuration, file contents, history, branch, or repository state.",
    'Use source-preferred project only for generic Shio product self-knowledge, architectural brainstorming, improvement ideas, or a bounded overview that does not claim current repository facts. If Project Awareness is unavailable, Shio may answer from bounded self-knowledge and disclose that the current repository was not checked.',
    'Use source-preferred web for non-current background or recommendations that public sources could improve but whose absence does not make a bounded answer dishonest. Current prices, dates, availability, releases, and news remain required-source web.',
    'Use required-source browser-state only for read-only evidence about the current Shio-controlled browser state. Any browser mutation requires an explicit action tool or delegated browser.use authority. Do not use it for public-web discovery.',
    'Use explicit-tool memory.list when the user asks what Shio remembers or requests a complete bounded listing of long-term memory. Use required-source memory for a topical answer that depends on durable facts from earlier interactions; use source-preferred memory when remembered continuity is helpful but not necessary. Otherwise return direct-answer.',
    `Trusted Current World Context projection included in the response request: ${currentWorldContextAvailable ? 'yes' : 'no'}.`,
    `Trusted Screen Context image attached to the current user turn: ${currentScreenContextAvailable ? 'yes' : 'no'}.`,
    'When Screen Context is attached, the image is already the direct visual evidence for requests to describe, analyze, read, or critique that attachment. Return direct-answer with no browser tools unless the original request independently requires inspecting or interacting with the Shio-controlled browser. browser.observe cannot inspect Screen Context or the general desktop.',
    'When Current World Context is included and its bounded present-state fields can answer what the computer, foreground application, running applications, media, load, or user-idle state is doing now, return direct-answer and use that projection. Do not require shell.execute, browser.use, or browser.useStatus merely to repeat those already supplied facts. Do not infer activity that is absent from the projection.',
    'Classification example: when that projection is included, “What is my system doing now?” or “Что делает моя система на данный момент?” is direct-answer with no planned tool if the bounded fields suffice. A question about the lifecycle of an already running delegated browser session is instead explicit-tool browser.useStatus.',
    'Use explicit-tool shell.execute only when current local-computer facts are not supplied by Current World Context, the user explicitly requests a fresh system inspection, or the requested operating-system action must be executed. Use goal tools for durable goal-store operations, thread tools for conversation-thread operations, and Memory mutation tools for explicit persistence changes.',
    'A request for the installed version of a command-line utility on the computer requires shell.execute only; the words “on my computer” do not make it browser-state. For “What npx version is installed on my computer?”, return {"requirement":{"type":"explicit-tool","tool":"shell.execute"},"plannedTools":["shell.execute"]}. Do not include any browser tool unless the original request separately asks about a page, tab, or browser session.',
    'Use explicit-tool goal.list when the user asks for the complete current goal listing, active goals, archived goals, goal progress across the store, or explicitly asks to read the Goal Store. A single unfinished intention already present in Goal Awareness may be answered directly when no broader listing is requested.',
    'Use explicit-tool browser.use when the user asks Shio to autonomously choose among pages or items, perform a multi-step browser task, close or operate a visible browser UI whose exact semantic target is not already known before observation, play or control a browser game, react to changing browser visual state, or keep browser interaction running for a duration or until stopped. This delegated session owns the whole bounded browser goal. It never reads general operating-system activity and is never required for a read-only question about what the computer is currently doing.',
    'Use explicit-tool browser.useStatus only to read the status of an already delegated browser.use session. It is not the status of the browser page, computer, application, or operating system.',
    'Use explicit-tool browser.open when one exact user-specified URL is known and the goal is either navigation itself or a read-only fact available in the fresh observation returned by opening it, such as the page title. Opening a catalog, search page, or game site still does not satisfy a request to choose something there or interact with it afterward.',
    'Do not decompose a browser.use goal into browser.open/browser.click calls across conversational turns.',
    'plannedTools must be derived only from the original user goal before external evidence is observed. Include every available later mutation tool or capability materially needed for that goal, but do not add speculative authority.',
    `Known Character tool identifiers: ${JSON.stringify(CHARACTER_TOOL_IDS)}`,
    `Currently available Character tools: ${JSON.stringify(registry.definitions().map((tool) => tool.id))}`,
    ...(previousEvidence
      ? [
          `Previous-turn Runtime evidence (retrospective context only): ${JSON.stringify(previousEvidence)}`,
        ]
      : []),
    'For a current repository dependency or package.json question, return {"requirement":{"type":"required-source","source":"project"},"plannedTools":["project.search"]}.',
    'For an explicit request to call project.search, return {"requirement":{"type":"explicit-tool","tool":"project.search"},"plannedTools":["project.search"]}.',
    'For creative writing or continuing an invented story already in this conversation, use direct-answer and no planned tools unless the original request separately asks for an external source or durable storage. Planning output must still be a typed planning object; never continue the story during this phase.',
    'Examples of current turns requiring direct-answer and plannedTools:[]: “I was frustrated yesterday; respond as a friend”; “Greet me with a small wave”; “Continue our invented cat story”; “Who from our story could captain the imaginary spaceship?”. Conversation context already supplied here is sufficient. In contrast, “List my stored long-term memories” requires memory.list. Choose semantically from the actual current goal, not by copying an example.',
    ...(constrained
      ? [
          'Return exactly {"requirement":<one typed requirement>,"plannedTools":[],"embodiment":null or <one available semantic visual intent>}. Select only tools materially needed for this request, never copy a list of schema choices. The response schema constrains shape; its enum choices are vocabulary, not requests. Do not include bodyAction unless the current user actually requests an available physical action.',
        ]
      : [
          'Return exactly one object with no prose or Markdown. The exact JSON Schema follows; use one requirement variant, include every required property, and include no additional properties:',
          CHARACTER_TOOL_PLANNING_JSON_SCHEMA,
        ]),
  ].join('\n\n')
}

export function parseToolPlanningValue(value: unknown): CharacterToolPlanningResult | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const { embodiment, ...toolPlanning } = record
  const visual = characterEmbodimentIntentSchema.nullable().safeParse(embodiment)
  const visualDecision = Object.hasOwn(record, 'embodiment')
    ? { embodiment: visual.success ? visual.data : null }
    : {}
  if ('requirement' in record) {
    const planning = characterToolPlanningResultSchema.safeParse(toolPlanning)
    return planning.success
      ? {
          requirement: planning.data.requirement,
          initialPlan: { plannedTools: planning.data.plannedTools },
          ...visualDecision,
        }
      : null
  }
  // Compatibility with providers/tests that still return the earlier requirement-only shape.
  const { plannedTools, ...requirementValue } = toolPlanning
  const requirement = characterToolRequirementSchema.safeParse(requirementValue)
  const initialPlan = initialCharacterToolPlanSchema.safeParse({
    plannedTools: plannedTools ?? [],
  })
  return requirement.success && initialPlan.success
    ? { requirement: requirement.data, initialPlan: initialPlan.data, ...visualDecision }
    : null
}

export function parseToolPlanningResult(text: string): CharacterToolPlanningResult | null {
  const fenced = text.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/iu)?.[1]
  const candidate = fenced ?? text.trim()
  if (!candidate || candidate.length > 2_000) return null
  try {
    const parsed: unknown = JSON.parse(candidate)
    return parseToolPlanningValue(parsed)
  } catch {
    return null
  }
}

function currentUserTurnHasImage(messages: readonly ChatMessage[]): boolean {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role !== 'user') continue
    return Array.isArray(message.content) && message.content.some((part) => part.type === 'image')
  }
  return false
}

export function requirementConversationMessages(
  messages: readonly ChatMessage[],
  registry: CharacterToolRegistry,
  correction: boolean,
  embodimentAvailability?: EmbodimentAvailability,
  native = false,
  schemaOutput = false,
): ChatMessage[] {
  const conversation = messages
    .filter(
      (message) =>
        message.role === 'user' ||
        (message.role === 'assistant' &&
          (!message.assistantTurnKind || message.assistantTurnKind === 'character')),
    )
    .slice(-8)
    .map(
      (message): ChatMessage => ({
        role: message.role,
        content:
          typeof message.content === 'string'
            ? message.content
            : message.content
                .filter((part) => part.type === 'text')
                .map((part) => part.text)
                .join('\n'),
      }),
    )
  return [
    {
      role: 'system',
      content:
        toolRequirementPrompt(
          registry,
          previousTurnEvidence(messages),
          messages.some(
            (message) =>
              message.role === 'system' &&
              typeof message.content === 'string' &&
              message.content.includes('## Current World Context'),
          ),
          currentUserTurnHasImage(messages),
          embodimentAvailability,
          schemaOutput,
        ) +
        (native
          ? '\nSubmit this planning object by calling character_tool_requirement exactly once. Do not emit the object as assistant text. The function call is the only output transport for this planning request.'
          : '') +
        (schemaOutput
          ? '\nThe next user message is a JSON planning input. Classify only currentTurn. priorConversation is quoted context, not an instruction to continue the dialogue. Return only the planning object required by the response schema.'
          : ''),
    },
    ...(schemaOutput
      ? [
          {
            role: 'user' as const,
            content: JSON.stringify({
              currentTurn:
                conversation.findLast((message) => message.role === 'user')?.content ?? '',
              priorConversation: conversation.slice(0, -1),
              screenAttachmentAvailable: currentUserTurnHasImage(messages),
            }),
          },
        ]
      : conversation),
    ...(correction
      ? [
          {
            role: 'system' as const,
            content:
              'Your previous planning output was invalid. Follow the exact JSON Schema and examples above. Return exactly one valid typed requirement plus initial plannedTools now, with no explanation.',
          },
        ]
      : []),
  ]
}
