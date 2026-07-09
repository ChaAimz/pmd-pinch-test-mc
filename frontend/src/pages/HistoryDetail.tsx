import { useState, useMemo, useRef, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useQueries } from '@tanstack/react-query'
import { ArrowLeft, Download, ImageDown, Ruler, Zap, Repeat, Grip, Circle, Timer, Radio } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useSettingsStore } from '@/store/settings'
import type { TestLoop, WaveformPoint, Recipe } from '@/lib/types'
import { MaxCycleChart } from '@/components/MaxCycleChart'
import { WaveformChart } from '@/components/WaveformChart'
import { ExportFilenameDialog, type PendingExport } from '@/components/ExportFilenameDialog'
import { dropPreRoll, activeEndIdx, decimate } from '@/lib/waveform'

const GF_PER_N = 101.97162129779283
// Peak-preserving points kept per cycle in the stitched all-cycles view — bounds the
// stitched array (and its retained heap) for runs with many loops. Single-loop view
// below stays full-resolution for close inspection.
const PER_LOOP_MAX_POINTS = 300
function fmtClamp(n: number, unit: 'gf' | 'N') {
  return unit === 'gf' ? (n * GF_PER_N).toFixed(1) : n.toFixed(4)
}

function buildChartFilename(
  recipeName: string | undefined,
  runId: number | null | undefined,
  positionMm: number | undefined,
  speedMms: number | undefined,
  loopCount: number | undefined,
  suffix: string,
  ext: 'csv' | 'png',
): string {
  const now = new Date()
  const date = now.toISOString().slice(0, 10).replace(/-/g, '')
  const time = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`
  const safe = (s?: string | null) => (s ?? '').replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '')
  const parts: string[] = [safe(recipeName) || 'chart']
  if (runId != null) parts.push(`run${runId}`)
  parts.push(date, time)
  if (positionMm != null) parts.push(`${positionMm}mm`)
  if (speedMms != null) parts.push(`${speedMms}mms`)
  if (loopCount != null) parts.push(`${loopCount}x`)
  return parts.join('_') + suffix + '.' + ext
}

type View = number | 'all' | 'allmax' | 'allcof'

export default function HistoryDetail() {
  const { t } = useTranslation()
  const { id } = useParams<{ id: string }>()
  const runId = id != null ? Number(id) : null
  // Default to the All CoF view on entry.
  const [view, setView] = useState<View>('allcof')

  const { data: run, isLoading } = useQuery({
    queryKey: ['run', runId],
    queryFn: () => api.runs.get(runId!),
    enabled: runId != null && !Number.isNaN(runId),
  })

  const { data: recipe } = useQuery<Recipe>({
    queryKey: ['recipe', run?.recipe_id],
    queryFn: () => api.recipes.get(run!.recipe_id),
    enabled: run != null,
  })

  const esp32Unit = useSettingsStore((s) => s.esp32Unit)

  const waveformExportRef = useRef<(() => string | null) | null>(null)
  const maxCycleExportRef = useRef<(() => string | null) | null>(null)
  const [pendingExport, setPendingExport] = useState<PendingExport | null>(null)

  // --- Data layer (hooks must run before any early return) ---
  // Fetch every loop's waveform once. The same fetch set feeds the stitched
  // all-cycles / all-CoF views AND the single-loop view, so switching between
  // them is instant and — crucially — drives ONE always-mounted WaveformChart
  // (see chart area below). Unmounting/remounting per view left ECharts blank.
  const rid = run?.id ?? null
  const loops = useMemo<TestLoop[]>(() => run?.loops ?? [], [run])
  const waveformResults = useQueries({
    queries: loops.map((l) => ({
      queryKey: ['waveform', rid, l.loop_index],
      queryFn: () => api.runs.waveform(rid!, l.loop_index),
    })),
  })
  const waveformsLoading = waveformResults.some((r) => r.isLoading)
  const stamp = waveformResults.map((r) => r.dataUpdatedAt).join(',')

  // Stitched all-cycles force + CoF on one Test-Cycle axis. `combinedCofData`
  // mirrors `combinedStaticData` point-for-point but each cycle's force is divided
  // by that cycle's avg clamp force → coefficient of friction (NaN = gap).
  const { combinedStaticData, combinedCofData, combinedBoundaries, combinedForceMax, combinedCofMax, cycleMeta } = useMemo(() => {
    const out: Array<[number, number]> = []
    const cofOut: Array<[number, number]> = []
    const boundaries: number[] = []
    const forceMax: Array<[number, number]> = []
    const cofMax: Array<[number, number]> = []
    // Per stitched cycle: enough to re-derive its full-resolution points from the cached
    // raw waveform on demand (zoom). `i` indexes waveformResults; t0/duration map a sample's
    // t_ms back to the cycle-band X used in the stitched view.
    const meta: Array<{ i: number; t0: number; duration: number; endMs: number | null; clamp: number | null }> = []
    let cycleIdx = 0
    loops.forEach((l, i) => {
      // dropPreRoll removes the t_ms=0 pre-tension baseline block whose negative
      // settling values otherwise squish into a vertical spike at each boundary.
      const pts = dropPreRoll((waveformResults[i]?.data ?? []) as WaveformPoint[])
      if (pts.length === 0) return
      // Then trim the decaying tail to the active tension window (MR805→MR806).
      const endMs = l.tension_end_ms
      const active = endMs != null
        ? pts.filter((p) => p.t_ms <= endMs)
        : pts.slice(0, activeEndIdx(pts))
      if (active.length === 0) return
      const t0 = active[0].t_ms
      const duration = (active[active.length - 1].t_ms - t0) || 1
      // Peak-preserving thin per cycle; decimate() keeps endpoints so t0/duration hold.
      const slim = decimate(active, PER_LOOP_MAX_POINTS, (p) => p.force_n)
      const clamp = l.avg_clamp_n
      const cofValid = clamp != null && clamp !== 0
      boundaries.push(cycleIdx)
      meta.push({ i, t0, duration, endMs, clamp: cofValid ? clamp : null })
      // Track each cycle's peak (force + CoF) and the X where it occurs → the
      // optional "Max / cycle" trend line overlaid on the stitched views.
      let maxF = -Infinity, maxFx = cycleIdx
      let maxC = -Infinity, maxCx = cycleIdx
      for (const p of slim) {
        const x = cycleIdx + (p.t_ms - t0) / duration
        const cofv = cofValid ? p.force_n / clamp : NaN
        out.push([x, p.force_n])
        cofOut.push([x, cofv])
        if (p.force_n > maxF) { maxF = p.force_n; maxFx = x }
        if (cofValid && Number.isFinite(cofv) && cofv > maxC) { maxC = cofv; maxCx = x }
      }
      if (maxF > -Infinity) forceMax.push([maxFx, maxF])
      if (cofValid && maxC > -Infinity) cofMax.push([maxCx, maxC])
      cycleIdx += 1
    })
    return {
      combinedStaticData: out.length > 0 ? out : undefined,
      combinedCofData: cofOut.length > 0 ? cofOut : undefined,
      combinedBoundaries: boundaries.length > 0 ? boundaries : undefined,
      combinedForceMax: forceMax.length > 0 ? forceMax : undefined,
      combinedCofMax: cofMax.length > 0 ? cofMax : undefined,
      cycleMeta: meta,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stamp, loops])

  const [showMax, setShowMax] = useState(true)

  // Single-loop trimmed waveform (time axis, re-zeroed) for the Test-Cycle row view.
  const singleData = useMemo<Array<[number, number]> | undefined>(() => {
    if (typeof view !== 'number') return undefined
    const i = loops.findIndex((l) => l.loop_index === view)
    if (i < 0) return undefined
    const pts = dropPreRoll((waveformResults[i]?.data ?? []) as WaveformPoint[])
    if (pts.length === 0) return undefined
    const endMs = loops[i].tension_end_ms
    const active = endMs != null
      ? pts.filter((p) => p.t_ms <= endMs)
      : pts.slice(0, activeEndIdx(pts))
    if (active.length === 0) return undefined
    const t0 = active[0].t_ms
    return active.map((p) => [(p.t_ms - t0) / 1000, p.force_n] as [number, number])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stamp, view, loops])

  // Progressive detail-on-zoom for the stitched views. The once-decimated overview
  // (combinedStaticData, ~PER_LOOP_MAX_POINTS/cycle) looks coarse / sawtoothed when you
  // zoom in. Given a visible X window (cycle units), re-derive the FULL-resolution points
  // of only the visible cycles from the cached raw waveforms, capped at DETAIL_BUDGET.
  // The raw per-loop data already lives in the react-query cache, so this materialises
  // only the visible window — no extra retained heap. Wide views keep the rich overview
  // (resampling the whole run to a flat budget would be coarser than per-cycle).
  const resampleWindow = useCallback((loX: number, hiX: number): Array<[number, number]> | null => {
    const meta = cycleMeta
    if (!meta || meta.length === 0) return null
    const isCof = view === 'allcof'
    const overview = isCof ? combinedCofData : combinedStaticData
    const DETAIL_SPAN_CYCLES = 18  // breakeven: DETAIL_BUDGET / this ≈ PER_LOOP_MAX_POINTS
    const DETAIL_BUDGET = 6000
    if (hiX - loX >= DETAIL_SPAN_CYCLES) return overview ?? null
    const lo = Math.max(0, Math.floor(loX))
    const hi = Math.min(meta.length, Math.ceil(hiX))
    if (hi <= lo) return overview ?? null
    const pts: Array<[number, number]> = []
    for (let c = lo; c < hi; c++) {
      const m = meta[c]
      const raw = dropPreRoll((waveformResults[m.i]?.data ?? []) as WaveformPoint[])
      const active = m.endMs != null
        ? raw.filter((p) => p.t_ms <= m.endMs!)
        : raw.slice(0, activeEndIdx(raw))
      for (const p of active) {
        const y = isCof ? (m.clamp != null ? p.force_n / m.clamp : NaN) : p.force_n
        pts.push([c + (p.t_ms - m.t0) / m.duration, y])
      }
    }
    return pts.length > 0 ? decimate(pts, DETAIL_BUDGET, (p) => p[1]) : (overview ?? null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stamp, view, cycleMeta, combinedStaticData, combinedCofData])

  if (isLoading) {
    return (
      <div className="space-y-3 w-full">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-9 w-full" />
        <div className="flex gap-3 h-80">
          <Skeleton className="h-full w-56 shrink-0" />
          <Skeleton className="h-full flex-1" />
        </div>
      </div>
    )
  }

  if (!run) return <p className="text-muted-foreground">Run not found.</p>

  // Which data the single, always-mounted chart shows. For 'allmax' the chart is
  // hidden (MaxCycleChart overlays) but stays mounted on the stitched data so it
  // never goes blank when the user switches back.
  const isStitch = view === 'all' || view === 'allcof'
  const chartData =
    view === 'allcof' ? combinedCofData
    : typeof view === 'number' ? singleData
    : combinedStaticData
  const hasChartData = chartData != null && chartData.length > 0
  // Optional "Max / cycle" overlay line — peak force (All Tensions) or peak CoF
  // (All CoF) per cycle, toggleable.
  const cycleOverlay = !showMax
    ? undefined
    : view === 'allcof' ? combinedCofMax
    : view === 'all' ? combinedForceMax
    : undefined

  return (
    <div className="flex flex-col gap-4 w-full h-full min-h-0">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap shrink-0">
        <Link to="/history">
          <Button variant="ghost" size="sm" className="gap-1">
            <ArrowLeft size={14} /> {t('common.back')}
          </Button>
        </Link>
        <h1 className="text-xl font-semibold">Run #{run.id}</h1>
        {/* Export CSV / Summary buttons hidden — uncomment to restore
        <div className="ml-auto flex items-center gap-2">
          <a href={api.runs.exportCsvUrl(run.id)} download>
            <Button variant="outline" size="sm" className="gap-1" title="Imada waveform across all loops, trimmed to the active tension window (matches chart)">
              <Download size={14} /> {t('history.raw')}
            </Button>
          </a>
          <a href={api.runs.summaryCsvUrl(run.id)} download>
            <Button variant="outline" size="sm" className="gap-1" title="Per-loop summary metrics">
              <FileText size={14} /> {t('history.summary')}
            </Button>
          </a>
        </div>
        */}
      </div>

      {run.loops.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('history.noLoopData')}</p>
      ) : (
        /* Two-column: summary left, chart right */
        <div className="flex gap-3 flex-1 min-h-0">
          {/* Left: loop summary stats */}
          <div className="bg-card border border-border rounded-xl px-3 py-3 flex flex-col w-80 shrink-0">
            <div className="flex gap-1 mb-2 shrink-0">
              <button
                type="button"
                disabled={run.loops.length <= 1}
                onClick={() => setView((v) => v === 'allcof' ? 'all' : 'allcof')}
                className={cn(
                  'flex-1 rounded-lg border text-xs font-semibold py-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-background',
                  view === 'allcof'
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background border-border hover:bg-muted',
                )}
              >
                {t('run.allCof')}
              </button>
              <button
                type="button"
                disabled={run.loops.length <= 1}
                onClick={() => setView('all')}
                className={cn(
                  'flex-1 rounded-lg border text-xs font-semibold py-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-background',
                  view === 'all'
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background border-border hover:bg-muted',
                )}
              >
                {t('run.allCycles')}
              </button>
              {/* Max Function hidden — uncomment to restore
              <button
                type="button"
                disabled={run.loops.length <= 1}
                onClick={() => setView((v) => v === 'allmax' ? 'all' : 'allmax')}
                className={cn(
                  'flex-1 rounded-lg border text-xs font-semibold py-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-background',
                  view === 'allmax'
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background border-border hover:bg-muted',
                )}
              >
                {t('run.allMax')}
              </button>
              */}
            </div>
            {view !== 'all' && (
              <button
                type="button"
                onClick={() => setView('all')}
                className="w-full mb-2 shrink-0 flex items-center justify-center gap-1.5 rounded-lg border border-border bg-background text-muted-foreground text-xs font-semibold py-1.5 hover:bg-muted transition-colors"
              >
                <Radio size={12} /> {t('common.all')}
              </button>
            )}
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
                {run.loops.map((loop: TestLoop) => (
                  <TableRow
                    key={loop.id}
                    className={cn(
                      'border-b border-border/40 cursor-pointer transition-colors',
                      view === loop.loop_index ? 'bg-primary/10' : 'hover:bg-muted/30',
                    )}
                    onClick={() => setView(view === loop.loop_index ? 'all' : loop.loop_index)}
                  >
                    <TableCell className="py-1.5"><Badge className="rounded-full h-6 w-6 !p-0 font-mono text-[11px] bg-primary text-primary-foreground">{loop.loop_index}</Badge></TableCell>
                    <TableCell className="py-1.5 font-mono text-right">{loop.peak_force_n?.toFixed(3) ?? '—'}</TableCell>
                    <TableCell className="py-1.5 font-mono text-right text-muted-foreground">
                      {loop.avg_clamp_n != null ? fmtClamp(loop.avg_clamp_n, esp32Unit) : '—'}
                    </TableCell>
                    <TableCell className="py-1.5 font-mono text-right">
                      {loop.avg_clamp_n != null && loop.avg_clamp_n !== 0
                        ? ((loop.peak_force_n ?? 0) / loop.avg_clamp_n).toFixed(3)
                        : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>
            <div className="flex gap-1 mt-2 shrink-0">
              <Button
                variant="outline"
                size="sm"
                className="flex-1 gap-1"
                onClick={() => {
                  const csvSuffix = view === 'allmax' ? '_all_max'
                    : view === 'allcof' ? '_all_max_cof'
                    : view === 'all' ? '_all_cycles'
                    : `_cycle${view}`
                  const csvFilename = buildChartFilename(recipe?.name, run.id, recipe?.position_mm, recipe?.speed_mms, recipe?.loop_count, csvSuffix, 'csv')
                  if (view === 'allmax') {
                    const rows = [
                      'cycle,max_force_n,avg_clamp_n,cof,judgment',
                      ...run.loops.filter((l) => l.peak_force_n != null).map((l) => {
                        const cof = l.avg_clamp_n != null && l.avg_clamp_n !== 0
                          ? (l.peak_force_n! / l.avg_clamp_n).toFixed(4) : ''
                        return `${l.loop_index},${l.peak_force_n!.toFixed(4)},${l.avg_clamp_n?.toFixed(4) ?? ''},${cof},${l.judgment ?? ''}`
                      }),
                    ]
                    setPendingExport({ suggested: csvFilename, ext: 'csv', getContent: () => ({ content: rows.join('\n'), encoding: 'utf8' }) })
                    return
                  }
                  if (view === 'all' || view === 'allcof') {
                    // Per-cycle max summary — mirrors the Summary Card table, not the raw waveform.
                    const rows = ['Test Cycles,Max CoF,Max Tension(N),Clamp (gf)']
                    for (const l of run.loops) {
                      if (l.peak_force_n == null) continue
                      const clampGf = l.avg_clamp_n != null ? (l.avg_clamp_n * GF_PER_N).toFixed(1) : ''
                      const cof = l.avg_clamp_n != null && l.avg_clamp_n !== 0
                        ? (l.peak_force_n / l.avg_clamp_n).toFixed(4) : ''
                      rows.push(`${l.loop_index},${cof},${l.peak_force_n.toFixed(4)},${clampGf}`)
                    }
                    setPendingExport({ suggested: csvFilename, ext: 'csv', getContent: () => ({ content: rows.join('\n'), encoding: 'utf8' }) })
                    return
                  }
                  if (!singleData) return
                  const loopData = run.loops.find((l) => l.loop_index === view)
                  const clamp_n = loopData?.avg_clamp_n ?? null
                  const rows = ['time_s,tension_n,cof,clamp_n']
                  for (const [time_s, force_n] of singleData) {
                    const cof = clamp_n != null && clamp_n !== 0 ? force_n / clamp_n : NaN
                    rows.push(`${time_s.toFixed(4)},${force_n.toFixed(4)},${Number.isFinite(cof) ? cof.toFixed(4) : ''},${clamp_n?.toFixed(4) ?? ''}`)
                  }
                  setPendingExport({ suggested: csvFilename, ext: 'csv', getContent: () => ({ content: rows.join('\n'), encoding: 'utf8' }) })
                }}
                title={
                  view === 'all' || view === 'allcof'
                    ? 'Export per-cycle Max Tension / Max CoF summary as CSV'
                    : t('historyDetail.exportCsvTitle')
                }
              >
                <Download size={14} />
                {t('run.exportCSV')}
                <span className="text-muted-foreground font-normal">·{' '}
                  {view === 'allmax' ? t('run.allMax')
                    : view === 'allcof' ? t('run.allMaxCof')
                    : view === 'all' ? t('run.allTensionMax')
                    : `${t('run.cycle')} ${view}`}
                </span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="flex-1 gap-1"
                onClick={() => {
                  const pngSuffix = view === 'allmax' ? '_all_max'
                    : view === 'allcof' ? '_all_cof'
                    : view === 'all' ? '_all_cycles'
                    : `_cycle${view}`
                  const filename = buildChartFilename(recipe?.name, run.id, recipe?.position_mm, recipe?.speed_mms, recipe?.loop_count, pngSuffix, 'png')
                  setPendingExport({
                    suggested: filename,
                    ext: 'png',
                    getContent: () => {
                      const url = view === 'allmax' ? maxCycleExportRef.current?.() : waveformExportRef.current?.()
                      if (!url) return null
                      return { content: url.split(',')[1] ?? '', encoding: 'base64' as const }
                    },
                  })
                }}
                title="Export chart as PNG"
              >
                <ImageDown size={14} /> {t('run.exportPNG')}
              </Button>
            </div>
          </div>

          {/* Right: waveform chart — fills remaining width */}
          <div className="bg-card border border-border rounded-xl p-3 flex-1 min-h-[280px] flex flex-col overflow-hidden">

            {/* Chart header — recipe params */}
            {recipe && (
              <div className="flex items-center gap-2 mb-2 shrink-0 flex-wrap">
                {recipe && (
                  <div className="flex flex-wrap gap-1.5">
                    <span className="flex items-center gap-1.5 bg-amber-50 dark:bg-amber-950/30 border border-amber-300/60 dark:border-amber-600/40 rounded-md px-2.5 py-1 shadow-sm">
                      <Ruler size={12} className="shrink-0 text-amber-500 dark:text-amber-400" />
                      <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{t('run.pos')}</span>
                      <span className="inline-block font-mono font-bold text-amber-700 dark:text-amber-300 text-sm tabular-nums leading-none">{recipe.position_mm}</span>
                      <span className="text-xs text-muted-foreground font-medium">mm</span>
                    </span>
                    <span className="flex items-center gap-1.5 bg-violet-50 dark:bg-violet-950/30 border border-violet-300/60 dark:border-violet-600/40 rounded-md px-2.5 py-1 shadow-sm">
                      <Zap size={12} className="shrink-0 text-violet-500 dark:text-violet-400" />
                      <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{t('run.spd')}</span>
                      <span className="inline-block font-mono font-bold text-violet-700 dark:text-violet-300 text-sm tabular-nums leading-none">{recipe.speed_mms}</span>
                      <span className="text-xs text-muted-foreground font-medium">mm/s</span>
                    </span>
                    <span className="flex items-center gap-1.5 bg-teal-50 dark:bg-teal-950/30 border border-teal-300/60 dark:border-teal-600/40 rounded-md px-2.5 py-1 shadow-sm">
                      <Repeat size={12} className="shrink-0 text-teal-500 dark:text-teal-400" />
                      <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{t('run.testCycle')}</span>
                      <span className="inline-block font-mono font-bold text-teal-700 dark:text-teal-300 text-sm tabular-nums leading-none">{recipe.loop_count}</span>
                    </span>
                    <span className="flex items-center gap-1.5 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-300/60 dark:border-emerald-600/40 rounded-md px-2.5 py-1 shadow-sm">
                      <Grip size={12} className="shrink-0 text-emerald-500 dark:text-emerald-400" />
                      <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{t('run.clamp')}</span>
                      <span className="inline-block font-mono font-bold text-emerald-700 dark:text-emerald-300 text-sm tabular-nums leading-none">{fmtClamp(recipe.clamp_threshold_n, esp32Unit)}</span>
                      <span className="text-xs text-muted-foreground font-medium">{esp32Unit}</span>
                    </span>
                    <span className="flex items-center gap-1.5 bg-orange-50 dark:bg-orange-950/30 border border-orange-300/60 dark:border-orange-600/40 rounded-md px-2.5 py-1 shadow-sm">
                      <Circle size={12} className="shrink-0 text-orange-500 dark:text-orange-400" />
                      <span className="text-[10px] text-muted-foreground uppercase tracking-wider">OD</span>
                      <span className="inline-block font-mono font-bold text-orange-700 dark:text-orange-300 text-sm tabular-nums leading-none">{recipe.diameter_mm}</span>
                      <span className="text-xs text-muted-foreground font-medium">mm</span>
                    </span>
                    <span className="flex items-center gap-1.5 bg-sky-50 dark:bg-sky-950/30 border border-sky-300/60 dark:border-sky-600/40 rounded-md px-2.5 py-1 shadow-sm">
                      <Timer size={12} className="shrink-0 text-sky-500 dark:text-sky-400" />
                      <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Soak</span>
                      <span className="inline-block font-mono font-bold text-sky-700 dark:text-sky-300 text-sm tabular-nums leading-none">{recipe.prepare_timer_s}</span>
                      <span className="text-xs text-muted-foreground font-medium">s</span>
                    </span>
                    {recipe.min_force_n != null && (
                      <span className="flex items-center gap-1.5 bg-blue-50 dark:bg-blue-950/30 border border-blue-300/60 dark:border-blue-600/40 rounded-md px-2.5 py-1 shadow-sm">
                        <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{t('recipes.minForce')}</span>
                        <span className="inline-block font-mono font-bold text-blue-700 dark:text-blue-300 text-sm tabular-nums leading-none">{recipe.min_force_n}</span>
                        <span className="text-xs text-muted-foreground font-medium">N</span>
                      </span>
                    )}
                    {recipe.max_force_n != null && (
                      <span className="flex items-center gap-1.5 bg-blue-50 dark:bg-blue-950/30 border border-blue-300/60 dark:border-blue-600/40 rounded-md px-2.5 py-1 shadow-sm">
                        <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{t('recipes.maxForce')}</span>
                        <span className="inline-block font-mono font-bold text-blue-700 dark:text-blue-300 text-sm tabular-nums leading-none">{recipe.max_force_n}</span>
                        <span className="text-xs text-muted-foreground font-medium">N</span>
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Chart area — ONE WaveformChart stays mounted across every view (force /
                CoF / single cycle); only its data swaps. For 'allmax' it's hidden and
                MaxCycleChart overlays. This is what stops the chart going blank when
                toggling between views (ECharts loses its instance on remount). */}
            <div className="flex-1 min-h-0 relative">
              <div className={cn('w-full h-full', view === 'allmax' && 'invisible pointer-events-none')}>
                <WaveformChart
                  staticData={chartData}
                  resampleWindow={isStitch ? resampleWindow : undefined}
                  cycleBoundaries={isStitch ? combinedBoundaries : undefined}
                  xMode={isStitch ? 'cycle' : 'time'}
                  yLabel={view === 'allcof' ? t('run.cof') : undefined}
                  valueUnit={view === 'allcof' ? '' : undefined}
                  overlay={cycleOverlay}
                  exportRef={waveformExportRef}
                />
              </div>
              {/* allmax hidden — MaxCycleChart removed
              {view === 'allmax' && (
                <div className="absolute inset-0">
                  <MaxCycleChart
                    loopResults={run.loops.filter((l) => l.peak_force_n != null).map((l) => ({
                      loop: l.loop_index,
                      peak_force_n: l.peak_force_n!,
                      judgment: l.judgment ?? 'fail',
                      min_force_n: 0,
                      avg_force_n: 0,
                      hold_time_ms: 0,
                      tension_end_ms: null,
                      peak_clamp_n: null,
                      avg_clamp_n: l.avg_clamp_n,
                    }))}
                    exportRef={maxCycleExportRef}
                  />
                </div>
              )}
              */}
              {waveformsLoading && !hasChartData && view !== 'allmax' && (
                <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground pointer-events-none">
                  {t('history.loadingWaveform')}
                </div>
              )}
              {!waveformsLoading && !hasChartData && view !== 'allmax' && (
                <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
                  {typeof view === 'number' ? t('history.noLoopWaveform') : t('history.noWaveform')}
                </div>
              )}
              {(view === 'all' || view === 'allcof') && (
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
      )}

      <ExportFilenameDialog
        pending={pendingExport}
        onOpenChange={(o) => { if (!o) setPendingExport(null) }}
      />
    </div>
  )
}
