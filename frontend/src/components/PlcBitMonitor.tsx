import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store/app'
import { getWsClient } from '@/lib/ws'

// ─── bit metadata ──────────────────────────────────────────────────────────
// addr = actual Keyence MR register number. Mirrors backend config.yaml device_map.
export interface BitMeta {
  addr: number
  label: string
  labelKey: string
  dir: 'web-to-plc' | 'plc-to-web'
  group: 'control' | 'actuator' | 'operation'
  /** If set, clicking this bit (when ON) pulses the given MR addr to clear it */
  clearAddr?: number
  urgent?: boolean
}

export const BIT_META: BitMeta[] = [
  // ── Group: Control ──────────────────────────────────────────────────────
  { addr: 800, label: 'Start',          labelKey: 'hardware.bits.start',          dir: 'web-to-plc', group: 'control' },
  { addr: 801, label: 'Stop',           labelKey: 'hardware.bits.stop',           dir: 'web-to-plc', group: 'control' },
  { addr: 802, label: 'Reset',          labelKey: 'hardware.bits.reset',          dir: 'web-to-plc', group: 'control' },
  { addr: 300, label: 'Lamp Start',     labelKey: 'hardware.bits.lampStart',      dir: 'plc-to-web', group: 'control' },
  { addr: 301, label: 'Lamp Stop',      labelKey: 'hardware.bits.lampStop',       dir: 'plc-to-web', group: 'control' },
  { addr: 302, label: 'Lamp Reset',     labelKey: 'hardware.bits.lampReset',      dir: 'plc-to-web', group: 'control' },
  { addr: 303, label: 'Machine Ready',  labelKey: 'hardware.bits.machineReady',   dir: 'plc-to-web', group: 'control' },
  // ── Group: Actuator (Axis alarms + clear commands) ──────────────────────
  { addr: 100, label: 'Axis 1',            labelKey: 'hardware.bits.axis1',     dir: 'plc-to-web', group: 'actuator', urgent: true, clearAddr: 101 },
  { addr: 101, label: 'Axis 1 Clr Alarm',  labelKey: 'hardware.bits.axis1Clr',  dir: 'web-to-plc', group: 'actuator' },
  { addr: 200, label: 'Axis 2',            labelKey: 'hardware.bits.axis2',     dir: 'plc-to-web', group: 'actuator', urgent: true, clearAddr: 201 },
  { addr: 201, label: 'Axis 2 Clr Alarm',  labelKey: 'hardware.bits.axis2Clr',  dir: 'web-to-plc', group: 'actuator' },
  { addr: 2,   label: 'Axis 3',            labelKey: 'hardware.bits.axis3',     dir: 'plc-to-web', group: 'actuator', urgent: true, clearAddr: 502 },
  { addr: 502, label: 'Axis 3 Clr Alarm',  labelKey: 'hardware.bits.axis3Clr',  dir: 'web-to-plc', group: 'actuator' },
  // ── Group: Operation Bit (test-cycle signals + clamp + E-Stop) ──────────
  { addr: 803, label: 'Press Clamp',       labelKey: 'hardware.bits.pressClamp',   dir: 'web-to-plc', group: 'operation' },
  { addr: 804, label: 'Clamp Stop',        labelKey: 'hardware.bits.clampStop',    dir: 'web-to-plc', group: 'operation' },
  { addr: 808, label: 'Tare ESP32',        labelKey: 'hardware.bits.tareEsp32',    dir: 'web-to-plc', group: 'operation' },
  { addr: 810, label: 'Force Limit',       labelKey: 'hardware.bits.forceLimit',   dir: 'web-to-plc', group: 'operation' },
  { addr: 815, label: 'Tension Limit',     labelKey: 'hardware.bits.tensionLimit', dir: 'web-to-plc', group: 'operation' },
  { addr: 3,   label: 'E-Stop (HW)',       labelKey: 'hardware.bits.eStop',        dir: 'plc-to-web', group: 'operation', urgent: true },
  { addr: 805, label: 'Tension Start',     labelKey: 'hardware.bits.tensionStart', dir: 'plc-to-web', group: 'operation' },
  { addr: 806, label: 'End Loop',          labelKey: 'hardware.bits.endLoop',      dir: 'plc-to-web', group: 'operation' },
  { addr: 807, label: 'All Loops Done',    labelKey: 'hardware.bits.allLoopsDone', dir: 'plc-to-web', group: 'operation' },
  { addr: 814, label: 'Loops Complete',    labelKey: 'hardware.bits.loopsComplete', dir: 'plc-to-web', group: 'operation' },
]

