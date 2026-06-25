import { cn } from '@/lib/utils'
import { Progress } from '@/components/ui/progress'
import { useAppStore } from '@/store/app'

const CLAMP_STATES = new Set(['CLAMP_PRESSED', 'WAIT_CLAMP_FORCE'])

interface Props {
  threshold: number | null  // recipe.clamp_threshold_n
}

export function ClampProgress({ threshold }: Props) {
  const state = useAppStore((s) => s.machineState)
  const force = useAppStore((s) => s.latestEsp32Force)

  if (!CLAMP_STATES.has(state) || !threshold || threshold <= 0) return null

  const value = force ?? 0
  const pct = Math.min(100, Math.max(0, (value / threshold) * 100))
  const reached = value >= threshold

  return (
    <div className="bg-amber-50 dark:bg-amber-950/30 border-2 border-amber-300 dark:border-amber-700 rounded-xl p-4 shadow-sm">
      <div className="flex items-baseline justify-between mb-2">
        <span className="text-sm font-bold text-amber-800 dark:text-amber-200 uppercase tracking-wider">
          {reached ? 'Clamp Threshold Reached' : 'Clamping…'}
        </span>
        <span className="font-mono text-xl tabular-nums">
          <span className={cn('font-bold', reached ? 'text-green-700 dark:text-green-400' : 'text-amber-700 dark:text-amber-300')}>
            {value.toFixed(1)}
          </span>
          <span className="text-slate-400"> / {threshold.toFixed(1)} N</span>
        </span>
      </div>
      <Progress
        value={pct}
        className={cn(
          'block',
          '[&_[data-slot=progress-track]]:h-3',
          '[&_[data-slot=progress-track]]:bg-amber-100',
          'dark:[&_[data-slot=progress-track]]:bg-amber-900/40',
          reached
            ? '[&_[data-slot=progress-indicator]]:bg-green-500'
            : '[&_[data-slot=progress-indicator]]:bg-amber-500',
        )}
      />
    </div>
  )
}
