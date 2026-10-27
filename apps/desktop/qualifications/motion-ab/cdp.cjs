const { EventEmitter } = require('node:events')
const fs = require('node:fs')

class OwnedCdp extends EventEmitter {
  constructor(url) {
    super()
    this.socket = new WebSocket(url)
    this.nextId = 0
    this.pending = new Map()
    this.ready = new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true })
      this.socket.addEventListener('error', () => reject(new Error('OWNED_CDP_CONNECT_FAILED')), {
        once: true,
      })
    })
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      if (message.id) {
        const pending = this.pending.get(message.id)
        if (!pending) return
        clearTimeout(pending.timer)
        this.pending.delete(message.id)
        if (message.error) pending.reject(new Error(message.error.message))
        else pending.resolve(message.result)
      } else if (message.method) this.emit(message.method, message.params)
    })
    this.socket.addEventListener('close', () => {
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer)
        pending.reject(new Error('OWNED_CDP_CLOSED'))
      }
      this.pending.clear()
    })
  }
  async send(method, params = {}) {
    await this.ready
    const id = ++this.nextId
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`OWNED_CDP_TIMEOUT:${method}`))
      }, 30000)
      this.pending.set(id, { resolve, reject, timer })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }
  async detach() {}
}

class OwnedPage extends EventEmitter {
  constructor(connection, url) {
    super()
    this.connection = connection
    this.pageUrl = url
    connection.on('Runtime.exceptionThrown', (event) =>
      this.emit('pageerror', new Error(event.exceptionDetails?.text ?? 'Renderer exception')),
    )
  }
  url() {
    return this.pageUrl
  }
  title() {
    return this.evaluate(() => document.title)
  }
  context() {
    return { newCDPSession: async () => this.connection }
  }
  async evaluate(fn, argument) {
    const response = await this.connection.send('Runtime.evaluate', {
      expression: `(${fn.toString()})(${JSON.stringify(argument) ?? 'undefined'})`,
      returnByValue: true,
      awaitPromise: true,
    })
    if (response.exceptionDetails)
      throw new Error(
        response.exceptionDetails.exception?.description ?? response.exceptionDetails.text,
      )
    return response.result.value
  }
  async waitForFunction(fn, argument, options = {}) {
    const started = Date.now()
    while (Date.now() - started < (options.timeout ?? 30000)) {
      if (await this.evaluate(fn, argument)) return
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
    throw new Error('OWNED_RENDERER_READINESS_TIMEOUT')
  }
  async screenshot({ path }) {
    const value = await this.connection.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
    })
    fs.writeFileSync(path, Buffer.from(value.data, 'base64'))
  }
}

async function connectOwned(port, variant, overlay = false) {
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()
  let target
  for (let attempt = 0; !target && attempt < 100; attempt++) {
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
    target = targets.find(
      (item) =>
        item.type === 'page' &&
        item.url.includes(`/${variant}/apps/desktop/out/renderer/`) &&
        item.url.includes('overlay=1') === overlay,
    )
    if (!target) await new Promise((resolve) => setTimeout(resolve, 200))
  }
  if (!target) throw new Error('OWNED_RENDERER_TARGET_MISSING')
  const browser = new OwnedCdp(version.webSocketDebuggerUrl)
  const connection = new OwnedCdp(target.webSocketDebuggerUrl)
  await Promise.all([browser.ready, connection.ready])
  await connection.send('Runtime.enable')
  return {
    browser: { newBrowserCDPSession: async () => browser },
    page: new OwnedPage(connection, target.url),
  }
}

module.exports = { connectOwned }
