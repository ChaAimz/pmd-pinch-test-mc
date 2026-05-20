import { useRef, useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { api } from '@/lib/api'
import type { TestLoop, WaveformPoint } from '@/lib/types'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import React from 'react'

const STATUS_COLORS: Record<string, string> = {
  pass:    'bg-green-100 text-green-800',
  fail:    'bg-red-100 text-red-800',
  aborted: 'bg-amber-100 text-amber-800',
  error:   'bg-red-200 text-red-900',
  running: 'bg-blue-100 text-blue-800',
}

function fmt(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'medium' })
}

function LoopChart({ runId, loopIdx }: { runId: number; loopIdx: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const chartRef = useRef<uPlot | null>(null)

  const { data: points = [], isLoading } = useQuery({
    queryKey: ['waveform', runId, loopIdx],
    queryFn: () => api.runs.waveform(runId, loopIdx),
  })

  useEffect(() => {
    if (!ref.current || isLoading || points.length === 0) return

    const ts = points.map((p: WaveformPoint) => p.t_ms / 1000)
    const fs = points.map((p: WaveformPoint) => p.force_n)

    if (chartRef.current) {
      chartRef.current.setData([ts, fs])
      return
    }

    chartRef.current = new uPlot(
      {
        width: ref.current.clientWidth || 700,
        height: 220,
        series: [
          { label: 'Time (s)' },
          { label: 'Force (N)', stroke: 'oklch(0.55 0.22 240)', width: 2 },
        ],
        axes: [
          { label: 'ms' },
          { label: 'N' },
        ],
      },
      [ts, fs],
      ref.current
    )

    return () => {
      if (chartRef.current) {
        chartRef.current.destroy()
        chartRef.current = null
      }
    }
  }, [points, isLoading])

  if (isLoading) return <Skeleton className="h-[220px] w-full" />
  if (points.length === 0) return <p className="text-xs text-muted-foreground">No waveform data</p>

  return <div ref={ref} />
}

export default function HistoryDetail() {
  const { id } = useParams<{ id: string }>()
  const runId = Number(id)
  const [selectedLoop, setSelectedLoop] = useState<number | null>(null)

  const { data: run, isLoading } = useQuery({
    queryKey: ['run', runId],
    queryFn: () => api.runs.get(runId),
  })

  if (isLoading) {
    return (
      <div className="space-y-3 max-w-5xl">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (!run) return <p className="text-muted-foreground">Run not found.</p>

  return (
    <div className="flex flex-col gap-4 max-w-5xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link to="/history">
          <Button variant="ghost" size="sm" className="gap-1">
            <ArrowLeft size={14} /> Back
          </Button>
        </Link>
        <h1 className="text-xl font-semibold">Run #{run.id}</h1>
        <Badge className={STATUS_COLORS[run.status] ?? 'bg-slate-100'}>
          {run.status.toUpperCase()}
        </Badge>
        <a href={api.runs.exportCsvUrl(runId)} download>
          <Button variant="outline" size="sm" className="ml-auto gap-1">
            <Download size={14} /> Export CSV
          </Button>
        </a>
      </div>

      {/* Summary */}
      <div className="bg-card border rounded-lg p-4 grid grid-cols-3 gap-4 text-sm">
        <div><span className="text-muted-foreground">Started</span><div className="font-mono text-xs mt-0.5">{fmt(run.started_at)}</div></div>
        <div><span className="text-muted-foreground">Finished</span><div className="font-mono text-xs mt-0.5">{fmt(run.finished_at)}</div></div>
        <div><span className="text-muted-foreground">Loops completed</span><div className="font-mono mt-0.5">{run.loops_completed}</div></div>
        <div><span className="text-muted-foreground">Operator</span><div className="mt-0.5">{run.operator ?? '—'}</div></div>
        <div><span className="text-muted-foreground">Batch</span><div className="mt-0.5">{run.batch_id ?? '—'}</div></div>
        <div><span className="text-muted-foreground">Shift</span><div className="mt-0.5">{run.shift ?? '—'}</div></div>
      </div>

      {/* Loop table + chart */}
      {run.loops.length > 0 && (
        <div className="bg-card border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="text-xs text-muted-foreground uppercase">
                <th className="text-left px-4 py-2">Loop</th>
                <th className="text-left px-4 py-2">Judgment</th>
                <th className="text-left px-4 py-2">Peak (N)</th>
                <th className="text-left px-4 py-2">Avg (N)</th>
                <th className="text-left px-4 py-2">Hold (ms)</th>
                <th className="text-left px-4 py-2">Chart</th>
              </tr>
            </thead>
            <tbody>
              {run.loops.map((loop: TestLoop) => (
                <React.Fragment key={loop.id}>
                  <tr
                    className={`border-t cursor-pointer transition-colors ${selectedLoop === loop.loop_index ? 'bg-primary/5' : 'hover:bg-muted/30'}`}
                    onClick={() => setSelectedLoop(selectedLoop === loop.loop_index ? null : loop.loop_index)}
                  >
                    <td className="px-4 py-2 font-mono">{loop.loop_index}</td>
                    <td className="px-4 py-2">
                      <span className={`font-semibold ${loop.judgment === 'pass' ? 'text-green-600' : 'text-red-600'}`}>
                        {loop.judgment?.toUpperCase() ?? '—'}
                      </span>
                    </td>
                    <td className="px-4 py-2 font-mono">{loop.peak_force_n?.toFixed(1) ?? '—'}</td>
                    <td className="px-4 py-2 font-mono">{loop.avg_force_n?.toFixed(1) ?? '—'}</td>
                    <td className="px-4 py-2 font-mono">{loop.hold_time_ms ?? '—'}</td>
                    <td className="px-4 py-2 text-xs text-primary">
                      {selectedLoop === loop.loop_index ? '▲ hide' : '▼ show'}
                    </td>
                  </tr>
                  {selectedLoop === loop.loop_index && (
                    <tr>
                      <td colSpan={6} className="px-4 py-3 bg-muted/20">
                        <LoopChart runId={runId} loopIdx={loop.loop_index} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {run.loops.length === 0 && (
        <p className="text-xs text-muted-foreground">No loop data recorded for this run.</p>
      )}
    </div>
  )
}
