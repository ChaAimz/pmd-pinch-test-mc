import { useEffect, useRef } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import { useChartStore, MAX_SAMPLES } from '@/store/chart'
import type { ChannelState } from '@/store/chart'

function linearize(ch: ChannelState): [number[], number[]] {
  const { timestamps, force, count, head } = ch
  if (count === 0) return [[], []]
  const ts: number[] = []
  const f: number[] = []
  const start = count < MAX_SAMPLES ? 0 : head
  for (let i = 0; i < count; i++) {
    const idx = (start + i) % MAX_SAMPLES
    ts.push(timestamps[idx] / 1000)  // ms → s for uPlot time axis
    f.push(force[idx])
  }
  return [ts, f]
}

function makeOpts(label: string, color: string, width: number): uPlot.Options {
  return {
    width,
    height: 180,
    series: [
      {},
      { label, stroke: color, width: 1.5 },
    ],
    axes: [
      { label: 'Time (s)', size: 40 },
      { label: 'Force (N)', size: 50 },
    ],
    cursor: { show: false },
  }
}

function Chart({ label, color, selector }: {
  label: string
  color: string
  selector: (s: ReturnType<typeof useChartStore.getState>) => ChannelState
}) {
  const ref = useRef<HTMLDivElement>(null)
  const plotRef = useRef<uPlot | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!ref.current) return
    const w = ref.current.clientWidth || 900
    plotRef.current = new uPlot(makeOpts(label, color, w), [[], []], ref.current)

    intervalRef.current = setInterval(() => {
      const ch = selector(useChartStore.getState())
      if (ch.count > 0 && plotRef.current) {
        const [ts, force] = linearize(ch)
        plotRef.current.setData([ts, force])
      }
    }, 50)

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
      plotRef.current?.destroy()
      plotRef.current = null
    }
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={ref} className="w-full" />
}

export function WaveformChart() {
  return (
    <div className="flex flex-col gap-2">
      <Chart label="Imada (N)" color="rgb(59,130,246)" selector={(s) => s.imada} />
      <Chart label="ESP32 (N)" color="rgb(34,197,94)" selector={(s) => s.esp32} />
    </div>
  )
}
