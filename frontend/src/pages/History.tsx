import { useState, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useVirtualizer } from '@tanstack/react-virtual'
import { BarChart2, BookOpen, Download, Search, Trash2, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { KeyboardInput } from '@/components/ui/keyboard-input'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { Comparison, Recipe, TestRun } from '@/lib/types'

type DeleteTarget = { type: 'single'; id: number } | { type: 'bulk'; ids: number[] }

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

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { dateStyle: 'short' })
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-GB', { timeStyle: 'short' })
}

function fmtDateTime(iso: string) {
  return `${fmtDate(iso)} ${fmtTime(iso)}`
}

// ---------------------------------------------------------------------------
// Saved Comparisons Tab
// ---------------------------------------------------------------------------

function SavedComparisonsTab() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null)

  const { data: comparisons = [], isLoading } = useQuery({
    queryKey: ['comparisons'],
    queryFn: () => api.comparisons.list(),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.comparisons.delete(id),
    onSuccess: (_data, id) => {
      toast.success(t('history.comparisons.toastDeleted', { id }))
      queryClient.invalidateQueries({ queryKey: ['comparisons'] })
    },
    onError: () => toast.error(t('history.comparisons.toastDeleteFailed')),
  })

  function confirmDelete() {
    if (deleteTarget == null) return
    deleteMutation.mutate(deleteTarget)
    setDeleteTarget(null)
  }

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    )
  }

  if ((comparisons as Comparison[]).length === 0) {
    return (
      <div className="bg-card border border-border rounded-xl p-8 flex items-center justify-center">
        <p className="text-sm text-muted-foreground">{t('history.comparisons.empty')}</p>
      </div>
    )
  }

  return (
    <>
      <div className="bg-card border border-border rounded-xl overflow-auto flex-1 min-h-0">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-muted/90 backdrop-blur-sm">
            <TableRow className="text-xs text-muted-foreground uppercase">
              <TableHead className="text-left px-4 py-2">{t('history.comparisons.name')}</TableHead>
              <TableHead className="text-left px-4 py-2">{t('history.comparisons.description')}</TableHead>
              <TableHead className="text-left px-4 py-2">{t('history.comparisons.runs')}</TableHead>
              <TableHead className="text-left px-4 py-2">{t('history.comparisons.updated')}</TableHead>
              <TableHead className="text-right px-4 py-2">{t('history.actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(comparisons as Comparison[]).map((c) => (
              <TableRow
                key={c.id}
                className="cursor-pointer hover:bg-muted/30 transition-colors"
                onClick={() => navigate(`/history/compare?saved=${c.id}`)}
              >
                <TableCell className="px-4 py-3 font-medium">{c.name}</TableCell>
                <TableCell className="px-4 py-3 text-sm text-muted-foreground">
                  {c.description ?? <span className="italic opacity-50">—</span>}
                </TableCell>
                <TableCell className="px-4 py-3 font-mono text-sm">
                  {c.run_ids.length}
                </TableCell>
                <TableCell className="px-4 py-3 font-mono text-xs text-muted-foreground">
                  {fmtDateTime(c.updated_at)}
                </TableCell>
                <TableCell className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1"
                      onClick={() => navigate(`/history/compare?saved=${c.id}`)}
                    >
                      <BookOpen size={13} /> {t('history.comparisons.open')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDeleteTarget(c.id)}
                      disabled={deleteMutation.isPending}
                    >
                      <Trash2 size={13} className="text-red-500" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('history.comparisons.deleteDialog.title')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('history.comparisons.deleteDialog.description')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={confirmDelete}
            >
              {t('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

// ---------------------------------------------------------------------------
// Main History page
// ---------------------------------------------------------------------------

export default function History() {
  const { t } = useTranslation()
  const [tab, setTab] = useState<'runs' | 'comparisons'>('runs')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null)
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const parentRef = useRef<HTMLDivElement>(null)

  const { data: runs = [], isLoading } = useQuery({
    queryKey: ['runs', statusFilter],
    queryFn: () => api.runs.list(statusFilter !== 'all' ? { status: statusFilter } : undefined),
    refetchInterval: 5000,
  })

  const { data: recipes = [] } = useQuery({
    queryKey: ['recipes'],
    queryFn: () => api.recipes.list(),
    staleTime: 60_000,
  })
  const recipeMap = useMemo(
    () => new Map<number, string>((recipes as Recipe[]).map((r) => [r.id, r.name])),
    [recipes]
  )

  const filteredRuns = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return runs as TestRun[]
    return (runs as TestRun[]).filter((run) => {
      const recipeName = recipeMap.get(run.recipe_id) ?? ''
      return (
        String(run.id).includes(q) ||
        recipeName.toLowerCase().includes(q) ||
        fmtDate(run.started_at).includes(q) ||
        run.status.includes(q) ||
        String(run.loops_completed).includes(q) ||
        (run.operator ?? '').toLowerCase().includes(q) ||
        (run.batch_id ?? '').toLowerCase().includes(q)
      )
    })
  }, [runs, search, recipeMap])

  // Selection helpers
  const visibleSelected = useMemo(
    () => filteredRuns.filter((r) => selectedIds.has(r.id)),
    [filteredRuns, selectedIds]
  )
  const allSelected = filteredRuns.length > 0 && visibleSelected.length === filteredRuns.length
  const someSelected = visibleSelected.length > 0 && !allSelected

  function toggleAll() {
    if (allSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev)
        filteredRuns.forEach((r) => next.delete(r.id))
        return next
      })
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev)
        filteredRuns.forEach((r) => next.add(r.id))
        return next
      })
    }
  }

  function toggleRow(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  // Virtualizer
  const rowVirtualizer = useVirtualizer({
    count: filteredRuns.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 60,
    overscan: 8,
  })

  const virtualItems = rowVirtualizer.getVirtualItems()
  const paddingTop = virtualItems.length > 0 ? virtualItems[0].start : 0
  const paddingBottom =
    virtualItems.length > 0
      ? rowVirtualizer.getTotalSize() - virtualItems[virtualItems.length - 1].end
      : 0

  // Single delete
  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.runs.delete(id),
    onSuccess: (_data, id) => {
      toast.success(t('history.toastDeleted', { id }))
      setSelectedIds((prev) => { const n = new Set(prev); n.delete(id); return n })
      queryClient.invalidateQueries({ queryKey: ['runs'] })
    },
    onError: () => toast.error(t('history.toastDeleteFailed')),
  })

  // Bulk delete
  const bulkDeleteMutation = useMutation({
    mutationFn: (ids: number[]) => Promise.all(ids.map((id) => api.runs.delete(id))),
    onSuccess: (_data, ids) => {
      toast.success(t('history.toastDeletedBulk', { count: ids.length }))
      setSelectedIds(new Set())
      queryClient.invalidateQueries({ queryKey: ['runs'] })
    },
    onError: () => toast.error(t('history.toastBulkFailed')),
  })

  function handleBulkDelete() {
    setDeleteTarget({ type: 'bulk', ids: visibleSelected.map((r) => r.id) })
  }

  function confirmDelete() {
    if (!deleteTarget) return
    if (deleteTarget.type === 'single') {
      deleteMutation.mutate(deleteTarget.id)
    } else {
      bulkDeleteMutation.mutate(deleteTarget.ids)
    }
    setDeleteTarget(null)
  }

  const deleteLabel =
    deleteTarget?.type === 'bulk'
      ? t('history.runCount', { count: deleteTarget.ids.length })
      : deleteTarget
      ? t('history.runLabel', { id: deleteTarget.id })
      : ''

  return (
    <div className="flex flex-col gap-4 w-full h-full">
      {/* Tab switcher */}
      <div className="flex items-center gap-1 border-b border-border shrink-0">
        <button
          className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
            tab === 'runs'
              ? 'border-primary text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
          onClick={() => setTab('runs')}
        >
          {t('history.tabs.runs')}
        </button>
        <button
          className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
            tab === 'comparisons'
              ? 'border-primary text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
          onClick={() => setTab('comparisons')}
        >
          {t('history.tabs.comparisons')}
        </button>
      </div>

      {tab === 'runs' && (
        <>
          {/* toolbar */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground z-10 pointer-events-none" />
              <KeyboardInput
                placeholder={t('history.searchPlaceholder')}
                value={search}
                onChange={setSearch}
                title={t('history.searchPlaceholder')}
                className={`pl-8 ${search ? 'pr-8' : ''}`}
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground rounded z-10"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            {!isLoading && (
              <Badge
                className={`shrink-0 tabular-nums px-3 py-1 text-sm font-medium ${
                  filteredRuns.length === 0
                    ? 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200'
                    : 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
                }`}
              >
                {t('history.runCount', { count: filteredRuns.length })}
              </Badge>
            )}

            {/* Select All */}
            {!isLoading && filteredRuns.length > 0 && (
              <label className="flex items-center gap-2 shrink-0 cursor-pointer select-none text-sm text-muted-foreground hover:text-foreground transition-colors">
                <Checkbox
                  checked={allSelected}
                  indeterminate={someSelected}
                  onCheckedChange={toggleAll}
                />
                {t('history.selectAll')}
              </label>
            )}

            {/* Selected count + bulk delete — appears when something is selected */}
            {visibleSelected.length > 0 && (
              <>
                <Badge className="shrink-0 tabular-nums px-3 py-1 text-sm font-medium bg-primary/10 text-primary">
                  {t('history.selected', { count: visibleSelected.length })}
                </Badge>
                {visibleSelected.length >= 2 && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0 gap-1.5"
                    onClick={() => {
                      const ids = visibleSelected.map((r) => r.id).join(',')
                      navigate(`/history/compare?ids=${ids}`)
                    }}
                  >
                    <BarChart2 size={13} />
                    {t('history.compareCoF')}
                  </Button>
                )}
                <Button
                  variant="destructive"
                  size="sm"
                  className="shrink-0 gap-1.5"
                  disabled={bulkDeleteMutation.isPending}
                  onClick={handleBulkDelete}
                >
                  <Trash2 size={13} />
                  {t('common.delete')}
                </Button>
              </>
            )}

            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v ?? 'all')}>
              <SelectTrigger className="w-36 shrink-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('common.all')}</SelectItem>
                <SelectItem value="pass">{t('common.pass')}</SelectItem>
                <SelectItem value="fail">{t('common.fail')}</SelectItem>
                <SelectItem value="aborted">{t('common.aborted')}</SelectItem>
                <SelectItem value="error">{t('common.error')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : filteredRuns.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t('history.noRuns')}</p>
          ) : (
            <div
              ref={parentRef}
              className="bg-card border border-border rounded-xl overflow-auto flex-1 min-h-0"
            >
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-muted/90 backdrop-blur-sm">
                  <TableRow className="text-xs text-muted-foreground uppercase">
                    <TableHead className="w-10 px-4 py-2" />
                    <TableHead className="text-left px-4 py-2">{t('history.runId')}</TableHead>
                    <TableHead className="text-left px-4 py-2">{t('history.recipe')}</TableHead>
                    <TableHead className="text-left px-4 py-2">{t('history.dateTime')}</TableHead>
                    <TableHead className="text-left px-4 py-2">{t('history.loops')}</TableHead>
                    <TableHead className="text-left px-4 py-2">{t('history.operator')}</TableHead>
                    <TableHead className="text-right px-4 py-2">{t('history.actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paddingTop > 0 && (
                    <TableRow>
                      <TableCell colSpan={7} style={{ height: paddingTop }} className="p-0 border-0" />
                    </TableRow>
                  )}
                  {virtualItems.map((vRow) => {
                    const run = filteredRuns[vRow.index]
                    const isSelected = selectedIds.has(run.id)
                    return (
                      <TableRow
                        key={run.id}
                        data-index={vRow.index}
                        ref={rowVirtualizer.measureElement}
                        onClick={() => navigate(`/history/${run.id}`)}
                        className={`cursor-pointer transition-colors ${
                          isSelected
                            ? 'bg-primary/5 hover:bg-primary/10'
                            : 'hover:bg-muted/30'
                        }`}
                      >
                        <TableCell className="w-10 px-4 py-3" onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => toggleRow(run.id)}
                          />
                        </TableCell>
                        <TableCell className="px-4 py-3 font-mono text-primary font-semibold">
                          #{run.id}
                        </TableCell>
                        <TableCell className="px-4 py-3 text-sm">
                          {recipeMap.get(run.recipe_id) ?? (
                            <span className="text-muted-foreground">#{run.recipe_id}</span>
                          )}
                        </TableCell>
                        <TableCell className="px-4 py-3 font-mono text-xs">
                          <div>{fmtDate(run.started_at)}</div>
                          <div className="text-muted-foreground">
                            {fmtTime(run.started_at)}
                            {run.finished_at && <> → {fmtTime(run.finished_at)}</>}
                          </div>
                        </TableCell>
                        <TableCell className="px-4 py-3">{run.loops_completed}</TableCell>
                        <TableCell className="px-4 py-3 text-muted-foreground">
                          {run.operator ?? '—'}
                        </TableCell>
                        <TableCell className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                          {isSelected && visibleSelected.length > 1 ? (
                            /* bulk-mode actions — operate on whole selection */
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                variant="outline"
                                size="sm"
                                className="gap-1"
                                title={`Download Raw CSV for ${visibleSelected.length} selected runs`}
                                onClick={() => visibleSelected.forEach((r) => {
                                  const a = document.createElement('a')
                                  a.href = api.runs.exportCsvUrl(r.id)
                                  a.download = ''
                                  a.click()
                                })}
                              >
                                <Download size={13} /> {t('history.raw')} ×{visibleSelected.length}
                              </Button>
<Button
                                variant="ghost"
                                size="sm"
                                disabled={bulkDeleteMutation.isPending}
                                onClick={handleBulkDelete}
                              >
                                <Trash2 size={13} className="text-red-500" />
                              </Button>
                            </div>
                          ) : (
                            /* single-row actions */
                            <div className="flex items-center justify-end gap-1">
                              <a href={api.runs.exportCsvUrl(run.id)} download>
                                <Button variant="outline" size="sm" className="gap-1" title="Raw Imada waveform CSV">
                                  <Download size={13} /> {t('history.raw')}
                                </Button>
                              </a>
<Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setDeleteTarget({ type: 'single', id: run.id })}
                              >
                                <Trash2 size={13} className="text-red-500" />
                              </Button>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                  {paddingBottom > 0 && (
                    <TableRow>
                      <TableCell colSpan={8} style={{ height: paddingBottom }} className="p-0 border-0" />
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}

          <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t('history.deleteDialog.title', { label: deleteLabel })}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t('history.deleteDialog.description')}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  onClick={confirmDelete}
                >
                  {t('common.delete')}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}

      {tab === 'comparisons' && <SavedComparisonsTab />}
    </div>
  )
}
