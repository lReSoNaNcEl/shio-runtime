import type { ChatMessage, LlmCapabilities, LlmContentPart } from '../types'

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
  }
}

export function prepareMessages(
  messages: readonly ChatMessage[],
  capabilities: LlmCapabilities,
): OpenAICompatibleMessage[] {
  if (capabilities.supportsSystemPrompt) return messages.map(toOpenAIMessage)
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
  if (!systemText) return rest.map(toOpenAIMessage)
  const firstUserIndex = rest.findIndex((message) => message.role === 'user')
  if (firstUserIndex === -1) {
    return [{ role: 'user', content: systemText }, ...rest.map(toOpenAIMessage)]
  }
  const merged = [...rest]
  const firstUserContent = merged[firstUserIndex].content
  merged[firstUserIndex] = {
    role: 'user',
    content:
      typeof firstUserContent === 'string'
        ? `${systemText}\n\n${firstUserContent}`
        : [{ type: 'text', text: systemText }, ...firstUserContent],
  }
  return merged.map(toOpenAIMessage)
}
