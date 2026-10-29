import type { ModelMessage } from 'ai'

import type { ChatMessage, LlmCapabilities } from '../types'

const text = (message: ChatMessage) =>
  typeof message.content === 'string'
    ? message.content
    : message.content
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('\n')

/** Shio role policy; the SDK owns provider wire serialization. */
export function prepareMessages(
  messages: readonly ChatMessage[],
  capabilities: LlmCapabilities,
  singleLeadingSystemMessage = false,
): ModelMessage[] {
  let source = [...messages]
  if (!capabilities.supportsSystemPrompt) {
    const system = source
      .filter((message) => message.role === 'system')
      .map(text)
      .join('\n\n')
    source = source.filter((message) => message.role !== 'system')
    if (system) {
      const index = source.findIndex((message) => message.role === 'user')
      if (index < 0) source.unshift({ role: 'user', content: system })
      else
        source[index] = {
          ...source[index],
          content:
            typeof source[index].content === 'string'
              ? `${system}\n\n${source[index].content}`
              : [{ type: 'text', text: system }, ...source[index].content],
        }
    }
  } else if (singleLeadingSystemMessage) {
    let count = 0
    while (source[count]?.role === 'system') count++
    const leading = source.slice(0, count).map(text).join('\n\n')
    source = source
      .slice(count)
      .map((message) => (message.role === 'system' ? { ...message, role: 'user' } : message))
    if (count) source.unshift({ role: 'system', content: leading })
  }
  return source.map((message): ModelMessage => {
    if (message.role === 'system') return { role: 'system', content: text(message) }
    if (message.role === 'tool') {
      const call = messages
        .flatMap((item) => item.toolCalls ?? [])
        .find((item) => item.id === message.toolCallId)
      return {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: message.toolCallId ?? '',
            toolName: message.name ?? call?.name ?? '',
            output: { type: 'text', value: text(message) },
          },
        ],
      }
    }
    if (message.role === 'assistant')
      return {
        role: 'assistant',
        content: [
          { type: 'text', text: text(message) },
          ...(message.toolCalls ?? []).map((call) => ({
            type: 'tool-call' as const,
            toolCallId: call.id,
            toolName: call.name,
            input: JSON.parse(call.argumentsJson),
          })),
        ],
      }
    return {
      role: 'user',
      content:
        typeof message.content === 'string'
          ? message.content
          : message.content.map((part) =>
              part.type === 'text'
                ? part
                : { type: 'file' as const, data: part.bytes, mediaType: part.mimeType },
            ),
    }
  })
}
