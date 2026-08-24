import type { ChatMessage, LlmCapabilities, LlmContentPart, LlmToolCall } from '../types'

interface OpenAITextContentPart {
  type: 'text'
  text: string
}

interface OpenAIImageContentPart {
  type: 'image_url'
  image_url: {
    url: string
  }
}

type OpenAIContentPart = OpenAITextContentPart | OpenAIImageContentPart

export interface OpenAICompatibleMessage {
  role: ChatMessage['role']
  content: string | OpenAIContentPart[]
  tool_calls?: readonly {
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }[]
  tool_call_id?: string
  name?: string
}

function toOpenAIToolCall(toolCall: LlmToolCall) {
  return {
    id: toolCall.id,
    type: 'function' as const,
    function: { name: toolCall.name, arguments: toolCall.argumentsJson },
  }
}

function convertContentPart(part: LlmContentPart): OpenAIContentPart {
  if (part.type === 'text') return part
  return {
    type: 'image_url',
    image_url: {
      url: `data:${part.mimeType};base64,${Buffer.from(part.bytes).toString('base64')}`,
    },
  }
}

function toOpenAIMessage(message: ChatMessage): OpenAICompatibleMessage {
  return {
    role: message.role,
    content:
      typeof message.content === 'string'
        ? message.content
        : message.content.map(convertContentPart),
    ...(message.toolCalls ? { tool_calls: message.toolCalls.map(toOpenAIToolCall) } : {}),
    ...(message.toolCallId ? { tool_call_id: message.toolCallId } : {}),
    ...(message.name ? { name: message.name } : {}),
  }
}

function mergeMessageContent(
  contents: readonly OpenAICompatibleMessage['content'][],
): OpenAICompatibleMessage['content'] {
  if (contents.every((content) => typeof content === 'string')) {
    return contents.join('\n\n')
  }
  const merged: OpenAIContentPart[] = []
  for (const [index, content] of contents.entries()) {
    if (index > 0) merged.push({ type: 'text', text: '\n\n' })
    if (typeof content === 'string') merged.push({ type: 'text', text: content })
    else merged.push(...content)
  }
  return merged
}

function enforceSingleLeadingSystemMessage(
  messages: readonly OpenAICompatibleMessage[],
): OpenAICompatibleMessage[] {
  const leadingSystemContent: OpenAICompatibleMessage['content'][] = []
  const remainder: OpenAICompatibleMessage[] = []
  let foundConversationMessage = false

  for (const message of messages) {
    if (message.role === 'system' && !foundConversationMessage) {
      leadingSystemContent.push(message.content)
      continue
    }
    foundConversationMessage = true
    remainder.push(message.role === 'system' ? { ...message, role: 'user' } : message)
  }

  if (leadingSystemContent.length === 0) return remainder
  return [{ role: 'system', content: mergeMessageContent(leadingSystemContent) }, ...remainder]
}

export function prepareMessages(
  messages: readonly ChatMessage[],
  capabilities: LlmCapabilities,
  singleLeadingSystemMessage = false,
): OpenAICompatibleMessage[] {
  let prepared: OpenAICompatibleMessage[]
  if (capabilities.supportsSystemPrompt) {
    prepared = messages.map(toOpenAIMessage)
  } else {
    const systemText = messages
      .filter((message) => message.role === 'system')
      .map((message) =>
        typeof message.content === 'string'
          ? message.content
          : message.content
              .filter((part) => part.type === 'text')
              .map((part) => part.text)
              .join('\n'),
      )
      .join('\n\n')
    const rest = messages.filter((message) => message.role !== 'system')
    if (!systemText) prepared = rest.map(toOpenAIMessage)
    else {
      const firstUserIndex = rest.findIndex((message) => message.role === 'user')
      if (firstUserIndex === -1) {
        prepared = [{ role: 'user', content: systemText }, ...rest.map(toOpenAIMessage)]
      } else {
        const merged = [...rest]
        const firstUserContent = merged[firstUserIndex].content
        merged[firstUserIndex] = {
          role: 'user',
          content:
            typeof firstUserContent === 'string'
              ? `${systemText}\n\n${firstUserContent}`
              : [{ type: 'text', text: systemText }, ...firstUserContent],
        }
        prepared = merged.map(toOpenAIMessage)
      }
    }
  }
  return singleLeadingSystemMessage ? enforceSingleLeadingSystemMessage(prepared) : prepared
}
