import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { RefreshCw, TriangleAlert, Cpu, Activity, CircuitBoard, Info } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NumpadInput } from '@/components/ui/numpad-input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { BIT_META, usePlcBitPulse, type BitMeta } from '@/components/PlcBitMonitor'
import { useAppStore } from '@/store/app'
import { useSettingsStore } from '@/store/settings'
import { api } from '@/lib/api'
import type { HardwareStatus } from '@/lib/types'

type Device = 'plc' | 'imada' | 'esp32'

const DEVICE_CONFIG = {
  plc:   { label: 'PLC',    Icon: Cpu,          descKey: 'hardware.plcDesc' as const },
  imada: { label: 'IMADA',  Icon: Activity,     descKey: 'hardware.imadaDesc' as const },
  esp32: { label: 'ESP32',  Icon: CircuitBoard, descKey: 'hardware.esp32Desc' as const },
} as const

// ─── ESP32 unit helpers ──────────────────────────────────────────────────────
const GF_PER_N = 101.97162129779283
const N_PER_GF = 1 / GF_PER_N

function fmtEsp32(n: number, unit: 'gf' | 'N') {
  return unit === 'gf' ? (n * GF_PER_N).toFixed(1) : n.toFixed(4)
}

// ─── Info button (popover) ────────────────────────────────────────────────────
function InfoButton({ title, body }: { title: string; body: string }) {
  return (
    <Popover>
      <PopoverTrigger
        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-orange-500 transition-colors hover:text-orange-400 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        aria-label={title}
      >
        <Info size={12} />
      </PopoverTrigger>
      <PopoverContent side="right" align="start" className="max-w-[300px] p-3 space-y-1.5">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground whitespace-pre-line">{body}</p>
      </PopoverContent>
    </Popover>
  )
}

// ─── Card wrapper ─────────────────────────────────────────────────────────────
function Card({ title, children, headerRight }: {
  title: string
  children: React.ReactNode
  headerRight?: React.ReactNode
}) {
  return (
    <div className="rounded-xl border border-border bg-card shadow-sm">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          {title}
        </h2>
        {headerRight}
      </div>
      <div className="p-4">
        {children}
      </div>
    </div>
  )
}

// ─── Device row (3-col status strip) ─────────────────────────────────────────
function DeviceRow({ device, ok, onReconnect, isReconnecting, isTarget }: {
  device: Device
  ok: boolean
  onReconnect: (d: Device) => void
  isReconnecting: boolean
  isTarget: boolean
}) {
  const { t } = useTranslation()
  const { label, Icon, descKey } = DEVICE_CONFIG[device]
  const isPlc = device === 'plc'

  return (
    <div className={cn(
      'flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-all',
      ok
        ? 'border-border bg-card'
        : 'border-red-300/50 dark:border-red-800/40 bg-red-50/20 dark:bg-red-950/10',
    )}>
      <Icon
        size={15}
        className={cn(
          ok
            ? 'text-emerald-500 dark:text-emerald-400'
            : 'text-red-500 dark:text-red-400',
        )}
      />
      <span className="text-sm font-semibold text-foreground">{label}</span>
      <span className="text-xs text-muted-foreground flex-1">{t(descKey)}</span>

      <span className={cn(
        'inline-flex items-center gap-1.5 text-[11px] font-semibold',
        ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400',
      )}>
        <span className={cn(
          'w-1.5 h-1.5 rounded-full',
          ok ? 'bg-emerald-500' : 'bg-red-500 animate-pulse',
        )} />
        {ok ? t('common.online') : t('common.offline')}
      </span>

      {!ok && !isPlc && (
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6 text-muted-foreground hover:text-foreground shrink-0"
          disabled={isReconnecting}
          onClick={() => onReconnect(device)}
          title={`${t('common.reconnect')} ${label}`}
        >
          <RefreshCw size={12} className={cn(isTarget && isReconnecting && 'animate-spin')} />
        </Button>
      )}
      {isPlc && !ok && (
        <span className="text-[11px] text-muted-foreground/60 shrink-0">{t('hardware.replugUSB')}</span>
      )}
    </div>
  )
}

