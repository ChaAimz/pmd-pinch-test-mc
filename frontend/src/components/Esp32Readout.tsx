import { useEffect, useRef, useState } from 'react'
import { Grip } from 'lucide-react'
import { useMutation } from '@tanstack/react-query'
import { useAppStore } from '@/store/app'
import { useSettingsStore } from '@/store/settings'
import { cn } from '@/lib/utils'
import { Progress } from '@/components/ui/progress'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'

const TARE_FLASH_MS = 2000

// Raw data from firmware is in Newtons. 1 N = 101.97162 gf.
const GF_PER_N = 101.97162129779283

function fmtEsp32(n: number, unit: 'gf' | 'N') {
  return unit === 'gf' ? (n * GF_PER_N).toFixed(1) : n.toFixed(4)
}

const CLAMP_STATES = new Set(['CLAMP_PRESSED', 'WAIT_CLAMP_FORCE'])

interface Props {
  threshold?: number | null
}

export function Esp32Readout({ threshold }: Props) {
  const force = useAppStore((s) => s.latestEsp32Force)
  const connected = useAppStore((s) => s.hwStatus.esp32)
  const state = useAppStore((s) => s.machineState)
  const esp32Unit = useSettingsStore((s) => s.esp32Unit)
  const tareBit = useAppStore((s) => s.plcBits[808])

  const lastUpdateRef = useRef<number>(0)
  const [staleMs, setStaleMs] = useState<number>(0)
  const [showTare, setShowTare] = useState(false)
  const tareTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (force !== null) {
      lastUpdateRef.current = Date.now()
      setStaleMs(0)
    }
  }, [force])

  useEffect(() => {
    const id = setInterval(() => {
      if (lastUpdateRef.current > 0) {
        setStaleMs(Date.now() - lastUpdateRef.current)
      }
    }, 1000)
    return () => clearInterval(id)
  }, [])

  // Flash tare badge when MR808 goes HIGH (polled from PLC)
  useEffect(() => {
    if (!tareBit?.value) return
    setShowTare(true)
    if (tareTimerRef.current) clearTimeout(tareTimerRef.current)
    tareTimerRef.current = setTimeout(() => setShowTare(false), TARE_FLASH_MS)
  }, [tareBit?.value, tareBit?.ts])

  const tareM = useMutation({
    mutationFn: api.hardware.esp32Tare,
    onSuccess: () => {
      setShowTare(true)
      if (tareTimerRef.current) clearTimeout(tareTimerRef.current)
      tareTimerRef.current = setTimeout(() => setShowTare(false), TARE_FLASH_MS)
    },
  })

  const hasValue = force !== null && Number.isFinite(force)
  const display = hasValue ? fmtEsp32(force!, esp32Unit) : '— — —'
  const isLive = lastUpdateRef.current > 0 && staleMs < 3000
  const isStale = lastUpdateRef.current > 0 && staleMs >= 3000

  const isClampMode = CLAMP_STATES.has(state) && !!threshold && threshold > 0
  const clampPct = isClampMode ? Math.min(100, Math.max(0, ((force ?? 0) / threshold!) * 100)) : 0
  const clampReached = isClampMode && (force ?? 0) >= threshold!

  return (
    <div className="flex items-center gap-4 px-5 py-3 bg-card border border-border rounded-xl flex-1">
      <div className={cn(
        'flex items-center justify-center w-9 h-9 rounded-lg shrink-0',
        connected
          ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
          : 'bg-muted text-muted-foreground'
      )}>
        <Grip size={18} />
      </div>
      <div className="flex flex-col">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-bold">
            Clamp Force
          </span>
          {showTare && (
            <span className="text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30 animate-pulse">
              TARE
            </span>
          )}
        </div>
        <span className="text-xs text-muted-foreground/80">ESP32 — live</span>
      </div>
      {isClampMode ? (
        <div className="ml-auto flex flex-col gap-1 flex-1 min-w-0 max-w-[200px]">
          <div className="flex items-baseline justify-between text-xs">
            <span className={cn('font-semibold', clampReached ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400')}>
              {clampReached ? 'Threshold Reached' : 'Clamping…'}
            </span>
            <span className="font-mono tabular-nums">
              <span className={cn('font-bold', clampReached ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-300')}>
                {fmtEsp32(force ?? 0, esp32Unit)}
              </span>
              <span className="text-muted-foreground">
                {' '}/ {esp32Unit === 'gf' ? (threshold! * GF_PER_N).toFixed(1) : threshold!.toFixed(4)} {esp32Unit}
              </span>
            </span>
          </div>
          <Progress
            value={clampPct}
            className={cn(
              '[&_[data-slot=progress-track]]:h-2.5',
              '[&_[data-slot=progress-track]]:bg-amber-100 dark:[&_[data-slot=progress-track]]:bg-amber-900/40',
              clampReached
                ? '[&_[data-slot=progress-indicator]]:bg-green-500'
                : '[&_[data-slot=progress-indicator]]:bg-amber-500',
            )}
          />
        </div>
      ) : (
        <div className="ml-auto flex items-end gap-3">
          <div className="flex flex-col items-end gap-0.5">
            <div className="flex items-baseline gap-2">
              <span className={cn(
                'text-5xl font-mono font-bold tabular-nums leading-none',
                !connected ? 'text-muted-foreground/40'
                  : hasValue ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground/60'
              )}>
                {display}
              </span>
              <span className="text-lg text-muted-foreground font-semibold">{esp32Unit}</span>
            </div>
            {isLive && (
              <span className="text-[10px] text-emerald-500 font-semibold flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse inline-block" />
                live
              </span>
            )}
            {isStale && (
              <span className="text-[10px] text-amber-500 font-semibold">
                stale {Math.round(staleMs / 1000)}s ago
              </span>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={!connected || tareM.isPending}
            onClick={() => tareM.mutate()}
            className="h-7 text-xs px-2.5"
          >
            Tare
          </Button>
        </div>
      )}
      {!connected && (
        <span className="text-xs font-semibold text-amber-600 dark:text-amber-400 uppercase tracking-wider">
          offline
        </span>
      )}
    </div>
  )
}
