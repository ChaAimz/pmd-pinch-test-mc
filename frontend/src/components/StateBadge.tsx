import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

const COLORS: Record<string, string> = {
  IDLE:             'bg-emerald-600 text-white',       // machine at rest + ready
  IDLE_NOT_READY:   'bg-slate-500 text-white',         // waiting for MR303
  WRITE_PLC_PARAMS: 'bg-blue-600 text-white',
  LOOP_BEGIN:       'bg-blue-700 text-white',
  CLAMP_PRESSED:    'bg-amber-500 text-white',
  WAIT_CLAMP_FORCE: 'bg-amber-600 text-white',
  WAIT_B5:          'bg-orange-500 text-white',
  TENSION_CHECK:    'bg-violet-600 text-white',
  EVALUATE:         'bg-indigo-600 text-white',
  UNCLAMP:          'bg-teal-600 text-white',
  DONE_B7:          'bg-green-600 text-white',
  ABORTED:          'bg-orange-700 text-white',
  ERROR:            'bg-red-600 text-white',
}

const DISPLAY_LABEL: Record<string, string> = {
  IDLE:             'Ready',
  IDLE_NOT_READY:   'Not Ready',
  WRITE_PLC_PARAMS: 'Setting up',
  LOOP_BEGIN:       'Loop start',
  CLAMP_PRESSED:    'Clamping',
  WAIT_CLAMP_FORCE: 'Waiting force',
  WAIT_B5:          'Awaiting tension',
  TENSION_CHECK:    'Tension test',
  EVALUATE:         'Evaluating',
  UNCLAMP:          'Unclamping',
  DONE_B7:          'Done',
  ABORTED:          'Aborted',
  ERROR:            'Error',
}

export function StateBadge({ state, machineReady }: { state: string; machineReady?: boolean }) {
  // When idle, reflect MR303: green "Ready" vs slate "Not Ready"
  const effectiveState = state === 'IDLE' && machineReady === false ? 'IDLE_NOT_READY' : state
  return (
    <Badge
      key={effectiveState}
      className={cn(
        'font-mono text-base px-4 py-4 animate-pop transition-colors duration-300',
        COLORS[effectiveState] ?? 'bg-slate-500 text-white',
      )}
      title={effectiveState === 'IDLE_NOT_READY' ? 'MR303 OFF — machine not ready' : undefined}
    >
      {DISPLAY_LABEL[effectiveState] ?? state}
    </Badge>
  )
}
