import React, { useEffect, useRef, useState } from 'react'
import { Clock as ClockIcon, PlugZap, Power, Unplug } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/store/app'
import { cn } from '@/lib/utils'
import { getWsClient } from '@/lib/ws'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'

function Dot({ ok }: { ok: boolean }) {
  return (
    <span
      className={cn(
        'relative inline-block w-2 h-2 rounded-full shrink-0',
        ok ? 'bg-emerald-500' : 'bg-zinc-400 dark:bg-zinc-600',
      )}
    >
      {ok && (
        <span className="absolute inset-0 rounded-full bg-emerald-500/50 animate-ping" />
      )}
    </span>
  )
}

function DevicePopover({
  label,
  ok,
  children,
}: {
  label: string
  ok: boolean
  children: React.ReactNode
}) {
  const { t } = useTranslation()
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className={cn(
            'flex items-center gap-2 rounded-md px-1.5 py-1',
            'hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors duration-150',
          )}
          title={`${label} — ${ok ? t('common.online') : t('common.offline')}`}
        >
          <Dot ok={ok} />
          <span
            className={cn(
              'text-xs font-semibold uppercase tracking-wider',
              ok ? 'text-zinc-700 dark:text-zinc-200' : 'text-zinc-400 dark:text-zinc-600',
            )}
          >
            {label}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-0">
        {children}
      </PopoverContent>
    </Popover>
  )
}

function PopoverHeader({ label, ok }: { label: string; ok: boolean }) {
  const { t } = useTranslation()
  return (
    <div className="px-4 py-3 border-b border-border flex items-center gap-2.5">
      <Dot ok={ok} />
      <span className="text-sm font-semibold">{label}</span>
      <span className={cn(
        'ml-auto text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded',
        ok
          ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
          : 'bg-zinc-400/20 text-zinc-500 dark:text-zinc-500',
      )}>
        {ok ? t('common.online') : t('common.offline')}
      </span>
    </div>
  )
}

type TFunction = (key: string) => string

function getPlcBits(t: TFunction) {
  return [
    { addr: 803, label: t('topbar.bits.pressClamp'),    dir: '←' },
    { addr: 805, label: t('topbar.bits.startTension'),  dir: '←' },
    { addr: 806, label: t('topbar.bits.endTension'),    dir: '←' },
    { addr: 807, label: t('topbar.bits.finish'),        dir: '←' },
    { addr: 811, label: t('topbar.bits.maxStroke'),     dir: '←' },
    { addr: 812, label: t('topbar.bits.tareImada'),     dir: '←' },
    { addr: 800, label: t('topbar.bits.startSession'),  dir: '→' },
    { addr: 801, label: t('topbar.bits.stopEstop'),     dir: '→' },
    { addr: 804, label: t('topbar.bits.stopClamp'),     dir: '→' },
  ]
}

function PlcDetails({ ok }: { ok: boolean }) {
  const { t } = useTranslation()
  const plcBits = useAppStore((s) => s.plcBits)
  const plcBitsList = getPlcBits(t)
  return (
    <>
      <PopoverHeader label="PLC (KV-3000)" ok={ok} />
      <div className="px-4 py-3 space-y-1">
        {plcBitsList.map(({ addr, label, dir }) => {
          const bit = plcBits[addr]
          const on = bit?.value ?? false
          return (
            <div key={addr} className="flex items-center gap-2 text-xs">
              <span className={cn(
                'w-2 h-2 rounded-full shrink-0',
                on ? 'bg-emerald-500' : 'bg-zinc-300 dark:bg-zinc-700',
              )} />
              <span className="flex-1 text-foreground">{label}</span>
              <span className="text-[10px] text-muted-foreground font-mono">{dir} MR{addr}</span>
              <span className={cn(
                'w-6 text-right font-mono font-semibold',
                on ? 'text-emerald-500' : 'text-zinc-400 dark:text-zinc-600',
              )}>
                {on ? '1' : '0'}
              </span>
            </div>
          )
        })}
      </div>
    </>
  )
}

function ImadaDetails({ ok }: { ok: boolean }) {
  const { t } = useTranslation()
  const force = useAppStore((s) => s.latestImadaForce)
  return (
    <>
      <PopoverHeader label="Imada Force Gauge" ok={ok} />
      <dl className="px-4 py-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-xs">
        <dt className="text-muted-foreground font-medium">{t('topbar.devices.port')}</dt>
        <dd className="font-mono text-foreground">COM4</dd>
        <dt className="text-muted-foreground font-medium">{t('topbar.devices.protocol')}</dt>
        <dd className="font-mono text-foreground">RS-232  Remote/D-poll</dd>
        <dt className="text-muted-foreground font-medium">{t('topbar.devices.latestForce')}</dt>
        <dd className="font-mono text-foreground font-semibold">
          {force != null ? `${force.toFixed(3)} N` : <span className="text-muted-foreground">—</span>}
        </dd>
      </dl>
    </>
  )
}

function Esp32Details({ ok }: { ok: boolean }) {
  const { t } = useTranslation()
  const force = useAppStore((s) => s.latestEsp32Force)
  return (
    <>
      <PopoverHeader label="ESP32 Clamp Sensor" ok={ok} />
      <dl className="px-4 py-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-xs">
        <dt className="text-muted-foreground font-medium">{t('topbar.devices.port')}</dt>
        <dd className="font-mono text-foreground">COM5</dd>
        <dt className="text-muted-foreground font-medium">{t('topbar.devices.protocol')}</dt>
        <dd className="font-mono text-foreground">RS-232  Continuous</dd>
        <dt className="text-muted-foreground font-medium">{t('topbar.devices.latestForce')}</dt>
        <dd className="font-mono text-foreground font-semibold">
          {force != null ? `${force.toFixed(0)} gf` : <span className="text-muted-foreground">—</span>}
        </dd>
      </dl>
    </>
  )
}

