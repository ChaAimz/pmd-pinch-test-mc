import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

const COLORS: Record<string, string> = {
  IDLE: 'bg-slate-200 text-slate-700',
  WRITE_PLC_PARAMS: 'bg-blue-100 text-blue-800',
  LOOP_BEGIN: 'bg-blue-200 text-blue-900',
  CLAMP_PRESSED: 'bg-amber-200 text-amber-900',
  WAIT_CLAMP_FORCE: 'bg-amber-300 text-amber-900',
  WAIT_B5: 'bg-purple-200 text-purple-900',
  TENSION_CHECK: 'bg-purple-300 text-purple-900',
  EVALUATE: 'bg-indigo-200 text-indigo-900',
  UNCLAMP: 'bg-teal-200 text-teal-900',
  DONE_B7: 'bg-green-200 text-green-900',
  ABORTED: 'bg-red-100 text-red-800',
  ERROR: 'bg-red-300 text-red-900',
}

export function StateBadge({ state }: { state: string }) {
  return (
    <Badge className={cn('font-mono text-base px-4 py-1.5', COLORS[state] ?? 'bg-slate-200 text-slate-700')}>
      {state}
    </Badge>
  )
}
