/**
 * Deterministic output-quality checks for Character eval. They score a recorded
 * reply after the fact; they are never runtime routing and never change a turn.
 */
import { parseEmotionalReply } from '../../../src/shared/emotion'
import { SPEECH_EMOTIONS } from '../../../src/shared/speech'

export interface EvalReply {
  replyText: string
  assistantTurnKind?: string
  requirementType?: string
  firstTextMs?: number
}

export interface EvalExpectation {
  requirement?: 'direct-answer' | 'source-preferred' | 'required-source' | 'explicit-tool'
  minVisibleCharacters?: number
  maxVisibleCharacters?: number
  feminineSelfReference?: boolean
}

export interface CheckResult {
  id: string
  pass: boolean
  detail?: string
}

const TAG = /\[([a-z_]+)(?::[^\]]{0,40})?\]/gu

export function emotionTagFirst(reply: EvalReply): CheckResult {
  const match = reply.replyText.trimStart().match(/^\[([a-z_]+)\]/u)
  const pass = Boolean(match && (SPEECH_EMOTIONS as readonly string[]).includes(match[1]))
  return { id: 'emotion-tag-first', pass, detail: match?.[1] ?? 'missing' }
}

export function boundedSegments(reply: EvalReply): CheckResult {
  const emotions = [...reply.replyText.matchAll(TAG)]
    .map((match) => match[1])
    .filter((id) => (SPEECH_EMOTIONS as readonly string[]).includes(id))
  const repeated = emotions.some((id, index) => index > 0 && emotions[index - 1] === id)
  return {
    id: 'bounded-segments',
    pass: emotions.length >= 1 && emotions.length <= 3 && !repeated,
    detail: emotions.join(','),
  }
}

/** Visible text must not carry stage directions or leaked protocol markers. */
export function noLeakedMarkup(reply: EvalReply): CheckResult {
  const visible = parseEmotionalReply(reply.replyText).visibleText
  const leaks = [
    /<\/?shio[^>]*>/iu,
    /\[(?:voice|fox-paw|gesture)[^\]]*\]/iu,
    /\*[^*\n]{2,60}\*/u,
    /\((?:смеётся|смеется|улыбается|вздыхает|пауза|laughs|smiles|sighs|pause)\)/iu,
    /"(?:requirement|plannedTools|turnAppraisal)"\s*:/u,
  ].filter((pattern) => pattern.test(visible))
  return { id: 'no-leaked-markup', pass: leaks.length === 0, detail: leaks.map(String).join(' ') }
}

/** Shio speaks of herself in the feminine past tense in Russian. */
export function feminineSelfReference(reply: EvalReply): CheckResult {
  const visible = parseEmotionalReply(reply.replyText).visibleText.toLowerCase()
  const masculine = visible.match(/(?:^|[\s,.!?])я\s+(?:не\s+)?([а-яё]+л)(?=[\s,.!?]|$)/u)
  return {
    id: 'feminine-self-reference',
    pass: !masculine,
    detail: masculine?.[1],
  }
}

export function expectedRequirement(reply: EvalReply, expectation: EvalExpectation): CheckResult {
  if (!expectation.requirement) return { id: 'tool-requirement', pass: true }
  return {
    id: 'tool-requirement',
    pass:
      reply.assistantTurnKind === 'character' && reply.requirementType === expectation.requirement,
    detail: `${reply.assistantTurnKind ?? 'unknown'}:${reply.requirementType ?? 'none'}`,
  }
}

export function lengthBounds(reply: EvalReply, expectation: EvalExpectation): CheckResult {
  const length = parseEmotionalReply(reply.replyText).visibleText.length
  const minimum = expectation.minVisibleCharacters ?? 1
  const maximum = expectation.maxVisibleCharacters ?? 1_200
  return {
    id: 'length-bounds',
    pass: length >= minimum && length <= maximum,
    detail: String(length),
  }
}

/** Protocol checks gate prompt changes; persona checks are reported separately. */
export const PROTOCOL_CHECKS = [
  'emotion-tag-first',
  'bounded-segments',
  'no-leaked-markup',
  'tool-requirement',
] as const

export function runChecks(reply: EvalReply, expectation: EvalExpectation): CheckResult[] {
  return [
    emotionTagFirst(reply),
    boundedSegments(reply),
    noLeakedMarkup(reply),
    ...(expectation.feminineSelfReference === false ? [] : [feminineSelfReference(reply)]),
    expectedRequirement(reply, expectation),
    lengthBounds(reply, expectation),
  ]
}

/** Share of passed protocol checks over all cases, 0..1. */
export function protocolScore(results: readonly CheckResult[][]): number {
  const protocol = results
    .flat()
    .filter((result) => (PROTOCOL_CHECKS as readonly string[]).includes(result.id))
  return protocol.length ? protocol.filter((result) => result.pass).length / protocol.length : 0
}
