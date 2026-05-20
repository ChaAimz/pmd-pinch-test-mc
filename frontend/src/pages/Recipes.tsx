import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog'
import { api } from '@/lib/api'
import type { Recipe } from '@/lib/types'
import { RecipeForm } from './RecipeForm'

export default function Recipes() {
  const qc = useQueryClient()
  const [edit, setEdit] = useState<Recipe | null>(null)
  const [open, setOpen] = useState(false)

  const { data: recipes = [], isLoading } = useQuery({ queryKey: ['recipes'], queryFn: api.recipes.list })
  const del = useMutation({ mutationFn: (id: number) => api.recipes.delete(id), onSuccess: () => void qc.invalidateQueries({ queryKey: ['recipes'] }) })

  const openAdd = () => { setEdit(null); setOpen(true) }
  const openEdit = (r: Recipe) => { setEdit(r); setOpen(true) }
  const saved = () => { setOpen(false); void qc.invalidateQueries({ queryKey: ['recipes'] }) }

  if (isLoading) return <div className="text-slate-400 animate-pulse">Loading…</div>

  return (
    <div>
      <div className="flex justify-between items-center mb-5">
        <h1 className="text-xl font-semibold">Recipes</h1>
        <Button onClick={openAdd}>+ New Recipe</Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{edit ? 'Edit Recipe' : 'New Recipe'}</DialogTitle>
          </DialogHeader>
          <RecipeForm recipe={edit} onSaved={saved} />
        </DialogContent>
      </Dialog>

      <div className="bg-white border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Position (mm)</TableHead>
              <TableHead>Speed (mm/s)</TableHead>
              <TableHead>Threshold (N)</TableHead>
              <TableHead>Loops</TableHead>
              <TableHead>Min / Max (N)</TableHead>
              <TableHead className="w-32" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {recipes.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.name}</TableCell>
                <TableCell>{r.actuator_position_mm}</TableCell>
                <TableCell>{r.speed_mm_s}</TableCell>
                <TableCell>{r.clamp_threshold_n}</TableCell>
                <TableCell>{r.loops}</TableCell>
                <TableCell>{r.min_force_n ?? '—'} / {r.max_force_n ?? '—'}</TableCell>
                <TableCell>
                  <div className="flex gap-2 justify-end">
                    <Button size="sm" variant="outline" onClick={() => openEdit(r)}>Edit</Button>
                    <AlertDialog>
                      <AlertDialogTrigger render={<Button size="sm" variant="destructive" />}>
                        Delete
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete "{r.name}"?</AlertDialogTitle>
                          <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => del.mutate(r.id)}>Delete</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {recipes.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-slate-400 py-10">
                  No recipes yet. Click &quot;+ New Recipe&quot; to create one.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
