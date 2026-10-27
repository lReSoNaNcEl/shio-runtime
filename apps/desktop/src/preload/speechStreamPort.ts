import type { SpeechStreamOutput, SpeechStreamRendererPort } from '../shared/speech'

/**
 * Keep the native MessagePort in the preload world. ContextBridge proxies functions,
 * but it does not preserve writable EventTarget properties such as `onmessage`.
 */
export function createSpeechStreamRendererPort(port: MessagePort): SpeechStreamRendererPort {
  const pending: SpeechStreamOutput[] = []
  let onMessage: ((output: SpeechStreamOutput) => void) | null = null
  let onMessageError: (() => void) | null = null
  let pendingMessageError = false
  let closed = false

  port.onmessage = (event: MessageEvent<SpeechStreamOutput>) => {
    if (closed) return
    if (onMessage) onMessage(event.data)
    else if (pending.length < 12) pending.push(event.data)
    else {
      pendingMessageError = true
      pending.length = 0
      port.close()
    }
  }
  port.onmessageerror = () => {
    if (closed) return
    if (onMessageError) onMessageError()
    else pendingMessageError = true
  }
  // Start before Main can answer so even an immediate `ready` is retained here.
  port.start()

  return {
    postMessage: (input) => {
      if (!closed) port.postMessage(input)
    },
    close: () => {
      if (closed) return
      closed = true
      pending.length = 0
      port.close()
    },
    start: (messageListener, messageErrorListener) => {
      if (closed) return
      onMessage = messageListener
      onMessageError = messageErrorListener
      for (const output of pending.splice(0)) onMessage(output)
      if (pendingMessageError) {
        pendingMessageError = false
        onMessageError()
      }
    },
  }
}