// ─── usePlcBitPulse ────────────────────────────────────────────────────────
export function usePlcBitPulse() {
  const setPlcBit = useAppStore((s) => s.setPlcBit)
  const [pulsing, setPulsing] = useState<Set<number>>(new Set())
  const pulseTimers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())

  useEffect(() => {
    const ws = getWsClient()
    const off = ws.on<{ type: string; addr: number; value: boolean }>('plc_bit', (msg) => {
      setPlcBit(msg)
      setPulsing((prev) => new Set(prev).add(msg.addr))
      const existing = pulseTimers.current.get(msg.addr)
      if (existing) clearTimeout(existing)
      const tid = setTimeout(() => {
        setPulsing((prev) => { const n = new Set(prev); n.delete(msg.addr); return n })
        pulseTimers.current.delete(msg.addr)
      }, 1000)
      pulseTimers.current.set(msg.addr, tid)
    })
    return () => { off(); pulseTimers.current.forEach((t) => clearTimeout(t)) }
  }, [setPlcBit])

  return pulsing
}

// ─── StatusPill ────────────────────────────────────────────────────────────
interface StatusPillProps {
  meta: BitMeta
  value: boolean
  pulsing: boolean
  onClick?: () => void
}

export function StatusPill({ meta, value, pulsing, onClick }: StatusPillProps) {
  const { t } = useTranslation()
  const isWebToPlc = meta.dir === 'web-to-plc'
  const isUrgentOn = value && meta.urgent

  const dotCn = cn(
    'w-2 h-2 rounded-full flex-shrink-0 transition-colors duration-200',
    value
      ? isUrgentOn   ? 'bg-red-500'
      : isWebToPlc   ? 'bg-green-500'
                     : 'bg-amber-500'
      : 'bg-slate-300 dark:bg-slate-700',
    (pulsing || isUrgentOn) && value && 'animate-pulse',
  )

  const pillCn = cn(
    'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition-all select-none',
    value
      ? isUrgentOn   ? 'border-red-500/50 bg-red-50 text-red-700 dark:border-red-600/50 dark:bg-red-950/60 dark:text-red-300'
      : isWebToPlc   ? 'border-green-600/40 bg-green-50 text-green-700 dark:border-green-700/40 dark:bg-green-950/40 dark:text-green-300'
                     : 'border-amber-600/40 bg-amber-50 text-amber-700 dark:border-amber-700/40 dark:bg-amber-950/40 dark:text-amber-300'
      : 'border-border bg-muted/40 text-muted-foreground',
    onClick
      ? isUrgentOn
        ? 'cursor-pointer hover:ring-1 hover:ring-red-500/60 active:scale-95'
        : 'cursor-pointer hover:ring-1 hover:ring-border active:scale-95'
      : 'cursor-default',
  )

  return (
    <button
      className={pillCn}
      onClick={onClick}
      disabled={!onClick}
      type="button"
      title={`MR${meta.addr} — ${meta.label} — ${value ? 'ON' : 'OFF'}${onClick && value ? ' (click to clear)' : ''}`}
    >
      <span className={dotCn} />
      <span className="font-mono text-xs opacity-50">MR{meta.addr}</span>
      <span>{t(meta.labelKey as any)}</span>
      {value && onClick && (
        <span className="ml-0.5 rounded bg-red-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-red-700 dark:text-red-300 uppercase tracking-wide">
          Clear →
        </span>
      )}
    </button>
  )
}

// ─── full monitor (used in Hardware page) ─────────────────────────────────
export function PlcBitMonitor() {
  const { t } = useTranslation()
  const plcBits = useAppStore((s) => s.plcBits)
  const pulsing = usePlcBitPulse()

  const groups: { key: BitMeta['group']; label: string }[] = [
    { key: 'control',   label: t('hardware.control') },
    { key: 'actuator',  label: t('hardware.actuator') },
    { key: 'operation', label: t('hardware.operation') },
  ]

  return (
    <div className="space-y-4">
      {groups.map(({ key, label }) => (
        <div key={key} className="space-y-1.5">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">{label}</p>
          <div className="flex flex-wrap gap-2">
            {BIT_META.filter((b) => b.group === key).map((meta) => (
              <StatusPill
                key={meta.addr}
                meta={meta}
                value={plcBits[meta.addr]?.value ?? false}
                pulsing={pulsing.has(meta.addr)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
