export interface MarkdownProtocolState {
  ticks: number
  tildes: number
  escaped: boolean
  linkDepth: number
  previous: string
}

export function initialMarkdownProtocolState(): MarkdownProtocolState {
  return { ticks: 0, tildes: 0, escaped: false, linkDepth: 0, previous: '' }
}

/** Protocol authority is absent inside code, escaped text and link destinations. */
export function scanMarkdownProtocol(text: string, state: MarkdownProtocolState): boolean[] {
  const allowed: boolean[] = []
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    allowed[index] = !state.ticks && !state.tildes && !state.escaped && !state.linkDepth
    if (state.linkDepth) {
      if (character === '(') state.linkDepth += 1
      if (character === ')') state.linkDepth -= 1
    } else if (character === '`' || character === '~') {
      let count = 1
      while (text[index + count] === character) count += 1
      for (let offset = 1; offset < count; offset += 1) allowed[index + offset] = false
      if (character === '`' && !state.tildes && !state.escaped) {
        if (!state.ticks) state.ticks = count
        else if (count === state.ticks || (state.ticks >= 3 && count >= state.ticks))
          state.ticks = 0
      }
      if (character === '~' && !state.ticks && count >= 3 && !state.escaped) {
        if (!state.tildes) state.tildes = count
        else if (count >= state.tildes) state.tildes = 0
      }
      state.escaped = false
      index += count - 1
    } else if (!state.ticks && !state.tildes) {
      if (state.escaped) state.escaped = false
      else if (character === '\\') state.escaped = true
      else if (character === '(' && state.previous === ']') state.linkDepth = 1
    }
    state.previous = character
  }
  return allowed
}
