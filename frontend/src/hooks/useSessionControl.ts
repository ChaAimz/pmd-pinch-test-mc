import { useMutation } from '@tanstack/react-query'
import { useAppStore } from '@/store/app'
import { useChartStore } from '@/store/chart'
import { getWsClient } from '@/lib/ws'
import { api } from '@/lib/api'

export function useSessionControl() {
  const machineState = useAppStore((s) => s.machineState)
  const currentRunId = useAppStore((s) => s.currentRunId)
  const isRunning = !['IDLE', 'ABORTED', 'ERROR', 'DONE_B7'].includes(machineState)

  const startM = useMutation({
    mutationFn: (recipeId: number) => api.sessions.start(recipeId),
    onMutate: () => {
      useChartStore.getState().clear()
      useAppStore.getState().resetRun()
      getWsClient()
    },
  })

  const stopM = useMutation({ mutationFn: (runId: number) => api.sessions.stop(runId) })

  return {
    isRunning,
    machineState,
    start: (recipeId: number) => startM.mutate(recipeId),
    stop: () => { if (currentRunId != null) stopM.mutate(currentRunId) },
    isStarting: startM.isPending,
    isStopping: stopM.isPending,
    startError: startM.error,
  }
}
