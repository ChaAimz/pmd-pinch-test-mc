import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { RefreshCw, CheckCircle, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { api } from '@/lib/api'
import type { HardwareStatus } from '@/lib/types'

type Device = 'plc' | 'imada' | 'esp32'

function DeviceRow({ label, ok, device, onReconnect, isReconnecting, isTarget }: {
  label: string
  ok: boolean
  device: Device
  onReconnect: (d: Device) => void
  isReconnecting: boolean
  isTarget: boolean
}) {
  return (
    <div className="flex items-center justify-between py-3 border-b last:border-0">
      <div className="flex items-center gap-3">
        {ok
          ? <CheckCircle size={18} className="text-green-500" />
          : <XCircle size={18} className="text-red-500" />
        }
        <span className="font-medium text-sm">{label}</span>
        <span className={`text-xs ${ok ? 'text-green-600' : 'text-red-500'}`}>
          {ok ? 'Connected' : 'Disconnected'}
        </span>
      </div>
      <Button
        variant="outline"
        size="sm"
        disabled={isReconnecting}
        onClick={() => onReconnect(device)}
        className="gap-1"
      >
        <RefreshCw size={13} className={isTarget ? 'animate-spin' : ''} />
        Reconnect
      </Button>
    </div>
  )
}

type CalibStep = 'zero' | 'known' | 'result'

interface CalibState {
  rawAtZero: string
  rawAtKnown: string
  knownForceN: string
}

function CalibrationWizard() {
  const [step, setStep] = useState<CalibStep>('zero')
  const [form, setForm] = useState<CalibState>({ rawAtZero: '', rawAtKnown: '', knownForceN: '' })
  const [result, setResult] = useState<{ slope: number; offset: number } | null>(null)

  const calibM = useMutation({
    mutationFn: () => api.hardware.calibrate(
      Number(form.rawAtZero),
      Number(form.rawAtKnown),
      Number(form.knownForceN),
    ),
    onSuccess: (data) => {
      setResult(data)
      setStep('result')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const reset = () => {
    setStep('zero')
    setForm({ rawAtZero: '', rawAtKnown: '', knownForceN: '' })
    setResult(null)
  }

  return (
    <div className="bg-card border rounded-lg p-4 space-y-4">
      <h2 className="text-sm font-semibold">ESP32 Calibration Wizard</h2>
      <p className="text-xs text-muted-foreground">
        2-point linear fit: place no weight → record raw, then place known weight → record raw.
      </p>

      {step === 'zero' && (
        <div className="space-y-3">
          <p className="text-sm font-medium">Step 1 — Zero point (no weight on sensor)</p>
          <div className="flex flex-col gap-1">
            <Label htmlFor="rawZero">Raw reading at zero load</Label>
            <Input
              id="rawZero"
              type="number"
              placeholder="e.g. 12345"
              value={form.rawAtZero}
              onChange={(e) => setForm((f) => ({ ...f, rawAtZero: e.target.value }))}
              className="w-48"
            />
          </div>
          <Button
            disabled={!form.rawAtZero}
            onClick={() => setStep('known')}
          >
            Next
          </Button>
        </div>
      )}

      {step === 'known' && (
        <div className="space-y-3">
          <p className="text-sm font-medium">Step 2 — Known weight</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="rawKnown">Raw reading with weight</Label>
              <Input
                id="rawKnown"
                type="number"
                placeholder="e.g. 23456"
                value={form.rawAtKnown}
                onChange={(e) => setForm((f) => ({ ...f, rawAtKnown: e.target.value }))}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="knownForce">Known force (N)</Label>
              <Input
                id="knownForce"
                type="number"
                step="0.1"
                placeholder="e.g. 10.0"
                value={form.knownForceN}
                onChange={(e) => setForm((f) => ({ ...f, knownForceN: e.target.value }))}
              />
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setStep('zero')}>Back</Button>
            <Button
              disabled={!form.rawAtKnown || !form.knownForceN || calibM.isPending}
              onClick={() => calibM.mutate()}
            >
              {calibM.isPending ? 'Computing…' : 'Compute'}
            </Button>
          </div>
        </div>
      )}

      {step === 'result' && result && (
        <div className="space-y-3">
          <p className="text-sm font-medium text-green-600">✓ Calibration computed</p>
          <div className="bg-muted rounded p-3 font-mono text-sm space-y-1">
            <div>slope  = {result.slope.toFixed(6)} N/count</div>
            <div>offset = {result.offset.toFixed(2)}</div>
          </div>
          <p className="text-xs text-muted-foreground">
            Copy these values into <code>config.yaml</code> under{' '}
            <code>hardware.esp32.calibration</code> and restart the backend.
          </p>
          <Button variant="outline" onClick={reset}>Start over</Button>
        </div>
      )}
    </div>
  )
}

export default function Hardware() {
  const queryClient = useQueryClient()

  const { data: status, isLoading } = useQuery({
    queryKey: ['hw-status'],
    queryFn: api.hardware.status,
    refetchInterval: 3000,
  })

  const reconnectM = useMutation({
    mutationFn: (device: Device) => api.hardware.reconnect(device),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['hw-status'] }),
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <div className="flex flex-col gap-4 max-w-xl">
      <h1 className="text-xl font-semibold">Hardware</h1>

      {/* Device status */}
      <div className="bg-card border rounded-lg px-4">
        {isLoading ? (
          <div className="space-y-3 py-3">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        ) : (
          (['plc', 'imada', 'esp32'] as Device[]).map((dev) => (
            <DeviceRow
              key={dev}
              label={dev.toUpperCase()}
              ok={(status as HardwareStatus | undefined)?.[dev] ?? false}
              device={dev}
              onReconnect={(d) => reconnectM.mutate(d)}
              isReconnecting={reconnectM.isPending}
              isTarget={reconnectM.isPending && reconnectM.variables === dev}
            />
          ))
        )}
      </div>

      <CalibrationWizard />
    </div>
  )
}
