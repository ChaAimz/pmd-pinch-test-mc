import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { api } from '@/lib/api'
import type { TestRun } from '@/lib/types'

const STATUS_COLORS: Record<string, string> = {
  pass:    'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  fail:    'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  aborted: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
  error:   'bg-red-200 text-red-900 dark:bg-red-800 dark:text-red-100',
  running: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
}

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge className={STATUS_COLORS[status] ?? 'bg-slate-100 text-slate-700'}>
      {status.toUpperCase()}
    </Badge>
  )
}

function fmt(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })
}

export default function History() {
  const [statusFilter, setStatusFilter] = useState<string>('all')

  const { data: runs = [], isLoading } = useQuery({
    queryKey: ['runs', statusFilter],
    queryFn: () => api.runs.list(statusFilter !== 'all' ? { status: statusFilter } : undefined),
    refetchInterval: 5000,
  })

  return (
    <div className="flex flex-col gap-4 max-w-5xl">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">History</h1>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v ?? 'all')}>
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="pass">Pass</SelectItem>
            <SelectItem value="fail">Fail</SelectItem>
            <SelectItem value="aborted">Aborted</SelectItem>
            <SelectItem value="error">Error</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : runs.length === 0 ? (
        <p className="text-muted-foreground text-sm">No runs found.</p>
      ) : (
        <div className="bg-card border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="text-xs text-muted-foreground uppercase">
                <th className="text-left px-4 py-2">Run ID</th>
                <th className="text-left px-4 py-2">Started</th>
                <th className="text-left px-4 py-2">Finished</th>
                <th className="text-left px-4 py-2">Status</th>
                <th className="text-left px-4 py-2">Loops</th>
                <th className="text-left px-4 py-2">Operator</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run: TestRun) => (
                <tr
                  key={run.id}
                  className="border-t hover:bg-muted/30 transition-colors"
                >
                  <td className="px-4 py-3 font-mono">
                    <Link to={`/history/${run.id}`} className="text-primary hover:underline">
                      #{run.id}
                    </Link>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{fmt(run.started_at)}</td>
                  <td className="px-4 py-3 font-mono text-xs">{fmt(run.finished_at)}</td>
                  <td className="px-4 py-3"><StatusBadge status={run.status} /></td>
                  <td className="px-4 py-3">{run.loops_completed}</td>
                  <td className="px-4 py-3 text-muted-foreground">{run.operator ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
