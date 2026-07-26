export interface MarkdownSpeechParseResult {
  text: string
  ruleIds: string[]
  hasCode: boolean
  hasList: boolean
}

export function parseMarkdownForSpeech(text: string, language: string): MarkdownSpeechParseResult {
  const rules = new Set<string>()
  const protectedCode: string[] = []
  const protectCode = (code: string): string => {
    const placeholder = `\uE000${protectedCode.length}\uE001`
    protectedCode.push(code)
    return placeholder
  }
  let output = text

  output = output.replace(/```[^\r\n]*\r?\n([\s\S]*?)```/gu, (_match, contents: string) => {
    const trimmed = contents.trim()
    if (trimmed && !trimmed.includes('\n') && trimmed.length <= 80) {
      rules.add('code.block-short')
      return ` ${protectCode(trimmed)} `
    }
    rules.add('code.block-omitted')
    return language.toLowerCase().startsWith('ru')
      ? ' Код показан в сообщении. '
      : ' Code is shown in the message. '
  })

  output = output.replace(/!\[([^\]]*)\]\([^)]+\)/gu, (_match, alt: string) => {
    rules.add(alt.trim() ? 'markdown.image-alt' : 'markdown.image-empty')
    return alt.trim()
  })
  output = output.replace(/\[([^\]]+)\]\(([^)]+)\)/gu, (_match, label: string) => {
    rules.add('markdown.link-label')
    return label.trim()
  })
  output = output.replace(/`([^`\r\n]+)`/gu, (_match, code: string) => {
    rules.add('code.inline')
    return protectCode(code.trim())
  })

  output = output
    .split('\n')
    .map((line) => {
      if (/^\s{0,3}(?:-{3,}|_{3,}|\*{3,})\s*$/u.test(line)) {
        rules.add('markdown.horizontal-rule')
        return ''
      }
      let current = line
      if (/^\s{0,3}#{1,6}\s+/u.test(current)) {
        rules.add('markdown.heading')
        current = current.replace(/^\s{0,3}#{1,6}\s+/u, '')
      }
      if (/^\s{0,3}>\s?/u.test(current)) {
        rules.add('markdown.blockquote')
        current = current.replace(/^\s{0,3}>\s?/u, '')
      }
      const numbered = /^\s{0,3}(\d{1,2})[.)]\s+(.+)$/u.exec(current)
      if (numbered) {
        rules.add('list.numbered')
        return language.toLowerCase().startsWith('ru')
          ? `Пункт ${russianInteger(Number(numbered[1]))}. ${numbered[2]}.`
          : `Item ${numbered[1]}. ${numbered[2]}.`
      }
      const bullet = /^\s{0,3}[-+*]\s+(.+)$/u.exec(current)
      if (bullet) {
        rules.add('list.bullet')
        return `${bullet[1]}.`
      }
      return current
    })
    .join('\n')

  output = removeMarkdownEmphasis(output, rules)
  output = output.replace(/\uE000(\d+)\uE001/gu, (_match, index: string) => {
    return protectedCode[Number(index)] ?? ''
  })

  return {
    text: output,
    ruleIds: [...rules],
    hasCode: [...rules].some((rule) => rule.startsWith('code.')),
    hasList: [...rules].some((rule) => rule.startsWith('list.')),
  }
}

function removeMarkdownEmphasis(text: string, rules: Set<string>): string {
  let output = text
  const remove = (pattern: RegExp): void => {
    const before = output
    output = output.replace(pattern, '$1')
    if (output !== before) rules.add('markdown.emphasis')
  }

  remove(/(?<![\p{L}\p{N}_])\*\*(?=\S)([\s\S]*?\S)\*\*(?![\p{L}\p{N}_])/gu)
  remove(/(?<![\p{L}\p{N}_])~~(?=\S)([\s\S]*?\S)~~(?![\p{L}\p{N}_])/gu)
  remove(/(?<![\p{L}\p{N}_])\*(?!\*)(?=\S)([\s\S]*?\S)\*(?![\p{L}\p{N}_*])/gu)
  remove(/(?<![\p{L}\p{N}_])_(?!_)(?=\S)([\s\S]*?\S)_(?![\p{L}\p{N}_])/gu)
  return output
}

import { russianInteger } from './technicalTokenParser'
