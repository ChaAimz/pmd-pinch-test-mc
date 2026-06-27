import { useState, useEffect, useMemo } from 'react'
import { Pencil, Loader2, Play, Square, RotateCcw, ChevronsUpDown, Check, AlertTriangle, Download, Radio, Activity, Grip, Ruler, Zap, Repeat, Keyboard } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueries, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { StateBadge } from '@/components/StateBadge'
import { WaveformChart } from '@/components/WaveformChart'
import { MaxCycleChart } from '@/components/MaxCycleChart'
import { ImadaReadout } from '@/components/ImadaReadout'
import { Esp32Readout } from '@/components/Esp32Readout'
import { useChartStore } from '@/store/chart'
import { useAppStore } from '@/store/app'
import { useSettingsStore } from '@/store/settings'
import { useSessionControl } from '@/hooks/useSessionControl'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import type { Recipe, WaveformPoint } from '@/lib/types'
import { dropPreRoll, activeEndIdx, decimate } from '@/lib/waveform'
import { RecipeForm } from './RecipeForm'
import { KeyboardSheet } from '@/components/ui/keyboard-input'

const GF_PER_N = 101.97162129779283
// Points kept per cycle in the stitched "All cycles" view. Each cycle occupies ~1/N of
// the chart width, so a few hundred peak-preserving points per cycle is visually lossless
// while keeping the stitched array bounded no matter how many cycles ran.
const PER_LOOP_MAX_POINTS = 300
function fmtClamp(n: number, unit: 'gf' | 'N') {
  return unit === 'gf' ? (n * GF_PER_N).toFixed(1) : n.toFixed(4)
}

