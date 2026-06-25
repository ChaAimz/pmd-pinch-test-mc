import { Controller, useForm } from 'react-hook-form'
import type { RegisterOptions } from 'react-hook-form'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { Tag, Ruler, Gauge, Weight, Repeat, Timer, Circle } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { NumpadInput } from '@/components/ui/numpad-input'
import { KeyboardInput } from '@/components/ui/keyboard-input'
import { api } from '@/lib/api'
import type { Recipe, RecipeCreate } from '@/lib/types'
import { useSettingsStore } from '@/store/settings'

const GF_PER_N = 101.97162129779283

interface Props {
  recipe: Recipe | null
  /** Pre-populate the form from this recipe but still create a new row on save. */
  cloneFrom?: Recipe | null
  /** Called with the newly created / updated Recipe so callers can act on the result. */
  onSaved: (saved: Recipe) => void
}

type F = {
  name: string
  position_mm: string
  speed_mms: string
  diameter_mm: string
  clamp_threshold_n: string
  loop_count: string
  prepare_timer_s: string
}

export function RecipeForm({ recipe: r, cloneFrom, onSaved }: Props) {
  const { t } = useTranslation()
  const seed = r ?? cloneFrom ?? null
  const seededName = r ? r.name : cloneFrom ? `${cloneFrom.name} (copy)` : ''
  const esp32Unit = useSettingsStore((s) => s.esp32Unit)

  /** Build react-hook-form rules for a numeric field with min/max bounds. */
  function numRule(min: number, max: number, step = 1): RegisterOptions<F, keyof F> {
    return {
      required: t('recipes.form.required'),
      validate: (v) => {
        const n = Number(v)
        if (v === '' || isNaN(n)) return t('recipes.form.required')
        if (n < min) return `Min ${min}`
        if (n > max) return `Max ${max}`
        if (step < 1) {
          const decimals = String(step).split('.')[1]?.length ?? 0
          const factor = Math.pow(10, decimals)
          if (Math.round(n * factor) !== n * factor) return `Step ${step}`
        }
        return true
      },
    }
  }

  const clampSeedN = seed?.clamp_threshold_n ?? 5
  const clampSeedDisplay = esp32Unit === 'gf'
    ? (clampSeedN * GF_PER_N).toFixed(1)
    : String(clampSeedN)

  const { register, control, handleSubmit, formState: { errors } } = useForm<F>({
    mode: 'onChange',
    defaultValues: {
      name:              seededName,
      position_mm:       String(seed?.position_mm ?? 50),
      speed_mms:         String(seed?.speed_mms   ?? 10),
      diameter_mm:       String(seed?.diameter_mm        ?? 0),
      clamp_threshold_n: clampSeedDisplay,
      loop_count:        String(seed?.loop_count        ?? 5),
      prepare_timer_s:   String(seed?.prepare_timer_s   ?? 0),
    },
  })

  const createM = useMutation({
    mutationFn: api.recipes.create,
    onError: (e: Error) => toast.error(e.message),
  })
  const updateM = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<RecipeCreate> }) =>
      api.recipes.update(id, data),
    onError: (e: Error) => toast.error(e.message),
  })
  const pending = createM.isPending || updateM.isPending

  const submit = async (v: F) => {
    const data: RecipeCreate = {
      name: v.name,
      description: null,
      position_mm:       Number(v.position_mm),
      speed_mms:         Number(v.speed_mms),
      diameter_mm:       Number(v.diameter_mm),
      clamp_threshold_n: esp32Unit === 'gf'
        ? Number(v.clamp_threshold_n) / GF_PER_N
        : Number(v.clamp_threshold_n),
      loop_count:        Number(v.loop_count),
      prepare_timer_s:   Number(v.prepare_timer_s),
      min_force_n: null,
      max_force_n: null,
      sampling_hz: 50,
    }
    const saved = r
      ? await updateM.mutateAsync({ id: r.id, data })
      : await createM.mutateAsync(data)
    onSaved(saved)
  }

  const labelRow = (Icon: LucideIcon, text: string) => (
    <span className="inline-flex items-center gap-1.5 text-muted-foreground">
      <Icon size={14} /> <span className="text-foreground">{text}</span>
    </span>
  )

  /** Numeric field backed by NumpadInput + Controller. */
  const numField = (
    id: keyof F,
    Icon: LucideIcon,
    label: string,
    rules: RegisterOptions<F, keyof F>,
    decimal = true,
  ) => (
    <Controller
      name={id}
      control={control}
      rules={rules}
      render={({ field, fieldState }) => (
        <div className="flex flex-col gap-1">
          <Label htmlFor={id}>{labelRow(Icon, label)}</Label>
          <NumpadInput
            id={id}
            value={field.value}
            onChange={field.onChange}
            onBlur={field.onBlur}
            decimal={decimal}
            className={`h-9 text-sm ${fieldState.error ? 'border-red-500 focus-visible:ring-red-500' : ''}`}
          />
          {fieldState.error && (
            <span className="text-xs text-red-500">{fieldState.error.message as string}</span>
          )}
        </div>
      )}
    />
  )

  return (
    <form onSubmit={handleSubmit(submit)} className="grid grid-cols-2 gap-3 py-2">
      {/* Name — full width, on-screen keyboard input */}
      <div className="col-span-2 flex flex-col gap-1">
        <Label htmlFor="name">{labelRow(Tag, t('recipes.form.name'))}</Label>
        <Controller
          name="name"
          control={control}
          rules={{ required: t('recipes.form.required') }}
          render={({ field, fieldState }) => (
            <>
              <KeyboardInput
                id="name"
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                title={t('recipes.form.name')}
                className={`h-9 text-sm ${fieldState.error ? 'border-red-500 focus-visible:ring-red-500' : ''}`}
              />
              {fieldState.error && (
                <span className="text-xs text-red-500">{fieldState.error.message as string}</span>
              )}
            </>
          )}
        />
      </div>

      {/* Row: Position | Speed */}
      {numField('position_mm', Ruler, `${t('recipes.form.positionMm')}  [0 – 190]`, numRule(0, 190, 0.1), true)}
      {numField('speed_mms', Gauge, `${t('recipes.form.speedMms')}  [0.1 – 100]`, numRule(0.1, 100, 0.1), true)}

      {/* Row: Diameter OD | Clamp Force */}
      {numField('diameter_mm', Circle, `${t('recipes.form.diameterMm')}  [0 – 200]`, numRule(0, 200, 0.01), true)}
      {esp32Unit === 'gf'
        ? numField('clamp_threshold_n', Weight, `${t('recipes.form.clampForceGf')}  [0.1 – 917.7]`, numRule(0.1, 917.7, 0.1), true)
        : numField('clamp_threshold_n', Weight, `${t('recipes.form.clampForceN')}  [0.001 – 9.0]`, numRule(0.001, 9.0, 0.001), true)
      }

      {/* Row: Test Cycles | Prepare Timer */}
      {numField('loop_count', Repeat, `${t('recipes.form.testCycles')}  [1 – 1000]`, numRule(1, 1000, 1), false)}
      {numField('prepare_timer_s', Timer, `${t('recipes.form.prepareTimer')}  [0 – 9999]`, numRule(0, 9999, 1), false)}

      <div className="col-span-2 flex justify-end pt-2">
        <Button type="submit" disabled={pending}>
          {pending ? t('recipes.form.saving') : r ? t('recipes.form.saveChanges') : t('recipes.form.createRecipe')}
        </Button>
      </div>
    </form>
  )
}
