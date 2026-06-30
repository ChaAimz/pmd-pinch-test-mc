import { useRef, useMemo, useState, useEffect, useCallback } from 'react'
import { useSearchParams, Link, useNavigate } from 'react-router-dom'
import { useQueries, useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Download, ImageDown, Pencil, Plus, Save, Settings, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog'
import { api } from '@/lib/api'
import { CompareCofChart, SERIES_COLORS, ANNOTATION_COLORS, DEFAULT_CHART_CONFIG } from '@/components/CompareCofChart'
import type { RunCofSeries, Annotation } from '@/components/CompareCofChart'
import type { TestRun, Recipe, ChartConfig } from '@/lib/types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function downloadCsv(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function nowStamp() {
  const now = new Date()
  const date = now.toISOString().slice(0, 10).replace(/-/g, '')
  const time = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`
  return `${date}_${time}`
}

// ---------------------------------------------------------------------------
// Rename Dialog — inline, no separate file
// ---------------------------------------------------------------------------

type LabelMode = 'recipe' | 'runId' | 'custom'

interface RenameDialogProps {
  open: boolean
  onOpenChange: (v: boolean) => void
  runId: number
  recipeName: string | null | undefined
  currentLabel: string
  onSave: (label: string) => void
}

function RenameDialog({ open, onOpenChange, runId, recipeName, currentLabel, onSave }: RenameDialogProps) {
  const initialMode = (): LabelMode => {
    if (recipeName && currentLabel === recipeName) return 'recipe'
    if (currentLabel === `Run #${runId}`) return 'runId'
    return 'custom'
  }

  const [mode, setMode] = useState<LabelMode>(initialMode)
  const [customText, setCustomText] = useState<string>(
    initialMode() === 'custom' ? currentLabel : ''
  )

  const prevRunId = useRef<number | null>(null)
  if (prevRunId.current !== runId) {
    prevRunId.current = runId
    const m = initialMode()
    setMode(m)
    setCustomText(m === 'custom' ? currentLabel : '')
  }

  function effectiveLabel(): string {
    if (mode === 'recipe') return recipeName ?? `Run #${runId}`
    if (mode === 'runId') return `Run #${runId}`
    return customText.trim() || `Run #${runId}`
  }

  function handleSave() {
    onSave(effectiveLabel())
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton>
        <DialogHeader>
          <DialogTitle>Rename series</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3 py-1">
          {/* Option: Recipe name */}
          <label className={`flex items-center gap-3 cursor-pointer rounded-lg px-3 py-2 border transition-colors ${mode === 'recipe' ? 'border-ring bg-accent' : 'border-transparent hover:bg-muted/50'}`}>
            <input
              type="radio"
              className="accent-primary"
              checked={mode === 'recipe'}
              onChange={() => setMode('recipe')}
              disabled={!recipeName}
            />
            <span className={`flex-1 text-sm ${!recipeName ? 'text-muted-foreground' : ''}`}>
              Recipe name
            </span>
            <span className="text-sm font-mono text-muted-foreground truncate max-w-[140px]">
              {recipeName ?? <em className="not-italic opacity-50">loading…</em>}
            </span>
          </label>

          {/* Option: Run ID */}
          <label className={`flex items-center gap-3 cursor-pointer rounded-lg px-3 py-2 border transition-colors ${mode === 'runId' ? 'border-ring bg-accent' : 'border-transparent hover:bg-muted/50'}`}>
            <input
              type="radio"
              className="accent-primary"
              checked={mode === 'runId'}
              onChange={() => setMode('runId')}
            />
            <span className="flex-1 text-sm">Run ID</span>
            <span className="text-sm font-mono text-muted-foreground">Run #{runId}</span>
          </label>

          {/* Option: Custom */}
          <label className={`flex items-center gap-3 cursor-pointer rounded-lg px-3 py-2 border transition-colors ${mode === 'custom' ? 'border-ring bg-accent' : 'border-transparent hover:bg-muted/50'}`}>
            <input
              type="radio"
              className="accent-primary"
              checked={mode === 'custom'}
              onChange={() => setMode('custom')}
            />
            <span className="text-sm shrink-0">Custom</span>
            <Input
              className="h-7 text-sm"
              placeholder="Enter label…"
              value={customText}
              disabled={mode !== 'custom'}
              onChange={(e) => setCustomText(e.target.value)}
              onFocus={() => setMode('custom')}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSave() }}
            />
          </label>
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" size="sm" />}>
            Cancel
          </DialogClose>
          <Button size="sm" onClick={handleSave}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Save Comparison Dialog
