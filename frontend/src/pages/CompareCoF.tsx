import { useRef, useMemo } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { useQueries } from '@tanstack/react-query'
import { ArrowLeft, Download, ImageDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { api } from '@/lib/api'
import { CompareCofChart } from '@/components/CompareCofChart'
import type { RunCofSeries } from '@/components/CompareCofChart'
import type { TestRun } from '@/lib/types'

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

export default function CompareCoF() {
  const { t } = useTranslation()
  const [searchParams] = useSearchParams()
  const ids = (searchParams.get('ids') ?? '')
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !Number.isNaN(n) && n > 0)

  const runQueries = useQueries({
    queries: ids.map((id) => ({
      queryKey: ['run', id],
      queryFn: () => api.runs.get(id),
      enabled: true,
    })),
  })

  const isLoading = runQueries.some((q) => q.isLoading)
  const runs = runQueries.flatMap((q): TestRun[] => (q.data ? [q.data] : []))

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
      seriesList.push({ runId: run.id, label: `Run #${run.id}`, cofPerCycle })
    }

    // Pad shorter series with null so all have the same length
    for (const s of seriesList) {
      while (s.cofPerCycle.length < maxCycles) s.cofPerCycle.push(null)
    }

    return { series: seriesList, maxCycles }
  }, [runs])  // eslint-disable-line react-hooks/exhaustive-deps

  const exportRef = useRef<((filename: string) => void) | null>(null)
  const idStr = ids.join('-')

  function handleExportCsv() {
    if (!series.length || maxCycles === 0) return
    const header = ['cycle', ...series.map((s) => `run_${s.runId}_cof`)].join(',')
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
        <span className="text-sm text-muted-foreground">{t('compare.subtitle', { count: ids.length })}</span>
        <div className="ml-auto flex items-center gap-2">
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

      {/* Chart fills the rest */}
      <div className="bg-card border border-border rounded-xl p-3 flex-1 min-h-[280px] min-w-0">
        {isLoading ? (
          <Skeleton className="w-full h-full" />
        ) : series.length === 0 ? (
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
            {t('compare.noData')}
          </div>
        ) : (
          <CompareCofChart series={series} maxCycles={maxCycles} exportRef={exportRef} />
        )}
      </div>
    </div>
  )
}
