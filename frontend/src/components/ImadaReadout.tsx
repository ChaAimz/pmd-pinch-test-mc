import { useEffect, useRef, useState } from 'react'
import { Activity, RefreshCw } from 'lucide-react'
import { useMutation } from '@tanstack/react-query'
import { useAppStore } from '@/store/app'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'

const TARE_FLASH_MS = 2000

export function ImadaReadout() {
  const force = useAppStore((s) => s.latestImadaForce)
  const connected = useAppStore((s) => s.hwStatus.imada)

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

  const tareM = useMutation({
    mutationFn: api.hardware.imadaTare,
    onSuccess: () => {
      setShowTare(true)
      if (tareTimerRef.current) clearTimeout(tareTimerRef.current)
      tareTimerRef.current = setTimeout(() => setShowTare(false), TARE_FLASH_MS)
    },
  })

  const hasValue = force !== null && Number.isFinite(force)
  const display = hasValue ? force!.toFixed(3) : '— — —'
  const isLive = lastUpdateRef.current > 0 && staleMs < 3000
  const isStale = lastUpdateRef.current > 0 && staleMs >= 3000

  return (
    <div className="flex items-center gap-4 px-5 py-3 bg-card border border-border rounded-xl flex-1">
      <div className={cn(
        'flex items-center justify-center w-9 h-9 rounded-lg shrink-0',
        connected
          ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
          : 'bg-muted text-muted-foreground'
      )}>
        <Activity size={18} />
      </div>
      <div className="flex flex-col">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-bold">
            Force Gauge
          </span>
          {showTare && (
            <span className="text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30 animate-pulse">
              TARE
            </span>
          )}
        </div>
        <span className="text-xs text-muted-foreground/80">Imada — live</span>
      </div>
      <div className="ml-auto flex items-end gap-3">
        <div className="flex flex-col items-end gap-0.5">
          <div className="flex items-baseline gap-2">
            <span className={cn(
              'text-5xl font-mono font-bold tabular-nums leading-none',
              !connected ? 'text-muted-foreground/40'
                : hasValue ? 'text-blue-600 dark:text-blue-400' : 'text-muted-foreground/60'
            )}>
              {display}
            </span>
            <span className="text-lg text-muted-foreground font-semibold">N</span>
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
          {tareM.isPending ? <RefreshCw size={12} className="animate-spin" /> : 'Tare'}
        </Button>
      </div>
      {!connected && (
        <span className="text-xs font-semibold text-amber-600 dark:text-amber-400 uppercase tracking-wider">
          offline
        </span>
      )}
    </div>
  )
}
