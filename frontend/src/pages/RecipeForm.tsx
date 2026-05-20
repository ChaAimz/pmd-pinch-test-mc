import { useForm } from 'react-hook-form'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api } from '@/lib/api'
import type { Recipe, RecipeCreate } from '@/lib/types'

interface Props { recipe: Recipe | null; onSaved: () => void }
type F = { name: string; actuator_position_mm: string; speed_mm_s: string; clamp_threshold_n: string; loops: string; hold_time_ms: string; min_force_n: string; max_force_n: string }

export function RecipeForm({ recipe: r, onSaved }: Props) {
  const { register, handleSubmit, formState: { errors } } = useForm<F>({
    defaultValues: {
      name: r?.name ?? '',
      actuator_position_mm: String(r?.actuator_position_mm ?? 50),
      speed_mm_s: String(r?.speed_mm_s ?? 10),
      clamp_threshold_n: String(r?.clamp_threshold_n ?? 30),
      loops: String(r?.loops ?? 5),
      hold_time_ms: String(r?.hold_time_ms ?? 500),
      min_force_n: r?.min_force_n != null ? String(r.min_force_n) : '',
      max_force_n: r?.max_force_n != null ? String(r.max_force_n) : '',
    },
  })

  const createM = useMutation({
    mutationFn: api.recipes.create,
    onError: (e: Error) => toast.error(e.message),
  })
  const updateM = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<RecipeCreate> }) => api.recipes.update(id, data),
    onError: (e: Error) => toast.error(e.message),
  })
  const pending = createM.isPending || updateM.isPending

  const submit = async (v: F) => {
    const data: RecipeCreate = {
      name: v.name,
      actuator_position_mm: Number(v.actuator_position_mm),
      speed_mm_s: Number(v.speed_mm_s),
      clamp_threshold_n: Number(v.clamp_threshold_n),
      loops: Number(v.loops),
      hold_time_ms: Number(v.hold_time_ms),
      min_force_n: v.min_force_n ? Number(v.min_force_n) : null,
      max_force_n: v.max_force_n ? Number(v.max_force_n) : null,
    }
    if (r) await updateM.mutateAsync({ id: r.id, data })
    else await createM.mutateAsync(data)
    onSaved()
  }

  const field = (id: keyof F, label: string) => (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} {...register(id, { required: true })} className="h-8 text-sm" />
      {errors[id] && <span className="text-xs text-red-500">Required</span>}
    </div>
  )

  return (
    <form onSubmit={handleSubmit(submit)} className="grid grid-cols-2 gap-3 py-2">
      <div className="col-span-2">
        <Label htmlFor="name">Name</Label>
        <Input id="name" {...register('name', { required: true })} className="h-8 text-sm mt-1" />
        {errors.name && <span className="text-xs text-red-500">Required</span>}
      </div>
      {field('actuator_position_mm', 'Position (mm)')}
      {field('speed_mm_s', 'Speed (mm/s)')}
      {field('clamp_threshold_n', 'Clamp Threshold (N)')}
      {field('loops', 'Loops')}
      {field('hold_time_ms', 'Hold Time (ms)')}
      <div className="flex flex-col gap-1">
        <Label htmlFor="min_force_n">Min Force (N, optional)</Label>
        <Input id="min_force_n" type="number" step="0.1" placeholder="—" {...register('min_force_n')} className="h-8 text-sm" />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="max_force_n">Max Force (N, optional)</Label>
        <Input id="max_force_n" type="number" step="0.1" placeholder="—" {...register('max_force_n')} className="h-8 text-sm" />
      </div>
      <div className="col-span-2 flex justify-end pt-2">
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : r ? 'Save Changes' : 'Create Recipe'}
        </Button>
      </div>
    </form>
  )
}
