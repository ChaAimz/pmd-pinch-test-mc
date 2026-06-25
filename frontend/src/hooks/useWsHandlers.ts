import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { getWsClient } from '@/lib/ws'
import { useAppStore } from '@/store/app'
import { useChartStore } from '@/store/chart'
import { useSettingsStore } from '@/store/settings'
import type {
  WsImadaBatch,
  WsEsp32Batch,
  WsStateChange,
  WsHwStatus,
  WsLoopResult,
  WsRunFinished,
  WsPlcBit,
  WsClampForceAlarm,
} from '@/lib/types'

// Backend already batches at 50 ms (20 Hz) — no extra frontend throttle needed.
// The readout always takes the last sample in each batch (most recent value).

// Backend doesn't currently push `hw_status` over WS, but the REST endpoint is
// always available. Poll cheaply so TopBar dots match reality.
const HW_STATUS_POLL_MS = 3000

export function useWsHandlers() {
  const setWsConnected = useAppStore((s) => s.setWsConnected)
  const setHwStatus = useAppStore((s) => s.setHwStatus)

  // Poll hardware status from REST — single source of truth for TopBar dots.
  const { data: hwData } = useQuery({
    queryKey: ['hw-status'],
    queryFn: api.hardware.status,
    refetchInterval: HW_STATUS_POLL_MS,
    refetchIntervalInBackground: true,
  })

  useEffect(() => {
    if (hwData) setHwStatus({ type: 'hw_status', ...hwData })
  }, [hwData, setHwStatus])

  useEffect(() => {
    const ws = getWsClient()
    const { pushImadaBatch, setRecording } = useChartStore.getState()
    const {
      handleStateChange,
      addLoopResult,
      setRunFinished,
      setLatestImadaForce,
      setLatestEsp32Force,
      setPlcBit,
      setClampForceAlarm,
      setMaxStrokeAlarm,
    } = useAppStore.getState()

    const offs = [
      ws.onConnection((connected) => setWsConnected(connected)),
      ws.on<WsImadaBatch>('imada_batch', (msg) => {
        if (!msg.samples?.length) return
        if (useChartStore.getState().recording) {
          pushImadaBatch(msg.samples)
        }
        // Take the last sample in the batch — always the most recent value.
        setLatestImadaForce(msg.samples[msg.samples.length - 1][1])
      }),
      ws.on<WsEsp32Batch>('esp32_batch', (msg) => {
        if (!msg.samples?.length) return
        setLatestEsp32Force(msg.samples[msg.samples.length - 1][1])
      }),
      ws.on<WsStateChange>('state_change', (msg) => {
        handleStateChange(msg)
      }),
      // hw_status WS still wired in case backend starts pushing it later.
      ws.on<WsHwStatus>('hw_status', (msg) => setHwStatus(msg)),
      ws.on<WsLoopResult>('loop_result', (msg) => addLoopResult(msg)),
      ws.on<WsRunFinished>('run_finished', (msg) => {
        setRecording(false)
        setRunFinished(msg)
      }),
      // plc_bit: fired by HardwareManager whenever a polled bit changes.
      // Both modes start recording on MR805 (first tension check).
      // 'continuous' (Realtime Plot): records across all loops, stops at MR807.
      // 'gated' (Realtime Chart): stops at MR806 (per-loop window), MR807 is a safety fallback.
      ws.on<WsPlcBit>('plc_bit', (msg) => {
        setPlcBit(msg)
        if (msg.value) {
          if (msg.addr === 805) {
            // Gated mode: clear old data so chart shows only the current loop's tension check
            if (useSettingsStore.getState().chartMode === 'gated') useChartStore.getState().clear()
            setRecording(true)
          }
          if (msg.addr === 806 && useSettingsStore.getState().chartMode === 'gated') setRecording(false)
          if (msg.addr === 807) setRecording(false) // Both modes: stop when all loops done
          if (msg.addr === 811) setMaxStrokeAlarm(true)  // Max Stroke → show warning dialog
          // MR811 going LOW does NOT auto-dismiss the dialog — operator must acknowledge
        }
      }),
      // clamp_force_alarm: hardware clamp-force limit exceeded (always-on safety).
      // Backend already stopped the machine + forced ERROR; we just raise the dialog.
      ws.on<WsClampForceAlarm>('clamp_force_alarm', (msg) => {
        setClampForceAlarm(msg.message, msg.limit_gf)
      }),
    ]

    return () => offs.forEach((off) => off())
  }, [setHwStatus, setWsConnected])
}
