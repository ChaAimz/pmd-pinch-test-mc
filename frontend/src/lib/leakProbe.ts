// DEV-ONLY heap/leak probe. Installed from main.tsx behind `import.meta.env.DEV`,
// so it is tree-shaken out of production builds entirely.
//
// Exposes `window.__leak` for two consumers:
//   1. The CDP driver (scratchpad/leak-driver.mjs) which launches headless Edge,
//      drives a run, forces GC each sample and watches post-GC heap per loop.
//   2. Manual use in DevTools: `__leak.start(2)`, `__leak.stats()`, `__leak.stop()`.
//
// `start()` replicates useSessionControl.startM (onMutate + mutationFn) EXACTLY, so the
// store path is identical to clicking the Start button — then the real WS pipeline drives
// the chart. That makes any heap growth the probe observes faithful to real operation.
import * as echarts from 'echarts'
import type { QueryClient } from '@tanstack/react-query'
import { useChartStore } from '@/store/chart'
import { useAppStore } from '@/store/app'
import { useSettingsStore } from '@/store/settings'
import { api } from '@/lib/api'
import type { Recipe } from '@/lib/types'

type LeakApi = ReturnType<typeof build>

declare global {
  interface Window {
    __leak?: LeakApi
    gc?: () => void
  }
}

function build(qc: QueryClient) {
  async function getRecipe(recipeId: number): Promise<Recipe | undefined> {
    const cached = qc.getQueryData<Recipe[]>(['recipes'])
    const hit = cached?.find((r) => r.id === recipeId)
    if (hit) return hit
    const list = await api.recipes.list()
    return list.find((r) => r.id === recipeId)
  }

  return {
    async start(recipeId = 2, modeOverride?: 'gated' | 'continuous') {
      const recipe = await getRecipe(recipeId)
      if (!recipe) throw new Error(`recipe ${recipeId} not found`)
      // Mirror useSessionControl.computeBufferSize() + onMutate().
      const mode = modeOverride ?? useSettingsStore.getState().chartMode
      const perWindow = recipe.sampling_hz * 60
      const size = mode === 'gated' ? perWindow : recipe.loop_count * perWindow
      useChartStore.getState().resizeBuffer(size)
      // Mirror onMutate: gated waits for MR805 before recording; continuous records now.
      useChartStore.getState().setRecording(mode !== 'gated')
      useAppStore.getState().resetRun()
      qc.removeQueries({ queryKey: ['waveform'] })
      const res = await api.sessions.start(recipeId)
      return { ...res, mode, bufferSize: useChartStore.getState().maxSamples }
    },

    async stop() {
      const runId = useAppStore.getState().currentRunId
      if (runId != null) {
        try { await api.sessions.stop(runId) } catch { /* already stopped */ }
      }
      useChartStore.getState().setRecording(false)
      return { stopped: runId }
    },

    gc() {
      try { window.gc?.() } catch { /* --js-flags=--expose-gc not set */ }
    },

    stats() {
      const cs = useChartStore.getState()
      const as = useAppStore.getState()

      // ECharts internal series length — does the renderer's DataStore grow per loop?
      let echartsLen = -1
      try {
        const el = document.querySelector('[_echarts_instance_]')
        const inst = el ? echarts.getInstanceByDom(el as HTMLElement) : null
        const opt = inst?.getOption() as { series?: Array<{ data?: unknown[] }> } | undefined
        echartsLen = opt?.series?.[0]?.data?.length ?? -1
      } catch { /* ignore */ }

      // React Query cache — per-loop waveform queries are the prime retention suspect.
      const all = qc.getQueryCache().getAll()
      let rqWaveformQ = 0
      let rqWaveformPts = 0
      for (const q of all) {
        if (Array.isArray(q.queryKey) && q.queryKey[0] === 'waveform') {
          rqWaveformQ++
          const d = q.state.data as unknown[] | undefined
          if (Array.isArray(d)) rqWaveformPts += d.length
        }
      }

      const mem = (performance as unknown as {
        memory?: { usedJSHeapSize: number; totalJSHeapSize: number }
      }).memory

      // performance 'measure' buffer — the React dev-build leak. Bounded once the
      // clearMeasures() guard in main.tsx is active.
      let perfMeasures = -1
      try { perfMeasures = performance.getEntriesByType('measure').length } catch { /* ignore */ }

      return {
        t: Date.now(),
        perfMeasures,
        heapUsedMB: mem ? +(mem.usedJSHeapSize / 1048576).toFixed(2) : null,
        heapTotalMB: mem ? +(mem.totalJSHeapSize / 1048576).toFixed(2) : null,
        machineState: as.machineState,
        currentLoop: as.currentLoop,
        loopResults: as.loopResults.length,
        recording: cs.recording,
        imadaCount: cs.imada.count,
        imadaHead: cs.imada.head,
        maxSamples: cs.maxSamples,
        rqTotalQ: all.length,
        rqWaveformQ,
        rqWaveformPts,
        echartsLen,
      }
    },
  }
}

export function installLeakProbe(qc: QueryClient) {
  window.__leak = build(qc)
  // eslint-disable-next-line no-console
  console.log('[leak] probe installed — __leak.start(2) / __leak.stats() / __leak.stop()')
}
