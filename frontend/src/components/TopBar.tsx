import { useEffect, useState } from 'react'
import { useAppStore } from '@/store/app'
import { cn } from '@/lib/utils'

function DeviceDot({ label, ok }: { label: string; ok: boolean }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn(
        'inline-block w-2 h-2 rounded-full shrink-0',
        ok ? 'bg-green-500' : 'bg-red-400 animate-pulse'
      )} />
      <span className={cn('text-sm', ok ? 'text-foreground' : 'text-muted-foreground')}>{label}</span>
    </span>
  )
}

function Clock() {
  const [time, setTime] = useState(() => new Date())

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  return (
    <time className="font-mono text-sm tabular-nums text-foreground">
      {time.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
    </time>
  )
}

export function TopBar() {
  const hwStatus = useAppStore((s) => s.hwStatus)
  const wsConnected = useAppStore((s) => s.wsConnected)

  return (
    <header className="h-12 shrink-0 flex items-center justify-between px-6 border-b bg-card">
      {/* Left — Clock */}
      <Clock />

      {/* Right — Device status */}
      <div className="flex items-center gap-6">
        <DeviceDot label="PLC" ok={hwStatus.plc} />
        <DeviceDot label="Imada" ok={hwStatus.imada} />
        <DeviceDot label="ESP32" ok={hwStatus.esp32} />
        <span className={cn(
          'flex items-center gap-1.5 text-sm',
          wsConnected ? 'text-muted-foreground' : 'text-red-500'
        )}>
          <span className={cn(
            'inline-block w-2 h-2 rounded-full shrink-0',
            wsConnected ? 'bg-green-500' : 'bg-red-500 animate-pulse'
          )} />
          {wsConnected ? 'WebSocket' : 'WS Disconnected'}
        </span>
      </div>
    </header>

  )
}