// ─── Alarm clear dialog ───────────────────────────────────────────────────────
function AlarmClearDialog({ open, onOpenChange, label, onConfirm, isPending }: {
  open: boolean
  onOpenChange: (v: boolean) => void
  label: string
  onConfirm: () => void
  isPending: boolean
}) {
  const { t } = useTranslation()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="max-w-xs gap-5">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-400">
            <TriangleAlert size={16} className="flex-shrink-0" />
            {t('hardware.alarmDialog.title', { label })}
          </DialogTitle>
          <DialogDescription>{t('hardware.alarmDialog.description')}</DialogDescription>
        </DialogHeader>
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            size="sm"
            className="bg-red-600 hover:bg-red-500 text-white"
            disabled={isPending}
            onClick={() => { onConfirm(); onOpenChange(false) }}
          >
            {isPending ? t('hardware.clearing') : t('hardware.clearAlarm')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─── Clickable alarm badge (click to clear when active + clearable) ───────────
function AlarmBadge({ label, active, urgent, addr, clearAddr, isPending, onClear }: {
  label: string
  active: boolean
  urgent?: boolean
  addr: number
  clearAddr?: number
  isPending: boolean
  onClear?: () => void
}) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const isOrange = !urgent   // Max Stroke badge is orange
  const clickable = active && !!clearAddr

  return (
    <>
      <button
        type="button"
        disabled={!clickable || isPending}
        onClick={() => clickable && setDialogOpen(true)}
        title={`MR${addr} — ${label} — ${active ? 'ALARM' : 'OK'}${clickable ? ' (click to clear)' : ''}`}
        className={cn(
          'inline-flex items-center gap-2 rounded-md border px-3.5 py-1.5 text-sm font-medium select-none transition-all',
          active
            ? isOrange
              ? 'border-orange-500/40 bg-orange-50 text-orange-700 dark:border-orange-600/40 dark:bg-orange-950/50 dark:text-orange-300'
              : 'border-red-500/40 bg-red-50 text-red-700 dark:border-red-600/40 dark:bg-red-950/50 dark:text-red-300'
            : 'border-border bg-muted/30 text-muted-foreground/60',
          clickable && !isPending
            ? 'cursor-pointer hover:ring-1 hover:ring-red-500/60 active:scale-95'
            : 'cursor-default',
        )}
      >
        <span className={cn(
          'w-2 h-2 rounded-full shrink-0',
          active
            ? isOrange ? 'bg-orange-500 animate-pulse' : 'bg-red-500 animate-pulse'
            : 'bg-muted-foreground/30',
        )} />
        <span className="font-mono opacity-50">MR{addr}</span>
        {label}
        {clickable && (
          <span className="ml-0.5 rounded bg-red-500/20 px-1.5 py-0.5 text-xs font-semibold text-red-700 dark:text-red-300 uppercase tracking-wide">
            Reset
          </span>
        )}
      </button>

      {clearAddr && (
        <AlarmClearDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          label={label}
          onConfirm={() => onClear?.()}
          isPending={isPending}
        />
      )}
    </>
  )
}

// ─── Alarms section ───────────────────────────────────────────────────────────
function AlarmsPanel() {
  const { t } = useTranslation()
  const plcBits = useAppStore((s) => s.plcBits)
  const mr811 = useAppStore((s) => s.plcBits[811]?.value ?? false)
  const alarmBits = BIT_META.filter((b) => b.group === 'actuator' && b.dir === 'plc-to-web' && b.urgent)

  const clearM = useMutation({
    mutationFn: (addr: number) => api.hardware.pulseBit(addr, 200),
    onSuccess: (_d, addr) => toast.success(`Clear pulse sent → MR${addr}`),
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <div className="flex flex-wrap gap-1.5">
      <AlarmBadge
        label={t('hardware.maxStroke')}
        active={mr811}
        urgent={false}
        addr={811}
        isPending={false}
      />
      {alarmBits.map((meta) => (
        <AlarmBadge
          key={meta.addr}
          label={t(meta.labelKey as any)}
          active={plcBits[meta.addr]?.value ?? false}
          urgent={meta.urgent}
          addr={meta.addr}
          clearAddr={meta.clearAddr}
          isPending={clearM.isPending}
          onClear={() => clearM.mutate(meta.clearAddr!)}
        />
      ))}
    </div>
  )
}

// ─── Compact signal pill (no MR number visible) ────────────────────────────
function SignalPill({ meta, value, pulsing }: {
  meta: BitMeta
  value: boolean
  pulsing: boolean
}) {
  const { t } = useTranslation()
  const isWebToPlc = meta.dir === 'web-to-plc'
  const isUrgentOn = value && meta.urgent

  return (
    <span
      title={`MR${meta.addr} — ${meta.label} — ${value ? 'ON' : 'OFF'}`}
      className={cn(
        'inline-flex items-center gap-2 rounded-md border px-3.5 py-1.5 text-sm font-medium select-none transition-all',
        value
          ? isUrgentOn
            ? 'border-red-500/40 bg-red-50 text-red-700 dark:border-red-600/40 dark:bg-red-950/50 dark:text-red-300'
            : isWebToPlc
              ? 'border-emerald-500/40 bg-emerald-50 text-emerald-700 dark:border-emerald-600/40 dark:bg-emerald-950/50 dark:text-emerald-300'
              : 'border-amber-500/40 bg-amber-50 text-amber-700 dark:border-amber-600/40 dark:bg-amber-950/50 dark:text-amber-300'
          : 'border-border bg-muted/30 text-muted-foreground/60',
      )}
    >
      <span className={cn(
        'w-2 h-2 rounded-full shrink-0',
        value
          ? isUrgentOn
            ? 'bg-red-500'
            : isWebToPlc
              ? 'bg-emerald-500'
              : 'bg-amber-500'
          : 'bg-muted-foreground/30',
        value && (pulsing || isUrgentOn) && 'animate-pulse',
      )} />
      <span className="font-mono opacity-50">MR{meta.addr}</span>
      {t(meta.labelKey as any)}
    </span>
  )
}

// ─── Signal group (control / operation) ──────────────────────────────────────
function SignalGroup({ group, label }: { group: 'control' | 'operation'; label: string }) {
  const plcBits = useAppStore((s) => s.plcBits)
  const pulsing = usePlcBitPulse()
  const bits = BIT_META.filter((b) => b.group === group)

  return (
    <div className="space-y-2">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">
        {label}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {bits.map((meta) => (
          <SignalPill
            key={meta.addr}
            meta={meta}
            value={plcBits[meta.addr]?.value ?? false}
            pulsing={pulsing.has(meta.addr)}
          />
        ))}
      </div>
    </div>
  )
}

// ─── Clamp sensor panel ───────────────────────────────────────────────────────
function ClampPanel() {
  const { t } = useTranslation()
  const force = useAppStore((s) => s.latestEsp32Force)
  const connected = useAppStore((s) => s.hwStatus.esp32)
  const esp32Unit = useSettingsStore((s) => s.esp32Unit)
  const setClampForceAlarm = useAppStore((s) => s.setClampForceAlarm)
  const clampForceAlarm = useAppStore((s) => s.clampForceAlarm)
  const queryClient = useQueryClient()
  const [limitInput, setLimitInput] = useState<string>('')
  const [limitError, setLimitError] = useState<string>('')
  const [offsetInput, setOffsetInput] = useState<string>('')
  const [offsetError, setOffsetError] = useState<string>('')
  const setClampOffsetGf = useSettingsStore((s) => s.setClampOffsetGf)
  const prevActive = useRef(false)

  const hasValue = force !== null && Number.isFinite(force)
  const atRest = hasValue && Math.abs(force!) < 0.1
  const display = hasValue ? fmtEsp32(force!, esp32Unit) : '—'

  const { data: limitData } = useQuery({
    queryKey: ['esp32-force-limit'],
    queryFn: api.hardware.getForceLimit,
    refetchInterval: 5000,
  })

  const limitM = useMutation({
    mutationFn: (limit_gf: number | null) => api.hardware.setForceLimit(limit_gf),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['esp32-force-limit'] })
      toast.success('Force limit updated')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const { data: offsetData } = useQuery({
    queryKey: ['esp32-clamp-offset'],
    queryFn: api.hardware.getClampOffset,
    refetchInterval: 10000,
  })

  const offsetM = useMutation({
    mutationFn: (offset_gf: number) => api.hardware.setClampOffset(offset_gf),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['esp32-clamp-offset'] })
      setClampOffsetGf(data.offset_gf)
      toast.success('Clamp offset updated')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const tareM = useMutation({
    mutationFn: () => api.hardware.esp32Tare(),
    onSuccess: () => toast.success('Tare sent to ESP32 ("t")'),
    onError: (e: Error) => toast.error(e.message),
  })

  useEffect(() => {
    if (limitData?.limit_gf != null && limitInput === '') {
      const raw = limitData.limit_gf
      setLimitInput(esp32Unit === 'N' ? (raw * N_PER_GF).toFixed(4) : raw.toFixed(1))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [limitData])

  useEffect(() => {
    if (limitData?.active && !prevActive.current) {
      prevActive.current = true
      if (!clampForceAlarm) setClampForceAlarm('Clamp Force Sensor Alarm', limitData.limit_gf)
    } else if (!limitData?.active) {
      prevActive.current = false
    }
  }, [limitData?.active, clampForceAlarm, setClampForceAlarm])

  useEffect(() => {
    if (offsetData != null && offsetInput === '') {
      setOffsetInput(offsetData.offset_gf.toFixed(1))
      setClampOffsetGf(offsetData.offset_gf)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offsetData])

  function handleLimitChange(v: string) {
    setLimitInput(v)
    const parsed = parseFloat(v)
    if (v === '' || Number.isNaN(parsed) || parsed <= 0) {
      setLimitError(v === '' ? '' : 'Must be > 0')
    } else {
      setLimitError('')
    }
  }

  function handleSetLimit() {
    const parsed = parseFloat(limitInput)
    if (limitInput === '') { setLimitError('Enter a value'); return }
    if (Number.isNaN(parsed) || parsed <= 0) { setLimitError('Must be > 0'); return }
    setLimitError('')
    const gf = esp32Unit === 'N' ? parsed / N_PER_GF : parsed
    limitM.mutate(gf)
  }

  function handleOffsetChange(v: string) {
    setOffsetInput(v)
    const parsed = parseFloat(v)
    if (v !== '' && Number.isNaN(parsed)) {
      setOffsetError('Must be a number')
    } else {
      setOffsetError('')
    }
  }

  function handleSetOffset() {
    const parsed = parseFloat(offsetInput)
    if (offsetInput === '') { setOffsetError('Enter a value'); return }
    if (Number.isNaN(parsed)) { setOffsetError('Must be a number'); return }
    setOffsetError('')
    offsetM.mutate(parsed)
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-[400px_1fr_1fr] gap-4 items-center">

      {/* Col 1: Live value row */}
      <div className={cn(
        'flex items-center gap-3 rounded-lg border px-4 py-3 transition-all',
        !connected
          ? 'border-border bg-muted/20'
          : hasValue && atRest
            ? 'border-emerald-500/25 bg-emerald-500/5'
            : 'border-border bg-card',
      )}>
        {/* Status dot */}
        <span className={cn(
          'w-2 h-2 rounded-full shrink-0',
          !connected
            ? 'bg-red-500 animate-pulse'
            : atRest
              ? 'bg-emerald-500 animate-pulse'
              : 'bg-amber-500 animate-pulse',
        )} />

        {/* Value + unit */}
        <span className={cn(
          'font-mono font-bold tabular-nums text-3xl',
          !connected
            ? 'text-muted-foreground/25'
            : hasValue ? 'text-foreground' : 'text-muted-foreground/30',
        )}>
          {display}
        </span>
        <span className="text-sm font-medium text-muted-foreground">{esp32Unit}</span>

        {/* Status label */}
        <span className={cn(
          'text-sm font-semibold',
          !connected
            ? 'text-red-500'
            : atRest
              ? 'text-emerald-600 dark:text-emerald-400'
              : 'text-amber-600 dark:text-amber-400',
        )}>
          {!connected ? t('common.offline') : atRest ? t('hardware.atRest') : t('hardware.nonZero')}
        </span>

        {/* Tare button pushed to the right */}
        <div className="ml-auto flex items-center gap-1.5">
          <span className="font-mono text-xs opacity-40">MR808</span>
          <Button
            variant="outline"
            size="sm"
            className="w-16"
            disabled={!connected || tareM.isPending}
            onClick={() => tareM.mutate()}
          >
            {tareM.isPending ? <RefreshCw size={13} className="animate-spin" /> : t('hardware.tare')}
          </Button>
        </div>
      </div>

      {/* Col 2: Force limit */}
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-muted-foreground shrink-0">
            {t('hardware.forceLimit')}
            <span className="font-mono normal-case tracking-normal opacity-40">MR810</span>
          </span>
          <NumpadInput
            value={limitInput}
            onChange={handleLimitChange}
            decimal={true}
            className={cn('w-24 h-8 text-sm font-mono', limitError && 'border-red-500 focus-visible:ring-red-500')}
            placeholder={`(${esp32Unit})`}
            disabled={limitM.isPending}
          />
          <span className="text-xs text-muted-foreground">{esp32Unit}</span>
          <Button
            size="sm"
            className="h-8"
            disabled={limitM.isPending || !!limitError || !limitInput}
            onClick={handleSetLimit}
          >
            {t('common.set')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8"
            disabled={limitM.isPending || !limitData?.limit_gf}
            onClick={() => { setLimitInput(''); setLimitError(''); limitM.mutate(null) }}
          >
            {t('common.clear')}
          </Button>
          {limitData?.active && (
            <span className="flex items-center gap-1.5 text-xs font-semibold text-red-500 shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
              {t('hardware.limitReached')}
            </span>
          )}
        </div>
        {limitError && <p className="text-xs text-red-500">{limitError}</p>}
      </div>

      {/* Col 3: Clamp offset */}
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground shrink-0">
            {t('hardware.clampOffset')}
          </span>
          <NumpadInput
            value={offsetInput}
            onChange={handleOffsetChange}
            decimal={true}
            negative={true}
            className={cn('w-24 h-8 text-sm font-mono', offsetError && 'border-red-500 focus-visible:ring-red-500')}
            placeholder="(gf)"
            disabled={offsetM.isPending}
          />
          <span className="text-xs text-muted-foreground">gf</span>
          <Button
            size="sm"
            className="h-8"
            disabled={offsetM.isPending || !!offsetError || offsetInput === ''}
            onClick={handleSetOffset}
          >
            {t('common.set')}
          </Button>
        </div>
        {offsetError && <p className="text-xs text-red-500">{offsetError}</p>}
      </div>

    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function Hardware() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const { data: status } = useQuery({
    queryKey: ['hw-status'],
    queryFn: api.hardware.status,
    refetchInterval: 3000,
  })

  const reconnectM = useMutation({
    mutationFn: (device: Device) => api.hardware.reconnect(device),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['hw-status'] }),
    onError: (e: Error) => toast.error(e.message),
  })

  const hw = status as HardwareStatus | undefined

  return (
    <div className="flex flex-col gap-3 w-full h-full overflow-auto">

      {/* ── Device status ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {(['plc', 'imada', 'esp32'] as Device[]).map((dev) => (
          <DeviceRow
            key={dev}
            device={dev}
            ok={hw?.[dev] ?? false}
            onReconnect={(d) => reconnectM.mutate(d)}
            isReconnecting={reconnectM.isPending}
            isTarget={reconnectM.isPending && reconnectM.variables === dev}
          />
        ))}
      </div>

      {/* ── Alarms: full width ────────────────────────────────────────────── */}
      <Card
        title={t('hardware.alarms')}
        headerRight={
          <InfoButton
            title={t('hardware.info.alarmsTitle')}
            body={t('hardware.info.alarmsBody')}
          />
        }
      >
        <AlarmsPanel />
      </Card>

      {/* ── PLC Signals ───────────────────────────────────────────────────── */}
      <Card
        title={t('hardware.plcSignals')}
        headerRight={
          <InfoButton
            title={t('hardware.info.plcSignalsTitle')}
            body={t('hardware.info.plcSignalsBody')}
          />
        }
      >
        <div className="space-y-4">
          <SignalGroup group="control" label={t('hardware.control')} />
          <SignalGroup group="operation" label={t('hardware.operation')} />
        </div>
      </Card>

      {/* ── Clamp Sensor ──────────────────────────────────────────────────── */}
      <Card
        title={t('hardware.clampSensor')}
        headerRight={
          <InfoButton
            title={t('hardware.info.clampSensorTitle')}
            body={t('hardware.info.clampSensorBody')}
          />
        }
      >
        <ClampPanel />
      </Card>
    </div>
  )
}
