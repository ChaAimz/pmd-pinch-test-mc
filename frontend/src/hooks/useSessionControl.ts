import { useMutation } from '@tanstack/react-query'
import { useAppStore } from '@/store/app'
import { useChartStore, DEFAULT_MAX_SAMPLES } from '@/store/chart'
import { useSettingsStore } from '@/store/settings'
import { getWsClient } from '@/lib/ws'
import { api } from '@/lib/api'
import type { Recipe } from '@/lib/types'

interface StartArgs { recipeId: number; recipe?: Recipe }

// Generous upper bound on a single recording window (one loop / one tension check).
// Over-allocating a little is cheaper than truncating the live plot.
const SECONDS_PER_WINDOW = 60

// Live-chart buffer size, sized to the run and the active chart mode:
//   gated      → chart clears on each MR805, so it only ever holds ONE tension-check
//                window. Independent of loop_count (100 loops needs the same buffer as 1).
//   continuous → plots the whole run end-to-end, so it must hold every loop.
// clampBufferSize() in the store caps the result (very long / high-Hz runs wrap the ring).
function computeBufferSize(recipe?: Recipe): number {
  if (!recipe) return DEFAULT_MAX_SAMPLES
  const perWindow = recipe.sampling_hz * SECONDS_PER_WINDOW
  const mode = useSettingsStore.getState().chartMode
  return mode === 'gated' ? perWindow : recipe.loop_count * perWindow
}

export function useSessionControl() {
  const machineState = useAppStore((s) => s.machineState)
  const currentRunId = useAppStore((s) => s.currentRunId)
  const isRunning = !['IDLE', 'ABORTED', 'ERROR', 'DONE_B7'].includes(machineState)

  const startM = useMutation({
    mutationFn: ({ recipeId }: StartArgs) => api.sessions.start(recipeId),
    onMutate: ({ recipe }: StartArgs) => {
      useChartStore.getState().resizeBuffer(computeBufferSize(recipe))  // also resets counts + recording
      useAppStore.getState().resetRun()
      getWsClient()
    },
  })

  const stopM = useMutation({ mutationFn: (runId: number) => api.sessions.stop(runId) })

  return {
    isRunning,
    machineState,
    start: (recipeId: number, recipe?: Recipe) => startM.mutate({ recipeId, recipe }),
    stop: () => { if (currentRunId != null) stopM.mutate(currentRunId) },
    isStarting: startM.isPending,
    isStopping: stopM.isPending,
    startError: startM.error,
  }
}
