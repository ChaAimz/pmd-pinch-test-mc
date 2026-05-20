import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { WsClient } from '@/lib/ws'

class MockWS {
  static instances: MockWS[] = []
  onopen: (() => void) | null = null
  onclose: ((e: CloseEvent) => void) | null = null
  onmessage: ((e: MessageEvent) => void) | null = null
  readyState: number = WebSocket.CONNECTING
  url: string
  constructor(url: string) { this.url = url; MockWS.instances.push(this) }
  send = vi.fn()
  close = vi.fn()
  open() { this.readyState = WebSocket.OPEN; this.onopen?.() }
  receive(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent)
  }
}

beforeEach(() => { MockWS.instances = []; vi.stubGlobal('WebSocket', MockWS) })
afterEach(() => vi.unstubAllGlobals())

describe('WsClient', () => {
  it('connects on construction', () => {
    const c = new WsClient('/ws'); expect(MockWS.instances).toHaveLength(1); c.destroy()
  })
  it('dispatches typed messages to handlers', () => {
    const c = new WsClient('/ws')
    const handler = vi.fn()
    c.on('state_change', handler)
    MockWS.instances[0].open()
    MockWS.instances[0].receive({ type: 'state_change', from: 'IDLE', to: 'LOOP_BEGIN' })
    expect(handler).toHaveBeenCalledWith({ type: 'state_change', from: 'IDLE', to: 'LOOP_BEGIN' })
    c.destroy()
  })
  it('fires onConnected callback', () => {
    const cb = vi.fn()
    const c = new WsClient('/ws', { onConnected: cb })
    MockWS.instances[0].open()
    expect(cb).toHaveBeenCalled()
    c.destroy()
  })
  it('off() unregisters handler', () => {
    const c = new WsClient('/ws')
    const handler = vi.fn()
    const off = c.on('hw_status', handler)
    off()
    MockWS.instances[0].open()
    MockWS.instances[0].receive({ type: 'hw_status', plc: true, imada: false, esp32: false })
    expect(handler).not.toHaveBeenCalled()
    c.destroy()
  })
})
