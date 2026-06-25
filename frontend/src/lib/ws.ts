type Handler<T = unknown> = (msg: T) => void
type ConnHandler = (connected: boolean) => void

interface WsOptions {
  reconnectBaseMs?: number
  pingIntervalMs?: number  // default 30 000; set 0 to disable
}

export class WsClient {
  private url: string
  private opts: WsOptions
  private ws: WebSocket | null = null
  private handlers = new Map<string, Handler[]>()
  private connHandlers: ConnHandler[] = []
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private pongTimer: ReturnType<typeof setTimeout> | null = null
  private attempts = 0
  private destroyed = false
  private _connected = false

  constructor(url: string, opts: WsOptions = {}) {
    this.url = url
    this.opts = opts
    this.connect()
  }

  get isConnected(): boolean {
    return this._connected
  }

  private setConnected(v: boolean) {
    if (this._connected === v) return
    this._connected = v
    this.connHandlers.forEach(h => { try { h(v) } catch (e) { if (import.meta.env.DEV) console.error('[ws] conn handler', e) } })
  }

  private connect() {
    if (this.destroyed) return
    this.ws = new WebSocket(this.url)
    this.ws.onopen = () => { this.attempts = 0; this.setConnected(true); this.startPing() }
    this.ws.onclose = () => {
      this.clearPing()
      this.setConnected(false)
      if (this.destroyed) return
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
      if (type === 'pong') { this.clearPongTimer(); return }
      ;(this.handlers.get(type) ?? []).forEach(h => h(msg))
      ;(this.handlers.get('*') ?? []).forEach(h => h(msg))
    }
  }

  private startPing() {
    const interval = this.opts.pingIntervalMs ?? 30_000
    if (interval <= 0) return
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState !== WebSocket.OPEN) return
      this.clearPongTimer()
      this.ws.send(JSON.stringify({ type: 'ping' }))
      this.pongTimer = setTimeout(() => {
        if (import.meta.env.DEV) console.warn('[ws] pong timeout — reconnecting')
        this.ws?.close()
      }, 10_000)
    }, interval)
  }

  private clearPongTimer() {
    if (this.pongTimer) { clearTimeout(this.pongTimer); this.pongTimer = null }
  }

  private clearPing() {
    if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null }
    this.clearPongTimer()
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

  onConnection(handler: ConnHandler): () => void {
    this.connHandlers.push(handler)
    // Fire immediately with current state so subscribers don't miss the edge if they mounted after open.
    try { handler(this._connected) } catch (e) { if (import.meta.env.DEV) console.error('[ws] conn handler init', e) }
    return () => {
      this.connHandlers = this.connHandlers.filter(h => h !== handler)
    }
  }

  getStats() {
    return {
      url: this.url,
      readyState: this.ws?.readyState ?? WebSocket.CLOSED,
      attempts: this.attempts,
      connected: this._connected,
    }
  }

  send(msg: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg))
  }

  destroy() {
    this.destroyed = true
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null }
    this.clearPing()
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