function downloadCsvBlob(rows: string[], filename: string) {
  const blob = new Blob([rows.join('\n')], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function exportLiveImadaCsv() {
  const state = useChartStore.getState()
  const { timestamps, force, count, head } = state.imada
  const { maxSamples } = state
  if (count === 0) return
  const start = count < maxSamples ? 0 : head
  const t0 = timestamps[start]
  const rows = ['time_s,force_n']
  for (let i = 0; i < count; i++) {
    const idx = (start + i) % maxSamples
    rows.push(`${((timestamps[idx] - t0) / 1000).toFixed(4)},${force[idx].toFixed(4)}`)
  }
  downloadCsvBlob(rows, `imada_live_${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.csv`)
}

// Error reason strings are now resolved via t() inside the component

const ALARM_BITS = [
  { addr: 100, label: 'Axis 1 Alarm', clearAddr: 101 },
  { addr: 200, label: 'Axis 2 Alarm', clearAddr: 201 },
  { addr: 2,   label: 'Axis 3 Alarm', clearAddr: 502 },
] as const

export default function Run() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [recipeId, setRecipeId] = useState<number | null>(null)
  const [comboOpen, setComboOpen] = useState(false)
  const [recipeInvalid, setRecipeInvalid] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [commandSearch, setCommandSearch] = useState('')
  const [commandKbOpen, setCommandKbOpen] = useState(false)
  const { data: recipes = [], isLoading: recipesLoading, isError: recipesError } = useQuery({
    queryKey: ['recipes'],
    queryFn: api.recipes.list,
    retry: 3,
    retryDelay: 1000,
  })

  const showClampCard = useSettingsStore((s) => s.showClampCard)
  const minimalView = useSettingsStore((s) => s.minimalView)
  const esp32Unit = useSettingsStore((s) => s.esp32Unit)
  const machineState = useAppStore((s) => s.machineState)
  const loopResults = useAppStore((s) => s.loopResults)
  const currentLoop = useAppStore((s) => s.currentLoop)
  const plcBits = useAppStore((s) => s.plcBits)
  const imadaForce = useAppStore((s) => s.latestImadaForce)
  const esp32Force = useAppStore((s) => s.latestEsp32Force)
  const hwStatus = useAppStore((s) => s.hwStatus)
  const errors = useAppStore((s) => s.errors)
  const unseenErrorCount = useAppStore((s) => s.unseenErrorCount)
  const clearErrorCount = useAppStore((s) => s.clearErrorCount)
  const [errorPopoverOpen, setErrorPopoverOpen] = useState(false)
  const [selectedCycle, setSelectedCycle] = useState<number | 'all' | 'allmax' | 'allcof' | null>(null)
  const currentRunId = useAppStore((s) => s.currentRunId)

  const { data: cycleWaveform } = useQuery({
    queryKey: ['waveform', currentRunId, selectedCycle],
    queryFn: () => api.runs.waveform(currentRunId!, selectedCycle as number),
    enabled: typeof selectedCycle === 'number' && currentRunId !== null,
  })

  // Fetch every completed loop's waveform ONLY while an "All cycles / All CoF" view is
  // open. During a normal live run the operator stays on the Live view, so eagerly
  // pulling + retaining all loops' full-resolution waveforms (active queries are never
  // GC'd) was pure heap growth that scaled with cycle count. Gating keeps the live run
  // allocation-free; opening an All view fetches on demand (and gcTime evicts after).
  const needAllWaveforms = selectedCycle === 'all' || selectedCycle === 'allcof'
  const allLoopResults = useQueries({
    queries: (needAllWaveforms && currentRunId !== null ? loopResults : []).map((r) => ({
      queryKey: ['waveform', currentRunId, r.loop],
      queryFn: () => api.runs.waveform(currentRunId!, r.loop),
    })),
  })
  const allStamp = allLoopResults.map((r) => r.dataUpdatedAt).join(',')

  // "All Cycles" view — X-axis is Test Cycle Number, not elapsed time.
  // Each completed loop i (0-indexed in the results array) occupies [i, i+1).
  // Waveform is trimmed to the MR805 (start)→MR806 (end) window using tension_end_ms;
  // falls back to activeEndIdx heuristic for records predating that field.
  // `combinedCofData` mirrors `combinedStaticData` point-for-point (same X positions
  // and boundaries) but each cycle's friction force is divided by that cycle's average
  // clamp force → coefficient of friction. Cycles with no/zero clamp force become NaN
  // (rendered as a gap) so cycle alignment with the "All Cycles" view is preserved.
  // `combinedForceMax` / `combinedCofMax` are the peak force / peak CoF of each
  // cycle, placed at the X where that peak occurs → an optional "Max / cycle"
  // trend line overlaid on the All-Tensions / All-CoF views.
  const { combinedStaticData, combinedCofData, combinedBoundaries, combinedForceMax, combinedCofMax } = useMemo<{
    combinedStaticData: Array<[number, number]> | undefined
    combinedCofData: Array<[number, number]> | undefined
    combinedBoundaries: number[] | undefined
    combinedForceMax: Array<[number, number]> | undefined
    combinedCofMax: Array<[number, number]> | undefined
  }>(() => {
    const out: Array<[number, number]> = []
    const cof: Array<[number, number]> = []
    const boundaries: number[] = []
    const forceMax: Array<[number, number]> = []
    const cofMax: Array<[number, number]> = []
    let cycleIdx = 0
    loopResults.forEach((r, i) => {
      // dropPreRoll strips the t_ms=0 pre-tension baseline block (incl. its negative
      // settling values) that otherwise squishes into a spike at each cycle boundary.
      const pts = dropPreRoll((allLoopResults[i]?.data ?? []) as WaveformPoint[])
      if (pts.length === 0) return
      const endMs = r.tension_end_ms
      const active = endMs != null
        ? pts.filter(p => p.t_ms <= endMs)
        : pts.slice(0, activeEndIdx(pts))
      if (active.length === 0) return
      const t0 = active[0].t_ms
      const duration = (active[active.length - 1].t_ms - t0) || 1
      // Peak-preserving thin per cycle so the stitched array stays bounded regardless of
      // cycle count. decimate() keeps the endpoints, so t0/duration above are unaffected.
      const slim = decimate(active, PER_LOOP_MAX_POINTS, (p) => p.force_n)
      const clamp = r.avg_clamp_n
      const cofValid = clamp != null && clamp !== 0
      boundaries.push(cycleIdx)
      let maxF = -Infinity, maxFx = cycleIdx
      let maxC = -Infinity, maxCx = cycleIdx
      for (const p of slim) {
        const x = cycleIdx + (p.t_ms - t0) / duration
        const cofv = cofValid ? p.force_n / clamp : NaN
        out.push([x, p.force_n])
        cof.push([x, cofv])
        if (p.force_n > maxF) { maxF = p.force_n; maxFx = x }
        if (cofValid && Number.isFinite(cofv) && cofv > maxC) { maxC = cofv; maxCx = x }
      }
      if (maxF > -Infinity) forceMax.push([maxFx, maxF])
      if (cofValid && maxC > -Infinity) cofMax.push([maxCx, maxC])
      cycleIdx += 1
    })
    if (out.length === 0) return { combinedStaticData: undefined, combinedCofData: undefined, combinedBoundaries: undefined, combinedForceMax: undefined, combinedCofMax: undefined }
    return {
      combinedStaticData: out,
      combinedCofData: cof,
      combinedBoundaries: boundaries,
      combinedForceMax: forceMax.length > 0 ? forceMax : undefined,
      combinedCofMax: cofMax.length > 0 ? cofMax : undefined,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allStamp, loopResults])

  const [showMax, setShowMax] = useState(true)
  const cycleOverlay = !showMax
    ? undefined
    : selectedCycle === 'allcof' ? combinedCofMax
    : selectedCycle === 'all' ? combinedForceMax
    : undefined

  const staticData = useMemo<Array<[number, number]> | undefined>(() => {
    if (selectedCycle === 'all') return combinedStaticData
    if (selectedCycle === 'allcof') return combinedCofData
    if (!cycleWaveform || selectedCycle === null) return undefined
    const loopResult = typeof selectedCycle === 'number'
      ? loopResults.find(r => r.loop === selectedCycle)
      : undefined
    const endMs = loopResult?.tension_end_ms
    const pts = dropPreRoll(cycleWaveform as WaveformPoint[])
    const active = endMs != null
      ? pts.filter((p) => p.t_ms <= endMs)
      : pts.slice(0, activeEndIdx(pts))
    if (active.length === 0) return undefined
    const t0 = active[0].t_ms
    return active.map((p: WaveformPoint) => [(p.t_ms - t0) / 1000, p.force_n])
  }, [cycleWaveform, selectedCycle, combinedStaticData, combinedCofData, loopResults])
  const lampStart    = plcBits[300]?.value ?? false
  const lampStop     = plcBits[301]?.value ?? false
  const lampReset    = plcBits[302]?.value ?? false
  const machineReady = plcBits[303]?.value ?? false
  const isOperating  = lampStart  // MR300 ON = machine mid-cycle

  const activeAlarms = ALARM_BITS.filter((b) => plcBits[b.addr]?.value ?? false)
  const hasAlarm = activeAlarms.length > 0
  const [alarmClearTarget, setAlarmClearTarget] = useState<{ label: string; clearAddr: number } | null>(null)
  const alarmClearM = useMutation({
    mutationFn: (clearAddr: number) => api.hardware.pulseBit(clearAddr, 200),
    onSuccess: () => { toast.success('Alarm cleared'); setAlarmClearTarget(null) },
    onError: (e: Error) => toast.error(`Clear failed: ${e.message}`),
  })

  const [tareTarget, setTareTarget] = useState<'imada' | 'esp32' | null>(null)
  const tareM = useMutation({
    mutationFn: (target: 'imada' | 'esp32') =>
      target === 'imada' ? api.hardware.imadaTare() : api.hardware.esp32Tare(),
    onSuccess: () => { toast.success('Tare sent'); setTareTarget(null) },
    onError: (e: Error) => toast.error(`Tare failed: ${e.message}`),
  })

  const { isRunning, start, stop, isStarting, isStopping } = useSessionControl()

  const resetM = useMutation({
    mutationFn: () => api.hardware.pulseBit(802, 200),
    onSuccess: () => {
      toast.success('Reset pulse sent (MR802)')
      const { machineState: cur, handleStateChange } = useAppStore.getState()
      if (cur === 'ABORTED' || cur === 'ERROR') {
        handleStateChange({ type: 'state_change', from: cur, to: 'IDLE', at: new Date().toISOString() })
      }
    },
    onError: (e: Error) => toast.error(`Reset failed: ${e.message}`),
  })

  // Write recipe parameters to PLC on recipe select.
  // DM28 = loop count, DM30 = position mm×100, DM32 = speed mm/s×100
  const writeWordsM = useMutation({
    mutationFn: (recipe: Recipe) =>
      api.hardware.setWords({
        0:   recipe.loop_count,
        100: Math.round(recipe.position_mm * 100),
        102: Math.round(recipe.speed_mms * 100),
      }),
    onSuccess: () => toast.success('Recipe loaded to PLC'),
    onError: (e: Error) => toast.error(`PLC write failed: ${e.message}`),
  })

  // On recipe select: write words then pulse MR802 (Reset) in sequence.
  const selectRecipeM = useMutation({
    mutationFn: async (recipe: Recipe) => {
      await api.hardware.setWords({
        0:   recipe.loop_count,
        100: Math.round(recipe.position_mm * 100),
        102: Math.round(recipe.speed_mms * 100),
      })
      await api.hardware.pulseBit(802, 200)
    },
    onSuccess: () => toast.success('Recipe loaded & Reset sent (MR802)'),
    onError: (e: Error) => toast.error(`PLC write failed: ${e.message}`),
  })

  const activeRecipe = recipes.find((r) => r.id === recipeId)

  // MR809 countdown — driven by PLC Timer Start bit
  const timerBitActive = plcBits[809]?.value ?? false
  const timerBitTs     = plcBits[809]?.ts ?? 0
  const [timerSecs, setTimerSecs] = useState<number | null>(null)
  useEffect(() => {
    if (!timerBitActive || !activeRecipe?.prepare_timer_s) {
      setTimerSecs(null)
      return
    }
    const duration = activeRecipe.prepare_timer_s
    const startedAt = timerBitTs
    const tick = () => setTimerSecs(Math.max(0, duration - Math.floor((Date.now() - startedAt) / 1000)))
    tick()
    const id = setInterval(tick, 250)
    return () => clearInterval(id)
  }, [timerBitActive, timerBitTs, activeRecipe?.prepare_timer_s])

  function handleReset() {
    resetM.mutate()
  }

  function handleRecipeSaved(saved: Recipe) {
    setEditOpen(false)
    void qc.invalidateQueries({ queryKey: ['recipes'] })
    toast.success('Recipe updated')
    // Push the new values to PLC immediately so the operator doesn't have to
    // re-select the recipe — same write as the recipe-select onValueChange.
    if (!isRunning) writeWordsM.mutate(saved)
  }

  return (
    <div className="flex flex-col gap-3 w-full h-full min-h-0">
      {/* Edit recipe — opened by the pencil button next to the recipe selector */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('run.editRecipe')} — {activeRecipe?.name ?? ''}</DialogTitle>
          </DialogHeader>
          {activeRecipe && (
            <RecipeForm recipe={activeRecipe} onSaved={handleRecipeSaved} />
          )}
        </DialogContent>
      </Dialog>

      {/* Alarm reset dialog */}
      <Dialog open={alarmClearTarget !== null} onOpenChange={(o) => { if (!o) setAlarmClearTarget(null) }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('run.alarmDialog.title')}</DialogTitle>
            <DialogDescription>
              Send a clear pulse for <strong>{alarmClearTarget?.label}</strong>?
              This pulses MR{alarmClearTarget?.clearAddr} for 200 ms.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAlarmClearTarget(null)}>{t('common.cancel')}</Button>
            <Button
              variant="destructive"
              disabled={alarmClearM.isPending}
              onClick={() => alarmClearTarget && alarmClearM.mutate(alarmClearTarget.clearAddr)}
            >
              {alarmClearM.isPending ? t('hardware.clearing') : t('run.alarmDialog.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Tare confirm dialog — triggered from minimal-view overlay badges */}
      <Dialog open={tareTarget !== null} onOpenChange={(o) => { if (!o) setTareTarget(null) }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('run.tareDialog.title')}</DialogTitle>
            <DialogDescription>
              Zero the <strong>{tareTarget === 'imada' ? 'Force Gauge (Imada)' : 'Clamp Force (ESP32)'}</strong> now?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTareTarget(null)}>{t('common.cancel')}</Button>
            <Button
              disabled={tareM.isPending}
              onClick={() => tareTarget && tareM.mutate(tareTarget)}
            >
              {tareM.isPending ? <Loader2 size={14} className="animate-spin" /> : t('common.tare')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Toolbar — state badge + recipe + actions */}
      <div className={cn(
        'flex flex-wrap items-center gap-3 rounded-xl px-4 py-3 shrink-0',
        hasAlarm
          ? 'bg-red-50 dark:bg-red-950/40 border border-red-500 animate-pulse'
          : lampStop
            ? 'bg-red-50 dark:bg-red-950/30 border border-red-400 dark:border-red-600'
            : lampReset
              ? 'bg-amber-50 dark:bg-amber-950/30 border border-amber-400 dark:border-amber-600'
              : lampStart
                ? 'bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-400 dark:border-emerald-600'
                : 'bg-card border border-border',
      )}>
        {machineState === 'ERROR' ? (
          <Popover open={errorPopoverOpen} onOpenChange={(o) => { setErrorPopoverOpen(o); if (o) clearErrorCount() }}>
            <PopoverTrigger asChild>
              <div className="relative cursor-pointer select-none">
                <StateBadge state={machineState} machineReady={machineReady} />
                {unseenErrorCount > 0 && (
                  <span className="absolute -top-2 -right-2 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white ring-2 ring-background">
                    {unseenErrorCount > 9 ? '9+' : unseenErrorCount}
                  </span>
                )}
              </div>
            </PopoverTrigger>
            <PopoverContent side="bottom" align="start" className="w-80 p-0">
              <div className="flex items-center gap-2 border-b border-border px-4 py-3">
                <AlertTriangle size={15} className="shrink-0 text-red-500" />
                <span className="font-semibold text-sm">{t('run.errorLog')}</span>
                <span className="ml-auto text-xs text-muted-foreground">{errors.length} event{errors.length !== 1 ? 's' : ''}</span>
              </div>
              <div className="max-h-60 overflow-y-auto divide-y divide-border">
                {errors.length === 0 ? (
                  <p className="px-4 py-3 text-sm text-muted-foreground">{t('run.noErrors')}</p>
                ) : (
                  [...errors].reverse().map((e, i) => (
                    <div key={i} className="px-4 py-3 space-y-0.5">
                      <p className="text-sm font-semibold text-red-600 dark:text-red-400">
                        {t(`run.errors.${e.fromState}`, { defaultValue: `Error from state: ${e.fromState}` })}
                      </p>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        {e.loop != null && <span>{t('run.testCycle')} {e.loop}</span>}
                        <span>{new Date(e.at).toLocaleTimeString()}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </PopoverContent>
          </Popover>
        ) : (
          <StateBadge state={machineState} machineReady={machineReady} />
        )}
        {timerSecs !== null && (
          <Badge className="font-mono text-base px-4 py-4 bg-orange-500 text-white tabular-nums">
            {timerSecs}s
          </Badge>
        )}
        {activeAlarms.map((b) => (
          <button
            key={b.addr}
            type="button"
            className="inline-flex items-center gap-1.5 rounded-full border border-red-500/60 bg-red-100 dark:bg-red-950/60 px-3 py-1 text-sm font-semibold text-red-700 dark:text-red-300 animate-pulse cursor-pointer hover:bg-red-200 dark:hover:bg-red-900/60 active:scale-95 transition-all"
            onClick={() => setAlarmClearTarget({ label: b.label, clearAddr: b.clearAddr })}
            title="Click to open reset dialog"
          >
            <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
            {b.label}
          </button>
        ))}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Popover open={comboOpen} onOpenChange={setComboOpen}>
            <PopoverTrigger
              disabled={isRunning || recipesLoading}
              className={cn(
                'inline-flex h-11 w-56 items-center justify-between rounded-md border bg-background px-3 py-2 text-sm font-normal shadow-xs transition-colors',
                'hover:bg-accent hover:text-accent-foreground',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                'disabled:cursor-not-allowed disabled:opacity-50',
                recipeId ? 'text-foreground border-input' : 'text-muted-foreground border-input',
                recipeInvalid && !recipeId && 'border-red-500',
              )}
            >
              <span className="truncate">
                {recipesLoading ? t('run.loadingRecipes')
                  : recipesError ? 'Error — retry…'
                  : activeRecipe ? activeRecipe.name
                  : t('run.selectRecipe')}
              </span>
              <ChevronsUpDown size={14} className="ml-2 shrink-0 opacity-50" />
            </PopoverTrigger>
            <PopoverContent className="w-56 p-0">
              <Command>
                <CommandInput
                  placeholder={t('run.searchRecipe')}
                  value={commandSearch}
                  onValueChange={setCommandSearch}
                />
                <CommandList>
                  <CommandEmpty>{t('run.noRecipeFound')}</CommandEmpty>
                  <CommandGroup>
                    {recipes.map((r) => (
                      <CommandItem
                        key={r.id}
                        value={r.name}
                        onSelect={() => {
                          setRecipeId(r.id)
                          setRecipeInvalid(false)
                          setComboOpen(false)
                          setCommandSearch('')
                          if (!isRunning) selectRecipeM.mutate(r)
                        }}
                      >
                        <Check size={14} className={cn('mr-2 shrink-0', recipeId === r.id ? 'opacity-100' : 'opacity-0')} />
                        {r.name}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
          {/* On-screen keyboard for recipe search — opens the recipe picker then filters via keyboard */}
          <button
            type="button"
            aria-label="Open keyboard for recipe search"
            disabled={isRunning || recipesLoading}
            onClick={() => {
              setComboOpen(true)
              setCommandKbOpen(true)
            }}
            className={cn(
              'inline-flex h-11 w-11 items-center justify-center rounded-md border border-input bg-background',
              'text-muted-foreground hover:text-foreground hover:bg-accent transition-colors',
              'disabled:pointer-events-none disabled:opacity-50',
            )}
          >
            <Keyboard size={16} />
          </button>
          <KeyboardSheet
            open={commandKbOpen}
            onOpenChange={(next) => {
              setCommandKbOpen(next)
              if (!next && !comboOpen) setCommandSearch('')
            }}
            value={commandSearch}
            onChange={(v) => {
              setCommandSearch(v)
              if (!comboOpen) setComboOpen(true)
            }}
            title={t('run.searchRecipe')}
          />
          <Button
            variant="outline"
            size="icon"
            className="h-11 w-11 shrink-0"
            disabled={!activeRecipe || isRunning}
            title={
              isRunning
                ? 'Cannot edit while a loop is running — stop or wait for finish'
                : activeRecipe
                  ? `Edit ${activeRecipe.name}`
                  : 'Select a recipe to edit'
            }
            onClick={() => setEditOpen(true)}
          >
            <Pencil size={16} />
          </Button>
          <Button
            className="h-11 w-28 text-base font-bold bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-40"
            disabled={!machineReady || isRunning || isStarting}
            title={!machineReady ? 'MR303 OFF — machine not ready' : undefined}
            onClick={() => {
              if (!recipeId) { setRecipeInvalid(true); return }
              const recipe = recipes.find((r) => r.id === recipeId)
              start(recipeId, recipe)
            }}
          >
            {isStarting ? <Loader2 size={18} className="animate-spin" /> : <><Play size={16} className="mr-1.5" />{t('run.start')}</>}
          </Button>
          <Button
            className="h-11 w-28 text-base font-bold bg-red-600 hover:bg-red-500 text-white disabled:opacity-40"
            disabled={isStopping || (machineReady && !isRunning)}
            onClick={stop}
          >
            {isStopping ? <Loader2 size={18} className="animate-spin" /> : <><Square size={14} className="mr-1.5" />{t('run.stop')}</>}
          </Button>
          <Button
            className="h-11 w-28 text-base font-bold bg-amber-500 hover:bg-amber-400 text-white disabled:opacity-40"
            disabled={resetM.isPending || (!machineReady && isOperating)}
            title={!machineReady && isOperating ? 'MR300 ON — stop first before reset' : undefined}
            onClick={handleReset}
          >
            {resetM.isPending ? <Loader2 size={18} className="animate-spin" /> : <><RotateCcw size={15} className="mr-1.5" />{t('run.reset')}</>}
          </Button>
        </div>
      </div>

      {/* Live force readouts — hidden in minimal view (values move into chart card) */}
      {!minimalView && (
        <div className="flex gap-3">
          <ImadaReadout />
          {showClampCard && <Esp32Readout threshold={activeRecipe?.clamp_threshold_n ?? null} />}
        </div>
      )}

      {/* Two-column: summary left, chart right */}
      <div className="flex gap-3 flex-1 min-h-0">
        {/* Left: loop summary stats — hidden when no results yet */}
        <div className="bg-card border border-border rounded-xl px-3 py-3 flex flex-col w-80 shrink-0">
          <div className="flex gap-1 mb-2 shrink-0">
            <button
              type="button"
              onClick={() => setSelectedCycle(null)}
              className={cn(
                'shrink-0 flex items-center gap-1 rounded-lg border text-xs font-semibold px-2.5 py-1.5 transition-colors',
                selectedCycle === null
                  ? 'border-emerald-500 bg-emerald-500 text-white'
                  : 'border-emerald-500/50 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20',
              )}
            >
              <Radio size={12} /> {t('run.live')}
            </button>
            <button
              type="button"
              disabled={loopResults.length <= 1}
              onClick={() => setSelectedCycle((c) => c === 'allcof' ? null : 'allcof')}
              className={cn(
                'flex-1 rounded-lg border text-xs font-semibold py-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-background',
                selectedCycle === 'allcof'
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-background border-border hover:bg-muted',
              )}
            >
              {t('run.allCof')}
            </button>
            <button
              type="button"
              disabled={loopResults.length <= 1}
              onClick={() => setSelectedCycle((c) => c === 'all' ? null : 'all')}
              className={cn(
                'flex-1 rounded-lg border text-xs font-semibold py-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-background',
                selectedCycle === 'all'
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-background border-border hover:bg-muted',
              )}
            >
              {t('run.allCycles')}
            </button>
            <button
              type="button"
              disabled={loopResults.length <= 1}
              onClick={() => setSelectedCycle((c) => c === 'allmax' ? null : 'allmax')}
              className={cn(
                'flex-1 rounded-lg border text-xs font-semibold py-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-background',
                selectedCycle === 'allmax'
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-background border-border hover:bg-muted',
              )}
            >
              {t('run.allMax')}
            </button>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-b border-border">
                <TableHead className="py-1 text-xs font-semibold uppercase tracking-wide w-8">{t('run.cycle')}</TableHead>
                <TableHead className="py-1 text-xs font-semibold uppercase tracking-wide text-right">{t('run.maxForce')}</TableHead>
                <TableHead className="py-1 text-xs font-semibold uppercase tracking-wide text-right">{t('run.clamp')} ({esp32Unit})</TableHead>
                <TableHead className="py-1 text-xs font-semibold uppercase tracking-wide text-right">{t('run.cof')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loopResults.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="py-4 text-center text-sm text-muted-foreground">{t('run.noTestCycles')}</TableCell>
                </TableRow>
              ) : (
                loopResults.map((r) => (
                  <TableRow
                    key={r.loop}
                    className={cn(
                      'border-b border-border/40 cursor-pointer transition-colors',
                      selectedCycle === r.loop ? 'bg-primary/10' : 'hover:bg-muted/30',
                    )}
                    onClick={() => setSelectedCycle(selectedCycle === r.loop ? null : r.loop)}
                  >
                    <TableCell className="py-1.5"><Badge className="rounded-full h-6 w-6 !p-0 font-mono text-[11px] bg-primary text-primary-foreground">{r.loop}</Badge></TableCell>
                    <TableCell className="py-1.5 font-mono text-right">{r.peak_force_n.toFixed(3)}</TableCell>
                    <TableCell className="py-1.5 font-mono text-right text-muted-foreground">
                      {r.avg_clamp_n != null ? fmtClamp(r.avg_clamp_n, esp32Unit) : '—'}
                    </TableCell>
                    <TableCell className="py-1.5 font-mono text-right">
                      {r.avg_clamp_n != null && r.avg_clamp_n !== 0
                        ? (r.peak_force_n / r.avg_clamp_n).toFixed(3)
                        : '—'}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="w-full mt-2 shrink-0 gap-1"
            onClick={() => {
              if (staticData) {
                const label = selectedCycle === 'all'
                  ? `run${currentRunId}_all_cycles`
                  : selectedCycle === 'allcof'
                    ? `run${currentRunId}_all_cof`
                    : `run${currentRunId}_cycle${selectedCycle}`
                const header = selectedCycle === 'allcof' ? 'cycle,cof' : 'time_s,force_n'
                const rows = [header, ...staticData.map(([tv, fv]) => `${tv.toFixed(4)},${fv.toFixed(4)}`)]
                downloadCsvBlob(rows, `${label}.csv`)
              } else {
                exportLiveImadaCsv()
              }
            }}
            title={staticData ? 'Export trimmed waveform as CSV (matches chart)' : 'Export live Imada stream as CSV'}
          >
            <Download size={14} /> {t('run.exportCSV')}
          </Button>
        </div>

        {/* Right: realtime chart — fills remaining width */}
        <div className="bg-card border border-border rounded-xl p-3 flex-1 min-h-[280px] flex flex-col overflow-hidden">

          {/* Chart header — recipe params (left) + live readouts (right, minimalView only) */}
          {(activeRecipe || minimalView) && (
            <div className="flex items-center gap-2 mb-2 shrink-0 flex-wrap">
              {activeRecipe && (
                <div className="flex flex-wrap gap-1.5">
                  <span className="flex items-center gap-1.5 bg-amber-50 dark:bg-amber-950/30 border border-amber-300/60 dark:border-amber-600/40 rounded-md px-2.5 py-1 shadow-sm">
                    <Ruler size={12} className="shrink-0 text-amber-500 dark:text-amber-400" />
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{t('run.pos')}</span>
                    <span className="inline-block font-mono font-bold text-amber-700 dark:text-amber-300 text-sm tabular-nums leading-none">{activeRecipe.position_mm}</span>
                    <span className="text-xs text-muted-foreground font-medium">mm</span>
                  </span>
                  <span className="flex items-center gap-1.5 bg-violet-50 dark:bg-violet-950/30 border border-violet-300/60 dark:border-violet-600/40 rounded-md px-2.5 py-1 shadow-sm">
                    <Zap size={12} className="shrink-0 text-violet-500 dark:text-violet-400" />
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{t('run.spd')}</span>
                    <span className="inline-block font-mono font-bold text-violet-700 dark:text-violet-300 text-sm tabular-nums leading-none">{activeRecipe.speed_mms}</span>
                    <span className="text-xs text-muted-foreground font-medium">mm/s</span>
                  </span>
                  {/* Recipe loop-count chip — hidden while running, where the live
                      current/total chip below already shows the cycle count. */}
                  {!(currentLoop !== null && isRunning) && (
                    <span className="flex items-center gap-1.5 bg-teal-50 dark:bg-teal-950/30 border border-teal-300/60 dark:border-teal-600/40 rounded-md px-2.5 py-1 shadow-sm">
                      <Repeat size={12} className="shrink-0 text-teal-500 dark:text-teal-400" />
                      <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{t('run.testCycle')}</span>
                      <span className="inline-block font-mono font-bold text-teal-700 dark:text-teal-300 text-sm tabular-nums leading-none">{activeRecipe.loop_count}</span>
                    </span>
                  )}
                  {currentLoop !== null && isRunning && (
                    <span className="flex items-center gap-1.5 bg-blue-50 dark:bg-blue-950/40 border border-blue-400/60 rounded-md px-2.5 py-1 shadow-sm">
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse shrink-0" />
                      <span className="text-[10px] text-blue-600 dark:text-blue-400 uppercase tracking-wider">{t('run.testCycle')}</span>
                      <span className="inline-block font-mono font-bold text-blue-700 dark:text-blue-300 text-sm tabular-nums leading-none">{currentLoop} / {activeRecipe.loop_count}</span>
                    </span>
                  )}
                  {typeof selectedCycle === 'number' && (
                    <span className="flex items-center gap-1.5 bg-primary/10 border border-primary/30 rounded-md px-2.5 py-1 shadow-sm">
                      <span className="text-[10px] text-primary uppercase tracking-wider">{t('run.testCycle')}</span>
                      <span className="inline-block font-mono font-bold text-primary text-sm tabular-nums leading-none">{selectedCycle}</span>
                    </span>
                  )}
                </div>
              )}
              {minimalView && (
                <div className={cn('flex items-center gap-1.5', activeRecipe && 'ml-auto')}>
                  <button
                    type="button"
                    onClick={() => setTareTarget('imada')}
                    className="flex items-center gap-1.5 bg-background border border-border rounded-md px-2.5 py-1 shadow-sm cursor-pointer select-none hover:bg-accent active:scale-95 transition-all"
                    title="Tap to tare Force Gauge"
                  >
                    <Activity size={12} className={cn('shrink-0', hwStatus.imada ? 'text-blue-500' : 'text-muted-foreground/40')} />
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{t('run.force')}</span>
                    <span className={cn('inline-block w-[7ch] text-right text-sm font-mono font-bold tabular-nums leading-none', hwStatus.imada && imadaForce !== null ? 'text-blue-600 dark:text-blue-400' : 'text-muted-foreground/50')}>
                      {imadaForce !== null && Number.isFinite(imadaForce) ? imadaForce.toFixed(3) : '—'}
                    </span>
                    <span className="text-xs text-muted-foreground font-medium">N</span>
                  </button>
                  {showClampCard && (
                    <button
                      type="button"
                      onClick={() => setTareTarget('esp32')}
                      className="flex items-center gap-1.5 bg-background border border-border rounded-md px-2.5 py-1 shadow-sm cursor-pointer select-none hover:bg-accent active:scale-95 transition-all"
                      title="Tap to tare Clamp Force"
                    >
                      <Grip size={12} className={cn('shrink-0', hwStatus.esp32 ? 'text-emerald-500' : 'text-muted-foreground/40')} />
                      <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{t('run.clamp')}</span>
                      <span className={cn('inline-block w-[7ch] text-right text-sm font-mono font-bold tabular-nums leading-none', hwStatus.esp32 && esp32Force !== null ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground/50')}>
                        {esp32Force !== null && Number.isFinite(esp32Force) ? fmtClamp(esp32Force, esp32Unit) : '—'}
                      </span>
                      <span className="text-xs text-muted-foreground font-medium">{esp32Unit}</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Chart area */}
          <div className="flex-1 min-h-0 relative">
            {/* WaveformChart stays mounted always — unmounting it causes getEchartsInstance()
                to return null on remount before ECharts initialises, leaving the chart blank. */}
            <div className={cn('w-full h-full', selectedCycle === 'allmax' && 'invisible pointer-events-none')}>
              <WaveformChart
                staticData={staticData}
                cycleBoundaries={selectedCycle === 'all' || selectedCycle === 'allcof' ? combinedBoundaries : undefined}
                xMode={selectedCycle === 'all' || selectedCycle === 'allcof' ? 'cycle' : 'time'}
                yLabel={selectedCycle === 'allcof' ? t('run.cof') : undefined}
                valueUnit={selectedCycle === 'allcof' ? '' : undefined}
                overlay={cycleOverlay}
              />
            </div>
            {selectedCycle === 'allmax' && (
              <div className="absolute inset-0">
                <MaxCycleChart loopResults={loopResults} />
              </div>
            )}
            {(selectedCycle === 'all' || selectedCycle === 'allcof') && (
              <button
                type="button"
                onClick={() => setShowMax((s) => !s)}
                className={cn(
                  'absolute top-2 right-2 z-10 flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-semibold shadow-sm transition-colors',
                  showMax
                    ? 'bg-amber-500/15 border-amber-500/50 text-amber-600 dark:text-amber-400'
                    : 'bg-background border-border text-muted-foreground hover:bg-muted',
                )}
                title="Toggle peak-per-cycle line"
              >
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: showMax ? '#f59e0b' : 'transparent', boxShadow: showMax ? 'none' : 'inset 0 0 0 1px currentColor' }} />
                {t('run.maxPerCycle')}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

