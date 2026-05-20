type Handler<T = unknown> = (msg: T) => void

interface WsOptions {
  onConnected?: () => void
  onDisconnected?: () => void
  reconnectBaseMs?: number
}

export class WsClient {
  private url: string
  private opts: WsOptions
  private ws: WebSocket | null = null
  private handlers = new Map<string, Handler[]>()
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private attempts = 0
  private destroyed = false

  constructor(url: string, opts: WsOptions = {}) {
    this.url = url
    this.opts = opts
    this.connect()
  }

  private connect() {
    if (this.destroyed) return
    this.ws = new WebSocket(this.url)
    this.ws.onopen = () => { this.attempts = 0; this.opts.onConnected?.() }
    this.ws.onclose = () => {
      if (this.destroyed) return
      this.opts.onDisconnected?.()
      const delay = Math.min(30_000, (this.opts.reconnectBaseMs ?? 1_000) * 2 ** this.attempts)
      this.attempts++
      this.reconnectTimer = setTimeout(() => this.connect(), delay)
    }
    this.ws.onerror = (ev) => {
      if (import.meta.env.DEV) console.error('[ws] error', ev)
    }
    this.ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return
      let msg: { type?: string } | null = null
      try { msg = JSON.parse(ev.data) } catch { return }
      const type = msg?.type
      if (!type) return
      ;(this.handlers.get(type) ?? []).forEach(h => h(msg))
      ;(this.handlers.get('*') ?? []).forEach(h => h(msg))
    }
  }

  on<T = unknown>(type: string, handler: Handler<T>): () => void {
    const list = this.handlers.get(type) ?? []
    // T is caller-side only; runtime dispatch is untyped (string key → unknown payload)
    list.push(handler as Handler)
    this.handlers.set(type, list)
    return () => {
      this.handlers.set(type, (this.handlers.get(type) ?? []).filter(h => h !== handler))
    }
  }

  send(msg: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg))
  }

  destroy() {
    this.destroyed = true
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null }
    this.ws?.close(); this.ws = null
  }
}

// Singleton — created lazily, stores wired after creation
let _client: WsClient | null = null

export function getWsClient(): WsClient {
  if (_client) return _client
  _client = new WsClient('/ws')
  return _client
}

export function resetWsClient() {
  _client?.destroy()
  _client = null
}
