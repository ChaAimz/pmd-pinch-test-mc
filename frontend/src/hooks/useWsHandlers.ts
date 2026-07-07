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
  WsImadaTensionAlarm,
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
      setImadaTensionAlarm,
      setMaxStrokeAlarm,
      setLoopsCompleteAck,
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
        // Guard on run_id like addLoopResult: a late / duplicate run_finished from a
        // PREVIOUS run (e.g. one that arrives just after the operator starts the next run)
        // must not stop recording and freeze the new run's live chart.
        const cur = useAppStore.getState().currentRunId
        if (msg.run_id != null && cur != null && msg.run_id !== cur) return
        setRecording(false)
        setRunFinished(msg)
      }),
      // plc_bit: fired by HardwareManager whenever a polled bit changes.
      // Recording starts at session start (useSessionControl) and stops at MR807 / run_finished.
      // 'gated' mode: clears the buffer on each MR805 so the chart shows one tension window at a time.
      // 'continuous' mode: accumulates all data from session start across all loops.
      ws.on<WsPlcBit>('plc_bit', (msg) => {
        setPlcBit(msg)
        // MR814 (Loops Complete ack) tracks the bit on BOTH edges: HIGH raises the
        // Complete-Loops confirm dialog; LOW (PLC- or confirm-driven) dismisses it.
        if (msg.addr === 814) setLoopsCompleteAck(msg.value)
        if (msg.value) {
          if (msg.addr === 805) {
            // Gated mode: arm a deferred clear (applied on the new window's first sample so
            // the previous window stays on screen until the new one starts drawing — no blank
            // flash) and (re)start recording. The window draws live MR805→MR806.
            if (useSettingsStore.getState().chartMode === 'gated') {
              useChartStore.getState().armClear()
              setRecording(true)
            }
          }
          if (msg.addr === 806) {
            // Gated mode: freeze at end of tension check — stop accumulating so the completed
            // window HOLDS on screen until the next MR805 replaces it (operator's chosen mode).
            if (useSettingsStore.getState().chartMode === 'gated') setRecording(false)
          }
          if (msg.addr === 807) setRecording(false) // Both modes: freeze chart when all loops done
          if (msg.addr === 811) setMaxStrokeAlarm(true)  // Max Stroke → show warning dialog
          // MR811 going LOW does NOT auto-dismiss the dialog — operator must acknowledge
        }
      }),
      // clamp_force_alarm: hardware clamp-force limit exceeded (always-on safety).
      // Backend already stopped the machine + forced ERROR; we just raise the dialog.
      ws.on<WsClampForceAlarm>('clamp_force_alarm', (msg) => {
        setClampForceAlarm(msg.message, msg.limit_gf)
      }),
      // imada_tension_alarm: Imada tension reading reached the configured warning
      // limit (MR815). Informational only — the test keeps running. `active: false`
      // arrives either as an echo of our own ack call or from another client's ack.
      ws.on<WsImadaTensionAlarm>('imada_tension_alarm', (msg) => {
        setImadaTensionAlarm(msg.active ? msg.message : null, msg.active ? msg.limit_n : null)
      }),
    ]

    return () => offs.forEach((off) => off())
  }, [setHwStatus, setWsConnected])
}