function Clock() {
  const [time, setTime] = useState(() => new Date())

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  return (
    <div className="flex items-center gap-2.5">
      <ClockIcon size={15} className="text-zinc-400 dark:text-zinc-500 shrink-0" />
      <time className="font-mono text-sm font-semibold tabular-nums tracking-[0.18em] text-zinc-800 dark:text-zinc-100">
        {time.toLocaleTimeString('en-GB', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        })}
      </time>
    </div>
  )
}

function getWsReadyLabel(t: TFunction, readyState: number): string {
  const map: Record<number, string> = {
    0: t('topbar.ws.connecting'),
    1: t('topbar.ws.open'),
    2: t('topbar.ws.closing'),
    3: t('topbar.ws.closed'),
  }
  return map[readyState] ?? t('topbar.ws.unknown')
}

function WsStatusPopover() {
  const { t } = useTranslation()
  const wsConnected = useAppStore((s) => s.wsConnected)
  const [open, setOpen] = useState(false)
  const [stats, setStats] = useState(() => getWsClient().getStats())
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!open) {
      if (intervalRef.current) clearInterval(intervalRef.current)
      return
    }
    setStats(getWsClient().getStats())
    intervalRef.current = setInterval(() => setStats(getWsClient().getStats()), 1_000)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [open])

  const endpoint = (() => {
    const raw = stats.url
    if (raw.startsWith('ws')) return raw
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${proto}//${window.location.host}${raw}`
  })()

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            'flex items-center justify-center w-7 h-7 rounded-md',
            'hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors duration-150',
          )}
          title={t('topbar.ws.statusTitle')}
        >
          {wsConnected ? (
            <PlugZap size={16} className="text-emerald-500" />
          ) : (
            <Unplug size={16} className="text-rose-500 animate-pulse" />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-0">
        <div className="px-4 py-3 border-b border-border flex items-center gap-2">
          {wsConnected ? (
            <PlugZap size={14} className="text-emerald-500 shrink-0" />
          ) : (
            <Unplug size={14} className="text-rose-500 shrink-0" />
          )}
          <span className="text-sm font-semibold">
            {t('topbar.ws.label')} {wsConnected ? t('common.online') : t('common.offline')}
          </span>
        </div>
        <dl className="px-4 py-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-xs">
          <dt className="text-muted-foreground font-medium">{t('topbar.ws.endpoint')}</dt>
          <dd className="font-mono truncate text-foreground" title={endpoint}>{endpoint}</dd>

          <dt className="text-muted-foreground font-medium">{t('topbar.ws.state')}</dt>
          <dd>
            <span className={cn(
              'inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide',
              stats.readyState === 1
                ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                : stats.readyState === 0
                  ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                  : 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
            )}>
              {getWsReadyLabel(t, stats.readyState)}
            </span>
          </dd>

          <dt className="text-muted-foreground font-medium">{t('topbar.ws.reconnects')}</dt>
          <dd className={cn('font-mono', stats.attempts > 0 && 'text-amber-500')}>
            {stats.attempts}
          </dd>
        </dl>
      </PopoverContent>
    </Popover>
  )
}

function ShutdownButton() {
  const { t } = useTranslation()
  const [shutting, setShutting] = useState(false)

  function handleShutdown() {
    setShutting(true)
    fetch('/api/system/shutdown', { method: 'POST' }).catch(() => {})
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <button
          disabled={shutting}
          title={t('topbar.shutdown')}
          className={cn(
            'flex items-center justify-center w-8 h-8 rounded-lg',
            'text-rose-500 hover:bg-rose-500/15',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            'transition-colors duration-150',
          )}
        >
          <Power size={14} strokeWidth={2.5} />
        </button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('topbar.shutdownDialog.title')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('topbar.shutdownDialog.description')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
          <button
            onClick={handleShutdown}
            className="inline-flex h-8 items-center justify-center rounded-lg bg-rose-600 px-3 text-sm font-medium text-white hover:bg-rose-700 transition-colors"
          >
            {t('topbar.shutdownDialog.confirm')}
          </button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export function TopBar() {
  const hwStatus = useAppStore((s) => s.hwStatus)

  return (
    <header
      className={cn(
        'h-14 shrink-0 flex items-center justify-between px-6 border-b',
        'bg-zinc-50/80 backdrop-blur-sm border-zinc-300',
        'dark:bg-zinc-950/80 dark:border-zinc-700',
      )}
    >
      <Clock />

      <div className="flex items-center gap-6">
        <DevicePopover label="PLC" ok={hwStatus.plc}>
          <PlcDetails ok={hwStatus.plc} />
        </DevicePopover>
        <DevicePopover label="Imada" ok={hwStatus.imada}>
          <ImadaDetails ok={hwStatus.imada} />
        </DevicePopover>
        <DevicePopover label="ESP32" ok={hwStatus.esp32}>
          <Esp32Details ok={hwStatus.esp32} />
        </DevicePopover>
        <span className="h-4 w-px bg-zinc-400 dark:bg-zinc-600" />
        <WsStatusPopover />
        <span className="h-4 w-px bg-zinc-400 dark:bg-zinc-600" />
        <ShutdownButton />
      </div>
    </header>
  )
}
