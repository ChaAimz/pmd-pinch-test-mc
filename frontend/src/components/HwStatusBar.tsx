import { cn } from '@/lib/utils'
import type { HwStatus } from '@/store/app'

function Dot({ label, ok }: { label: string; ok: boolean }) {
  return (
    <span className="flex items-center gap-1.5 text-sm">
      <span className={cn('inline-block w-2.5 h-2.5 rounded-full', ok ? 'bg-green-500' : 'bg-red-400')} />
      <span className={ok ? 'text-slate-700' : 'text-slate-400'}>{label}</span>
    </span>
  )
}

export function HwStatusBar({ status }: { status: HwStatus }) {
  return (
    <div className="flex gap-5 items-center px-4 py-2 bg-white border rounded-lg shadow-sm">
      <Dot label="PLC" ok={status.plc} />
      <Dot label="Imada" ok={status.imada} />
      <Dot label="ESP32" ok={status.esp32} />
    </div>
  )
}
