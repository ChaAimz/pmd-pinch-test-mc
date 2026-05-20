import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { StateBadge } from '@/components/StateBadge'
import { WaveformChart } from '@/components/WaveformChart'
import { useAppStore } from '@/store/app'
import { useSessionControl } from '@/hooks/useSessionControl'
import { getWsClient } from '@/lib/ws'
import { api } from '@/lib/api'

export default function Run() {
  const [recipeId, setRecipeId] = useState<number | null>(null)
  const { data: recipes = [] } = useQuery({ queryKey: ['recipes'], queryFn: api.recipes.list })

  const machineState = useAppStore((s) => s.machineState)
  const loopResults = useAppStore((s) => s.loopResults)
  const currentLoop = useAppStore((s) => s.currentLoop)

  const { isRunning, start, stop, isStarting, isStopping } = useSessionControl()

  useEffect(() => { getWsClient() }, [])

  const pass = loopResults.filter((r) => r.result === 'pass').length
  const fail = loopResults.filter((r) => r.result === 'fail').length

  return (
    <div className="flex flex-col gap-4 max-w-5xl">
      {/* Controls row — state badge + recipe select + start */}
      <div className="flex items-center gap-3 bg-white border rounded-lg p-4 shadow-sm">
        <StateBadge state={machineState} />
        {currentLoop !== null && isRunning && (
          <span className="text-sm text-slate-500">Loop {currentLoop}</span>
        )}

        <Select disabled={isRunning} onValueChange={(v) => setRecipeId(v ? Number(v) : null)}>
          <SelectTrigger className="w-64">
            <SelectValue placeholder="Select recipe…" />
          </SelectTrigger>
          <SelectContent>
            {recipes.map((r) => (
              <SelectItem key={r.id} value={String(r.id)}>{r.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          className="h-10 px-8 text-base font-semibold"
          disabled={!recipeId || isRunning || isStarting}
          onClick={() => recipeId && start(recipeId)}
        >
          {isStarting ? 'Starting…' : 'Start'}
        </Button>
      </div>

      {/* Waveform */}
      <div className="bg-white border rounded-lg p-4 shadow-sm">
        <WaveformChart />
      </div>

      {/* E-STOP */}
      <Button
        variant="destructive"
        className="w-full h-14 text-lg font-bold tracking-wide"
        disabled={!isRunning || isStopping}
        onClick={stop}
      >
        E-STOP
      </Button>

      {/* Loop results */}
      {loopResults.length > 0 && (
        <div className="bg-white border rounded-lg p-4 shadow-sm">
          <div className="flex gap-5 mb-3 text-sm font-semibold">
            <span className="text-green-600">{pass} PASS</span>
            <span className="text-red-600">{fail} FAIL</span>
          </div>
          <div className="overflow-y-auto max-h-52">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-slate-400 uppercase border-b">
                  <th className="text-left py-1 pr-4">Loop</th>
                  <th className="text-left py-1 pr-4">Result</th>
                  <th className="text-left py-1 pr-4">Peak (N)</th>
                  <th className="text-left py-1">Hold (ms)</th>
                </tr>
              </thead>
              <tbody>
                {loopResults.map((r) => (
                  <tr key={r.loop} className="border-b border-slate-100">
                    <td className="py-1 pr-4 font-mono">{r.loop}</td>
                    <td className={`py-1 pr-4 font-semibold ${r.result === 'pass' ? 'text-green-600' : 'text-red-600'}`}>
                      {r.result.toUpperCase()}
                    </td>
                    <td className="py-1 pr-4 font-mono">{r.peak_n.toFixed(1)}</td>
                    <td className="py-1 font-mono">{r.hold_ms}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
