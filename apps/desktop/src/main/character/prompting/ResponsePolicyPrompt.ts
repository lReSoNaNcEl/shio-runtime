export const RESPONSE_DEPTHS = ['brief', 'normal', 'detailed'] as const
export type ResponseDepth = (typeof RESPONSE_DEPTHS)[number]

const RESPONSE_DEPTH_POLICY: Readonly<Record<ResponseDepth, string>> = Object.freeze({
  brief:
    'Use for casual conversation, acknowledgements, and simple questions that need little context.',
  normal:
    'Use for technical questions, explanations, comparisons, and tasks that need enough context or several steps to be useful.',
  detailed:
    'Use when the user explicitly asks for depth, a thorough analysis, substantial code, or when completeness is necessary for a correct answer.',
})

export function responsePolicyPrompt(): string {
  return [
    '## Adaptive Response Depth',
    'Choose the response depth semantically from the whole request:',
    ...RESPONSE_DEPTHS.map((depth) => `- ${depth}: ${RESPONSE_DEPTH_POLICY[depth]}`),
    'Prefer brief for ordinary conversation, but never omit required reasoning, instructions, caveats, code, or evidence merely to keep the response short.',
    'Honor an explicit request for a detailed answer. Use clear sections or lists when they materially improve a normal or detailed response.',
    'There is no fixed sentence limit. Use the shortest response that fully satisfies the current request.',
  ].join('\n')
}
