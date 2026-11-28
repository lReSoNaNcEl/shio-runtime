import { mainLog } from '../logging/safeLogger'
import { OLLAMA_ORIGIN } from './providers/ollama'

const refreshMs = 60_000

/** Renew a finite runner lease. Other local clients share the model and can reset its expiry. */
export class OllamaStreamWarmup {
  private readonly lifetime = new AbortController()
  private pending?: { model: string; result: Promise<boolean> }
  private last?: { model: string; at: number }

  constructor(private readonly selectedModel: () => string | undefined) {}

  async prepare(): Promise<boolean> {
    const model = this.selectedModel()
    if (!model || this.lifetime.signal.aborted) return true
    if (this.pending?.model === model) return this.pending.result
    if (this.last?.model === model && Date.now() - this.last.at < refreshMs / 2) return true
    // Serialize model changes so an older preload cannot evict the current selection afterwards.
    if (this.pending) {
      await this.pending.result
      return this.prepare()
    }
    const result = this.load(model)
    this.pending = { model, result }
    try {
      return await result
    } finally {
      if (this.pending?.result === result) this.pending = undefined
    }
  }

  retain(signal: AbortSignal): void {
    if (signal.aborted || this.lifetime.signal.aborted) return
    const refresh = () => {
      void this.prepare().catch(() => mainLog.warn('[Ollama] stream warmup unavailable'))
    }
    refresh()
    const timer = setInterval(refresh, refreshMs)
    timer.unref()
    const stop = AbortSignal.any([signal, this.lifetime.signal])
    stop.addEventListener('abort', () => clearInterval(timer), { once: true })
  }

  dispose(): void {
    this.lifetime.abort()
  }

  private async load(model: string): Promise<boolean> {
    try {
      const response = await fetch(`${OLLAMA_ORIGIN}/api/generate`, {
        method: 'POST',
        redirect: 'error',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, stream: false, keep_alive: '5m' }),
        signal: AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(90_000)]),
      })
      if (!response.ok || (await response.json()).done !== true) throw new Error('warmup failed')
      this.last = { model, at: Date.now() }
      return true
    } catch {
      if (!this.lifetime.signal.aborted) mainLog.warn('[Ollama] stream warmup unavailable')
      return false
    }
  }
}
