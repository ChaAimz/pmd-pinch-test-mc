import { useMemo, useState } from 'react'
import {
  Tag, Ruler, Gauge, Weight, Repeat, ArrowUpDown,
  Search, ChevronUp, ChevronDown, X,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { LucideIcon } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { KeyboardInput } from '@/components/ui/keyboard-input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { api } from '@/lib/api'
import type { Recipe } from '@/lib/types'
import { RecipeForm } from './RecipeForm'

type SortKey = 'name' | 'position_mm' | 'speed_mms' | 'clamp_threshold_n' | 'loop_count'
type SortDir = 'asc' | 'desc'

function matches(r: Recipe, query: string): boolean {
  if (!query) return true
  const q = query.toLowerCase()
  const fields = [
    r.name,
    r.position_mm,
    r.speed_mms,
    r.clamp_threshold_n,
    r.loop_count,
    r.min_force_n ?? '',
    r.max_force_n ?? '',
  ]
  return fields.some((v) => String(v).toLowerCase().includes(q))
}

function cmp(a: Recipe, b: Recipe, key: SortKey, dir: SortDir): number {
  const va = a[key], vb = b[key]
  const r = typeof va === 'string' && typeof vb === 'string'
    ? va.localeCompare(vb)
    : Number(va) - Number(vb)
  return dir === 'asc' ? r : -r
}

interface HeadProps {
  icon: LucideIcon
  label: string
  sortKey?: SortKey
  active?: SortKey | null
  dir?: SortDir
  onSort?: (key: SortKey) => void
}
function SortableHead({ icon: Icon, label, sortKey, active, dir, onSort }: HeadProps) {
  const isActive = sortKey && active === sortKey
  const sortable = !!sortKey && !!onSort
  return (
    <TableHead>
      {sortable ? (
        <button
          type="button"
          onClick={() => onSort!(sortKey!)}
          className={cn(
            'inline-flex items-center gap-1.5 select-none transition-colors',
            isActive ? 'text-foreground font-semibold' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <Icon size={14} />
          <span>{label}</span>
          {isActive
            ? (dir === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />)
            : <span className="w-3.5" />}
        </button>
      ) : (
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <Icon size={14} /> {label}
        </span>
      )}
    </TableHead>
  )
}

export default function Recipes() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [edit, setEdit] = useState<Recipe | null>(null)
  const [clone, setClone] = useState<Recipe | null>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<SortKey | null>('name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  const { data: recipes = [], isLoading } = useQuery({ queryKey: ['recipes'], queryFn: api.recipes.list })
  const del = useMutation({ mutationFn: (id: number) => api.recipes.delete(id), onSuccess: () => void qc.invalidateQueries({ queryKey: ['recipes'] }) })

  const visible = useMemo(() => {
    const filtered = recipes.filter((r) => matches(r, query))
    if (!sortKey) return filtered
    return [...filtered].sort((a, b) => cmp(a, b, sortKey, sortDir))
  }, [recipes, query, sortKey, sortDir])

  // Click cycle: not-sorted → asc → desc → cleared
  function handleSort(key: SortKey) {
    if (sortKey !== key) { setSortKey(key); setSortDir('asc'); return }
    if (sortDir === 'asc') { setSortDir('desc'); return }
    setSortKey(null)
  }

  const openAdd = () => { setEdit(null); setClone(null); setOpen(true) }
  const openEdit = (r: Recipe) => { setEdit(r); setClone(null); setOpen(true) }
  const openClone = (r: Recipe) => { setEdit(null); setClone(r); setOpen(true) }
  const saved = () => { setOpen(false); void qc.invalidateQueries({ queryKey: ['recipes'] }) }
  const dialogTitle = edit ? t('recipes.edit') : clone ? t('recipes.clone', { name: clone.name }) : t('recipes.new')

  if (isLoading) return (
    <div className="space-y-3">
      <div className="flex justify-between items-center mb-5">
        <Skeleton className="h-7 w-24" />
        <Skeleton className="h-9 w-32" />
      </div>
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    </div>
  )

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-4 mb-4">
        <div className="relative flex-1 max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none z-10" />
          <KeyboardInput
            value={query}
            onChange={setQuery}
            placeholder={t('recipes.searchPlaceholder')}
            title={t('recipes.searchPlaceholder')}
            className={`pl-9 h-9 ${query ? 'pr-8' : ''}`}
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground rounded z-10"
              title={t('recipes.clearSearch')}
            >
              <X size={14} />
            </button>
          )}
        </div>
        <Button onClick={openAdd} className="ml-auto shrink-0">+ {t('recipes.new')}</Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{dialogTitle}</DialogTitle>
          </DialogHeader>
          <RecipeForm recipe={edit} cloneFrom={clone} onSaved={saved} />
        </DialogContent>
      </Dialog>

      <div className="bg-card border border-border rounded-xl overflow-auto flex-1 min-h-0">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-card">
            <TableRow>
              <SortableHead icon={Tag} label={t('recipes.name')} sortKey="name" active={sortKey} dir={sortDir} onSort={handleSort} />
              <SortableHead icon={Ruler} label={t('recipes.position')} sortKey="position_mm" active={sortKey} dir={sortDir} onSort={handleSort} />
              <SortableHead icon={Gauge} label={t('recipes.speed')} sortKey="speed_mms" active={sortKey} dir={sortDir} onSort={handleSort} />
              <SortableHead icon={Weight} label={t('recipes.holdTime')} sortKey="clamp_threshold_n" active={sortKey} dir={sortDir} onSort={handleSort} />
              <SortableHead icon={Repeat} label={t('recipes.loopCount')} sortKey="loop_count" active={sortKey} dir={sortDir} onSort={handleSort} />
              <SortableHead icon={ArrowUpDown} label={`${t('recipes.minForce')} / ${t('recipes.maxForce')}`} />
              <TableHead className="w-44" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.name}</TableCell>
                <TableCell>{r.position_mm}</TableCell>
                <TableCell>{r.speed_mms}</TableCell>
                <TableCell>{r.clamp_threshold_n}</TableCell>
                <TableCell>{r.loop_count}</TableCell>
                <TableCell>{r.min_force_n ?? '—'} / {r.max_force_n ?? '—'}</TableCell>
                <TableCell>
                  <div className="flex gap-2 justify-end">
                    <Button size="sm" variant="outline" onClick={() => openEdit(r)}>{t('recipes.edit')}</Button>
                    <Button size="sm" variant="outline" onClick={() => openClone(r)}>{t('recipes.cloneBtn')}</Button>
                    <AlertDialog>
                      <AlertDialogTrigger render={<Button size="sm" variant="destructive" />}>
                        {t('common.delete')}
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>{t('recipes.deleteDialog.title', { name: r.name })}</AlertDialogTitle>
                          <AlertDialogDescription>{t('recipes.deleteDialog.description')}</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                          <AlertDialogAction onClick={() => del.mutate(r.id)}>{t('common.delete')}</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {visible.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-10">
                  {recipes.length === 0
                    ? t('recipes.noRecipes')
                    : t('recipes.noMatch', { query })}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
