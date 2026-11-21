import { randomUUID } from 'node:crypto'
import { createServer, type Socket } from 'node:net'

import { LlmResponseError } from './errors'
import type { ChatMessage, LlmImageContentPart } from './types'

export function prepareCodexInput(messages: readonly ChatMessage[]) {
  const images: LlmImageContentPart[] = []
  let totalBytes = 0
  const conversation = messages.map(({ role, content }) => ({
    role,
    content:
      typeof content === 'string'
        ? content
        : content
            .map((part) => {
              if (part.type === 'text') return part.text
              totalBytes += part.bytes.byteLength
              if (images.length >= 16 || totalBytes > 20 * 1024 * 1024) {
                throw new LlmResponseError({
                  provider: 'codex-cli',
                  code: 'REQUEST_TOO_LARGE',
                  message: 'Codex image input too large',
                })
              }
              if (!part.bytes.byteLength || !['image/png', 'image/jpeg'].includes(part.mimeType)) {
                throw new LlmResponseError({
                  provider: 'codex-cli',
                  code: 'PROVIDER_REJECTED',
                  message: 'Invalid Codex image input',
                })
              }
              images.push(part)
              return `[Image #${images.length}]`
            })
            .join('\n'),
  }))
  return { input: JSON.stringify(conversation), images }
}

// Codex reads --image from a path. A Windows pipe serves the same bytes from
// memory and disappears on process exit, including an unexpected Electron exit.
export async function openCodexImagePipe(image: LlmImageContentPart) {
  const path = `\\\\.\\pipe\\shio-image-${randomUUID()}${image.mimeType === 'image/png' ? '.png' : '.jpg'}`
  const sockets = new Set<Socket>()
  const server = createServer((socket) => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
    socket.on('error', () => socket.destroy())
    socket.end(image.bytes)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(path, () => {
      server.removeListener('error', reject)
      resolve()
    })
  })
  return {
    path,
    close: () => {
      server.close()
      for (const socket of sockets) socket.destroy()
    },
  }
}
