const INTERNAL_REASONING_MARKERS = ['think', 'analysis', 'reasoning'] as const

type InternalReasoningMarker = (typeof INTERNAL_REASONING_MARKERS)[number]

const CONTROL_TOKEN =
  /\\?<(?:(think|analysis|reasoning)(?=[\s>]|$)|\/(think|analysis|reasoning)\s*>)/iu
const TOKEN_PREFIXES = INTERNAL_REASONING_MARKERS.flatMap((name) => [
  `<${name}`,
  `\\<${name}`,
  `</${name}>`,
  `\\</${name}>`,
])
const SUPPRESSED_SUFFIX_LENGTH = 64

export interface ContainedCharacterReasoning {
  text: string
  contained: boolean
}

/**
 * Removes provider reasoning blocks before they can reach presentation, speech, or persistence.
 * The incremental parser deliberately accepts Markdown-escaped tags and arbitrary chunk splits.
 */
export class InternalReasoningStreamContainment {
  private pending = ''
  private marker: InternalReasoningMarker | null = null
  private contained = false

  push(text: string): readonly string[] {
    if (!text) return []
    this.pending += text
    return this.drain(false)
  }

  flush(): readonly string[] {
    return this.drain(true)
  }

  didContain(): boolean {
    return this.contained
  }

  private drain(final: boolean): readonly string[] {
    const output: string[] = []
    while (this.pending) {
      if (this.marker) {
        const closing = findClosingToken(this.pending, this.marker)
        this.contained = true
        if (!closing) {
          this.pending = final ? '' : this.pending.slice(-SUPPRESSED_SUFFIX_LENGTH)
          break
        }
        this.pending = this.pending.slice(closing.index + closing.length)
        this.marker = null
        continue
      }

      const control = CONTROL_TOKEN.exec(this.pending)
      if (control) {
        append(output, this.pending.slice(0, control.index))
        this.pending = this.pending.slice(control.index + control[0].length)
        this.contained = true
        const opening = control[1]?.toLowerCase() as InternalReasoningMarker | undefined
        if (opening) this.marker = opening
        continue
      }

      const hold = final
        ? finalUnsafeControlTokenSuffixLength(this.pending)
        : possibleControlTokenSuffixLength(this.pending)
      const safeLength = this.pending.length - hold
      if (safeLength > 0) {
        append(output, this.pending.slice(0, safeLength))
        this.pending = this.pending.slice(safeLength)
      }
      if (final) {
        if (this.pending) this.contained = true
        this.pending = ''
      }
      break
    }
    return Object.freeze(output)
  }
}

export function containInternalReasoning(text: string): ContainedCharacterReasoning {
  const containment = new InternalReasoningStreamContainment()
  const output = [...containment.push(text), ...containment.flush()]
  return Object.freeze({ text: output.join(''), contained: containment.didContain() })
}

function findClosingToken(
  text: string,
  marker: InternalReasoningMarker,
): { index: number; length: number } | null {
  const match = new RegExp(`\\\\?<\\/${marker}\\s*>`, 'iu').exec(text)
  return match ? { index: match.index, length: match[0].length } : null
}

function possibleControlTokenSuffixLength(text: string): number {
  const lower = text.toLowerCase()
  let hold = 0
  for (const token of TOKEN_PREFIXES) {
    const maximum = Math.min(token.length - 1, lower.length)
    for (let length = maximum; length > hold; length -= 1) {
      if (token.startsWith(lower.slice(-length))) {
        hold = length
        break
      }
    }
  }
  return hold
}

function finalUnsafeControlTokenSuffixLength(text: string): number {
  const hold = possibleControlTokenSuffixLength(text)
  if (hold === 0) return 0
  const suffix = text.slice(-hold).replace(/^\\/u, '')
  return suffix.length >= 4 ? hold : 0
}

function append(output: string[], text: string): void {
  if (!text) return
  const index = output.length - 1
  if (index >= 0) output[index] += text
  else output.push(text)
}