// ---------------------------------------------------------------------------

interface SaveDialogProps {
  open: boolean
  onOpenChange: (v: boolean) => void
  initialName: string
  initialDescription: string
  onSave: (name: string, description: string) => void
  isPending: boolean
}

function SaveDialog({ open, onOpenChange, initialName, initialDescription, onSave, isPending }: SaveDialogProps) {
  const [name, setName] = useState(initialName)
  const [description, setDescription] = useState(initialDescription)

  // Sync when initial values change (e.g. when loaded comparison hydrates)
  useEffect(() => {
    if (open) {
      setName(initialName)
      setDescription(initialDescription)
    }
  }, [open, initialName, initialDescription])

  function handleSave() {
    if (!name.trim()) return
    onSave(name.trim(), description.trim())
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton>
        <DialogHeader>
          <DialogTitle>Save Comparison</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3 py-1">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">Name <span className="text-destructive">*</span></label>
            <Input
              placeholder="e.g. Batch A vs B"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSave() }}
              autoFocus
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-muted-foreground">Description <span className="text-xs font-normal">(optional)</span></label>
            <Input
              placeholder="Optional notes…"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSave() }}
            />
          </div>
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" size="sm" />}>
            Cancel
          </DialogClose>
          <Button size="sm" onClick={handleSave} disabled={!name.trim() || isPending}>
            {isPending ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Chart Settings Popover
// ---------------------------------------------------------------------------

interface ChartSettingsPanelProps {
  config: ChartConfig
  onChange: (updater: (c: ChartConfig) => ChartConfig) => void
  t: (key: string) => string
}

function ChartSettingsPanel({ config: cfg, onChange, t }: ChartSettingsPanelProps) {
  function set<K extends keyof ChartConfig>(key: K, value: ChartConfig[K]) {
    onChange((c) => ({ ...c, [key]: value }))
  }

  function parseNullableNumber(raw: string): number | null {
    return raw === '' ? null : Number(raw)
  }

  const inputCls = 'h-7 w-20 text-sm'

  return (
    <div className="flex flex-col gap-3 max-h-[70vh] overflow-y-auto px-0.5">
      {/* Y-Axis */}
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        {t('compare.chart.yAxis')}
      </p>
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm">{t('compare.chart.yMin')}</span>
          <Input
            type="number"
            className={inputCls}
            placeholder="auto"
            value={cfg.yMin ?? ''}
            onChange={(e) => set('yMin', parseNullableNumber(e.target.value))}
          />
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm">{t('compare.chart.yMax')}</span>
          <Input
            type="number"
            className={inputCls}
            placeholder="auto"
            value={cfg.yMax ?? ''}
            onChange={(e) => set('yMax', parseNullableNumber(e.target.value))}
          />
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm">{t('compare.chart.showGrid')}</span>
          <Switch
            size="sm"
            checked={cfg.showYGrid}
            onCheckedChange={(v) => set('showYGrid', v)}
          />
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm">{t('compare.chart.yLabelGap')}</span>
          <Input
            type="number"
            className={inputCls}
            value={cfg.yNameGap}
            onChange={(e) => set('yNameGap', Number(e.target.value))}
          />
        </div>
      </div>

      <div className="border-t border-border" />

      {/* X-Axis */}
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        {t('compare.chart.xAxis')}
      </p>
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm">{t('compare.chart.xLabelInterval')}</span>
          <Input
            type="number"
            className={inputCls}
            placeholder="auto"
            value={cfg.xLabelInterval ?? ''}
            onChange={(e) => set('xLabelInterval', parseNullableNumber(e.target.value))}
          />
        </div>
      </div>

      <div className="border-t border-border" />

      {/* Line */}
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        {t('compare.chart.line')}
      </p>
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm">{t('compare.chart.lineWidth')}</span>
          <Input
            type="number"
            className={inputCls}
            min={0.5}
            step={0.5}
            value={cfg.lineWidth}
            onChange={(e) => set('lineWidth', Number(e.target.value))}
          />
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm">{t('compare.chart.symbolSize')}</span>
          <Input
            type="number"
            className={inputCls}
            min={0}
            value={cfg.symbolSize}
            onChange={(e) => set('symbolSize', Number(e.target.value))}
          />
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm">{t('compare.chart.showSymbols')}</span>
          <Switch
            size="sm"
            checked={cfg.showSymbol}
            onCheckedChange={(v) => set('showSymbol', v)}
          />
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm">{t('compare.chart.smooth')}</span>
          <Switch
            size="sm"
            checked={cfg.smooth}
            onCheckedChange={(v) => set('smooth', v)}
          />
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm">{t('compare.chart.connectGaps')}</span>
          <Switch
            size="sm"
            checked={cfg.connectNulls}
            onCheckedChange={(v) => set('connectNulls', v)}
          />
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm">{t('compare.chart.valueLabels')}</span>
          <Switch
            size="sm"
            checked={cfg.showValueLabels}
            onCheckedChange={(v) => set('showValueLabels', v)}
          />
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm">{t('compare.chart.decimals')}</span>
          <Input
            type="number"
            className={inputCls}
            min={0}
            max={8}
            value={cfg.decimals}
            onChange={(e) => set('decimals', Number(e.target.value))}
          />
        </div>
      </div>

      <div className="border-t border-border" />

      {/* Annotations */}
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        {t('compare.chart.annotations')}
      </p>
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm">{t('compare.chart.markerSize')}</span>
          <Input
            type="number"
            className={inputCls}
            min={4}
            value={cfg.annotationSymbolSize}
            onChange={(e) => set('annotationSymbolSize', Number(e.target.value))}
          />
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm">{t('compare.chart.labelSize')}</span>
          <Input
            type="number"
            className={inputCls}
            min={6}
            value={cfg.annotationFontSize}
            onChange={(e) => set('annotationFontSize', Number(e.target.value))}
          />
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm">{t('compare.chart.showLabels')}</span>
          <Switch
            size="sm"
            checked={cfg.showAnnotationLabels}
            onCheckedChange={(v) => set('showAnnotationLabels', v)}
          />
        </div>
      </div>

      <div className="border-t border-border pt-1">
        <Button
          variant="outline"
          size="sm"
          className="w-full h-7 text-xs"
          onClick={() => onChange(() => DEFAULT_CHART_CONFIG)}
        >
          {t('compare.chart.resetDefaults')}
        </Button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function CompareCoF() {
  const { t } = useTranslation()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  // Parse saved comparison id from URL (?saved=123)
  const savedIdStr = searchParams.get('saved')
  const savedId = savedIdStr != null ? parseInt(savedIdStr, 10) : null

  // Parse raw run ids from URL (?ids=1,2,3)
  const idsFromUrl = (searchParams.get('ids') ?? '')
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !Number.isNaN(n) && n > 0)

  // --- Load saved comparison (when ?saved= is present) ---
  const { data: savedComparison } = useQuery({
    queryKey: ['comparison', savedId],
    queryFn: () => api.comparisons.get(savedId!),
    enabled: savedId != null && !Number.isNaN(savedId),
  })

  // Resolve effective run IDs: saved comparison takes priority over ?ids=
  const ids = savedComparison ? savedComparison.run_ids : idsFromUrl

  // --- Run data ---
  const runQueries = useQueries({
    queries: ids.map((id) => ({
      queryKey: ['run', id],
      queryFn: () => api.runs.get(id),
      enabled: true,
    })),
  })

  const isLoading = runQueries.some((q) => q.isLoading)
  const runs = runQueries.flatMap((q): TestRun[] => (q.data ? [q.data] : []))

  // --- Recipe data (for default labels) ---
  const recipeIds = useMemo(
    () => Array.from(new Set(runs.map((r) => r.recipe_id))),
    [runs]
  )
  const recipeQueries = useQueries({
    queries: recipeIds.map((recipeId) => ({
      queryKey: ['recipe', recipeId],
      queryFn: () => api.recipes.get(recipeId),
      staleTime: 60_000,
    })),
  })

  const recipeMap = useMemo(() => {
    const m: Record<number, Recipe> = {}
    for (const q of recipeQueries) {
      if (q.data) m[q.data.id] = q.data
    }
    return m
  }, [recipeQueries])

  // --- Label overrides ---
  const [labelOverrides, setLabelOverrides] = useState<Record<number, string>>({})
  const [editingRunId, setEditingRunId] = useState<number | null>(null)

  // Default label is the Run ID. Recipe name is still offered as a choice in the
  // rename dialog, but it is no longer the default.
  function effectiveLabelFor(run: TestRun): string {
    if (labelOverrides[run.id] != null) return labelOverrides[run.id]
    return `Run #${run.id}`
  }

  // --- Hidden series (legend toggle) — keyed by runId, since display labels
  // can collide when comparing repeats of the same recipe. ---
  const [hiddenSeries, setHiddenSeries] = useState<Set<number>>(new Set())

  // --- Annotations ---
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [annotationMode, setAnnotationMode] = useState(false)
  const [pendingAnnotation, setPendingAnnotation] = useState<{ cycleIndex: number; yValue: number } | null>(null)
  const [pendingText, setPendingText] = useState('')
  const [pendingColor, setPendingColor] = useState(ANNOTATION_COLORS[0])

  // --- Chart config ---
  const [chartConfig, setChartConfig] = useState<ChartConfig>(DEFAULT_CHART_CONFIG)

  // Hydrate state once when a saved comparison loads.
  // Guard with a ref so user edits after load aren't clobbered on re-renders.
  const hydratedIdRef = useRef<number | null>(null)
  useEffect(() => {
    if (!savedComparison) return
    if (hydratedIdRef.current === savedComparison.id) return
    hydratedIdRef.current = savedComparison.id

    // Convert string-keyed labels → number-keyed
    const converted: Record<number, string> = Object.fromEntries(
      Object.entries(savedComparison.labels).map(([k, v]) => [Number(k), v])
    )
    setLabelOverrides(converted)
    setAnnotations(savedComparison.annotations)
    setChartConfig(savedComparison.chart_config ?? DEFAULT_CHART_CONFIG)
  }, [savedComparison])

  // --- Save dialog state ---
  const [saveDialogOpen, setSaveDialogOpen] = useState(false)

  const saveMutation = useMutation({
    mutationFn: async ({ name, description }: { name: string; description: string }) => {
      const payload = {
        name,
        description: description || null,
        run_ids: ids,
        labels: Object.fromEntries(
          Object.entries(labelOverrides).map(([k, v]) => [String(k), v])
        ),
        annotations,
        chart_config: chartConfig,
      }
      if (savedId != null) {
        return api.comparisons.update(savedId, payload)
      } else {
        return api.comparisons.create(payload)
      }
    },
    onSuccess: (result) => {
      toast.success(t('compare.saveSuccess'))
      queryClient.invalidateQueries({ queryKey: ['comparisons'] })
      setSaveDialogOpen(false)
      // If this was a new save, navigate to the saved URL so subsequent saves update it
      if (savedId == null && result && 'id' in result) {
        navigate(`/history/compare?saved=${result.id}`, { replace: true })
      } else if (savedId != null) {
        // Refresh the cached comparison data
        queryClient.invalidateQueries({ queryKey: ['comparison', savedId] })
      }
    },
    onError: (e: Error) => {
      toast.error(e.message)
    },
  })

  function handleSaveComparison(name: string, description: string) {
    saveMutation.mutate({ name, description })
  }

  // Esc to cancel annotation mode
  useEffect(() => {
    if (!annotationMode) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setAnnotationMode(false)
        setPendingAnnotation(null)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [annotationMode])

  const handleChartClick = useCallback((cycleIndex: number, yValue: number) => {
    setPendingAnnotation({ cycleIndex, yValue })
    setPendingText('')
    setPendingColor(ANNOTATION_COLORS[0])
    setAnnotationMode(false)
  }, [])

  function handleSavePendingAnnotation() {
    if (!pendingAnnotation || !pendingText.trim()) return
    const annotation: Annotation = {
      id: String(Date.now()),
      cycleIndex: pendingAnnotation.cycleIndex,
      yValue: pendingAnnotation.yValue,
      text: pendingText.trim(),
      color: pendingColor,
    }
    setAnnotations((prev) => [...prev, annotation])
    setPendingAnnotation(null)
    setPendingText('')
  }

  function handleDeleteAnnotation(id: string) {
    setAnnotations((prev) => prev.filter((a) => a.id !== id))
  }

  // --- Build series ---
  const { series, maxCycles } = useMemo(() => {
    let maxCycles = 0
    const seriesList: RunCofSeries[] = []

    for (const run of runs) {
      const loops = run.loops ?? []
      const cofPerCycle: (number | null)[] = loops.map((l) => {
        if (l.peak_force_n == null || l.avg_clamp_n == null || l.avg_clamp_n === 0) return null
        return l.peak_force_n / l.avg_clamp_n
      })
      if (cofPerCycle.length > maxCycles) maxCycles = cofPerCycle.length
      const recipe = recipeMap[run.recipe_id]
      seriesList.push({
        runId: run.id,
        label: effectiveLabelFor(run),
        recipeName: recipe?.name ?? null,
        cofPerCycle,
      })
    }

    for (const s of seriesList) {
      while (s.cofPerCycle.length < maxCycles) s.cofPerCycle.push(null)
    }

    return { series: seriesList, maxCycles }
  }, [runs, recipeMap, labelOverrides]) // eslint-disable-line react-hooks/exhaustive-deps

  // --- Export ---
  const exportRef = useRef<((filename: string) => void) | null>(null)
  const idStr = ids.join('-')

  function handleExportCsv() {
    if (!series.length || maxCycles === 0) return
    const slugLabel = (s: RunCofSeries) =>
      s.label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') + '_cof'
    const header = ['cycle', ...series.map(slugLabel)].join(',')
    const rows = Array.from({ length: maxCycles }, (_, i) => {
      const vals = series.map((s) => {
        const v = s.cofPerCycle[i]
        return v != null ? v.toFixed(4) : ''
      })
      return [`C${i + 1}`, ...vals].join(',')
    })
    downloadCsv(`compare_cof_${idStr}_${nowStamp()}.csv`, [header, ...rows].join('\n'))
  }

  function handleExportPng() {
    exportRef.current?.(`compare_cof_${idStr}_${nowStamp()}.png`)
  }

  // --- Series legend toggle ---
  function toggleSeries(runId: number) {
    setHiddenSeries((prev) => {
      const next = new Set(prev)
      if (next.has(runId)) {
        next.delete(runId)
      } else {
        next.add(runId)
      }
      return next
    })
  }

  const editingRun = editingRunId != null ? runs.find((r) => r.id === editingRunId) : undefined

  return (
    <div className="flex flex-col gap-4 w-full h-full min-h-0">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap shrink-0">
        <Link to="/history">
          <Button variant="ghost" size="sm" className="gap-1">
            <ArrowLeft size={14} /> {t('common.back')}
          </Button>
        </Link>
        <h1 className="text-xl font-semibold">{t('compare.title')}</h1>
        {savedComparison && (
          <span className="text-sm font-medium text-muted-foreground">
            — {savedComparison.name}
          </span>
        )}
        <span className="text-sm text-muted-foreground">{t('compare.subtitle', { count: ids.length })}</span>
        <div className="ml-auto flex items-center gap-2">
          {/* Chart Settings */}
          <Popover>
            <PopoverTrigger
              render={
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1"
                  disabled={!series.length || isLoading}
                  aria-label={t('compare.chartSettings')}
                >
                  <Settings size={14} />
                  {t('compare.chartSettings')}
                </Button>
              }
            />
            <PopoverContent side="bottom" align="end" className="w-72 p-3">
              <p className="text-sm font-semibold mb-3">{t('compare.chartSettings')}</p>
              <ChartSettingsPanel
                config={chartConfig}
                onChange={setChartConfig}
                t={t}
              />
            </PopoverContent>
          </Popover>

          <Button
            variant="outline"
            size="sm"
            className="gap-1"
            onClick={() => setSaveDialogOpen(true)}
            disabled={ids.length === 0 || isLoading}
          >
            <Save size={14} /> {t('compare.save')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1"
            onClick={handleExportCsv}
            disabled={!series.length || isLoading}
          >
            <Download size={14} /> {t('run.exportCSV')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1"
            onClick={handleExportPng}
            disabled={!series.length || isLoading}
          >
            <ImageDown size={14} /> {t('run.exportPNG')}
          </Button>
        </div>
      </div>

      {/* Chart + Legend Card row */}
      <div className="flex flex-row gap-4 flex-1 min-h-0">
        {/* Chart card */}
        <div className="bg-card border border-border rounded-xl p-3 flex-1 min-h-[280px] min-w-0 flex flex-col">
          {isLoading ? (
            <Skeleton className="w-full flex-1" />
          ) : series.length === 0 ? (
            <div className="flex items-center justify-center flex-1 text-sm text-muted-foreground">
              {t('compare.noData')}
            </div>
          ) : (
            <div className="flex-1 min-h-0 flex flex-col">
              <div className="flex-1 min-h-0">
                <CompareCofChart
                  series={series}
                  maxCycles={maxCycles}
                  exportRef={exportRef}
                  annotations={annotations}
                  annotationMode={annotationMode}
                  onChartClick={handleChartClick}
                  hiddenSeries={hiddenSeries}
                  config={chartConfig}
                />
              </div>
              {annotationMode && (
                <p className="text-xs text-amber-500 text-center mt-1 shrink-0">
                  Click on chart to place annotation — Esc to cancel
                </p>
              )}
            </div>
          )}
        </div>

        {/* Legend Card — only when data is ready */}
        {!isLoading && series.length > 0 && (
          <div className="bg-card border border-border rounded-xl p-4 w-56 shrink-0 flex flex-col gap-4 overflow-y-auto">
            {/* Series section */}
            <div className="flex flex-col gap-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Series
              </p>
              {series.map((s, i) => {
                const isHidden = hiddenSeries.has(s.runId)
                return (
                  <div
                    key={s.runId}
                    className={`flex items-center gap-2 rounded-lg px-2 py-1.5 cursor-pointer hover:bg-muted/50 transition-colors group ${isHidden ? 'opacity-40' : ''}`}
                    onClick={() => toggleSeries(s.runId)}
                    title={isHidden ? 'Click to show' : 'Click to hide'}
                  >
                    {/* Color swatch */}
                    <span
                      className="inline-block rounded-full shrink-0"
                      style={{
                        width: 12,
                        height: 12,
                        backgroundColor: SERIES_COLORS[i % SERIES_COLORS.length],
                      }}
                    />
                    <span className={`flex-1 text-sm truncate ${isHidden ? 'line-through' : ''}`}>
                      {s.label}
                    </span>
                    <button
                      className="text-muted-foreground hover:text-foreground transition-colors opacity-0 group-hover:opacity-100 shrink-0"
                      onClick={(e) => {
                        e.stopPropagation()
                        setEditingRunId(s.runId)
                      }}
                      title="Rename series"
                      aria-label={`Rename ${s.label}`}
                    >
                      <Pencil size={11} />
                    </button>
                  </div>
                )
              })}
            </div>

            {/* Divider */}
            <div className="border-t border-border" />

            {/* Annotations section */}
            <div className="flex flex-col gap-2 flex-1">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Annotations
                </p>
                <button
                  className={`flex items-center gap-1 text-xs px-1.5 py-0.5 rounded transition-colors ${
                    annotationMode
                      ? 'text-amber-500 bg-amber-500/10'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                  onClick={() => {
                    if (annotationMode) {
                      setAnnotationMode(false)
                    } else {
                      setPendingAnnotation(null)
                      setAnnotationMode(true)
                    }
                  }}
                  title={annotationMode ? 'Cancel (Esc)' : 'Click chart to place annotation'}
                >
                  <Plus size={11} />
                  {annotationMode ? 'Cancel' : 'Add note'}
                </button>
              </div>

              {/* Pending annotation inline form */}
              {pendingAnnotation != null && (
                <div className="flex flex-col gap-2 rounded-lg bg-muted/30 border border-border px-2.5 py-2">
                  <p className="text-xs text-muted-foreground">
                    C{pendingAnnotation.cycleIndex + 1} · {pendingAnnotation.yValue.toFixed(3)}
                  </p>
                  <Input
                    className="h-7 text-xs"
                    placeholder="Note text…"
                    value={pendingText}
                    onChange={(e) => setPendingText(e.target.value)}
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSavePendingAnnotation()
                      if (e.key === 'Escape') setPendingAnnotation(null)
                    }}
                  />
                  <div className="flex items-center gap-1.5">
                    {ANNOTATION_COLORS.map((c) => (
                      <button
                        key={c}
                        className={`w-4 h-4 rounded-full border-2 transition-transform ${pendingColor === c ? 'border-foreground scale-110' : 'border-transparent'}`}
                        style={{ backgroundColor: c }}
                        onClick={() => setPendingColor(c)}
                        aria-label={`Color ${c}`}
                      />
                    ))}
                  </div>
                  <div className="flex gap-1.5">
                    <Button
                      size="sm"
                      className="h-6 px-2 text-xs flex-1"
                      onClick={handleSavePendingAnnotation}
                      disabled={!pendingText.trim()}
                    >
                      Save
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-xs"
                      onClick={() => setPendingAnnotation(null)}
                    >
                      <X size={11} />
                    </Button>
                  </div>
                </div>
              )}

              {/* Annotation list */}
              {annotations.length === 0 && pendingAnnotation == null ? (
                <p className="text-xs text-muted-foreground italic">No annotations yet.</p>
              ) : (
                <div className="flex flex-col gap-1">
                  {annotations.map((a) => (
                    <div
                      key={a.id}
                      className="flex items-center gap-1.5 text-xs rounded px-1.5 py-1 hover:bg-muted/30"
                    >
                      <span
                        className="inline-block w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: a.color }}
                      />
                      <span className="font-mono text-muted-foreground shrink-0">
                        C{a.cycleIndex + 1}
                      </span>
                      <span className="flex-1 truncate">{a.text}</span>
                      <button
                        className="text-muted-foreground hover:text-destructive transition-colors shrink-0"
                        onClick={() => handleDeleteAnnotation(a.id)}
                        aria-label={`Delete annotation: ${a.text}`}
                      >
                        <X size={11} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Rename series dialog */}
      {editingRun != null && (
        <RenameDialog
          open={editingRunId != null}
          onOpenChange={(v) => { if (!v) setEditingRunId(null) }}
          runId={editingRun.id}
          recipeName={recipeMap[editingRun.recipe_id]?.name ?? null}
          currentLabel={effectiveLabelFor(editingRun)}
          onSave={(label) => {
            setLabelOverrides((prev) => ({ ...prev, [editingRun.id]: label }))
            setEditingRunId(null)
          }}
        />
      )}

      {/* Save comparison dialog */}
      <SaveDialog
        open={saveDialogOpen}
        onOpenChange={setSaveDialogOpen}
        initialName={savedComparison?.name ?? ''}
        initialDescription={savedComparison?.description ?? ''}
        onSave={handleSaveComparison}
        isPending={saveMutation.isPending}
      />
    </div>
  )
}
