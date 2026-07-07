import { useMemo, useRef, useEffect, type MutableRefObject } from 'react'
import ReactECharts from 'echarts-for-react'
import type { EChartsOption } from 'echarts'
import { useSettingsStore } from '@/store/settings'
import type { LoopResult } from '@/store/app'

export function MaxCycleChart({
  loopResults,
  exportRef,
}: {
  loopResults: LoopResult[]
  exportRef?: MutableRefObject<(() => string | null) | null>
}) {
  const chartRef = useRef<ReactECharts>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const theme = useSettingsStore((s) => s.theme)
  const isDark = useMemo(() => {
    if (theme === 'dark') return true
    if (theme === 'light') return false
    return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
  }, [theme])

  const option = useMemo<EChartsOption>(() => {
    const axisLabel = isDark ? '#94a3b8' : '#475569'
    const axisLine = isDark ? '#334155' : '#cbd5e1'
    const splitLine = isDark ? 'rgba(148,163,184,0.12)' : 'rgba(148,163,184,0.25)'

    const categories = loopResults.map((r) => `C${r.loop}`)

    // CoF per cycle = peak_force_n / avg_clamp_n (null if clamp unavailable)
    const cofValues = loopResults.map((r) => {
      const clamp = r.avg_clamp_n
      return clamp != null && clamp !== 0 ? r.peak_force_n / clamp : null
    })

    return {
      animation: false,
      backgroundColor: 'transparent',
      grid: { left: 60, right: 32, top: 24, bottom: 48 },
      // Touch pinch-zoom + one-finger pan, plus mouse-wheel zoom. Double-tap / dblclick
      // resets to the full range (see the reset effect below). filterMode 'none' keeps
      // the line continuous (clip, don't drop, points outside the zoom window).
      dataZoom: [
        { type: 'inside', xAxisIndex: 0, filterMode: 'none' },
        { type: 'inside', yAxisIndex: 0, filterMode: 'none' },
      ],
      tooltip: {
        trigger: 'item',
        backgroundColor: isDark ? 'rgba(15,23,42,0.92)' : 'rgba(255,255,255,0.95)',
        borderColor: isDark ? '#334155' : '#e2e8f0',
        textStyle: { color: isDark ? '#e2e8f0' : '#0f172a', fontFamily: 'ui-monospace, monospace', fontSize: 12 },
        formatter: (params: unknown) => {
          const p = params as { dataIndex: number }
          const r = loopResults[p.dataIndex]
          if (!r) return ''
          const cof = cofValues[p.dataIndex]
          const jcolor = r.judgment === 'pass' ? '#22c55e' : '#ef4444'
          return `Test Cycle ${r.loop}<br/><b>${cof != null ? cof.toFixed(4) : '—'} CoF</b><br/><span style="color:${jcolor};font-weight:bold">${r.judgment.toUpperCase()}</span>`
        },
      },
      xAxis: {
        type: 'category',
        data: categories,
        name: 'Test Cycle',
        nameLocation: 'middle',
        nameGap: 30,
        nameTextStyle: { color: axisLabel, fontSize: 12, fontWeight: 'bold' },
        axisLabel: { color: axisLabel, fontFamily: 'ui-monospace, monospace' },
        axisLine: { lineStyle: { color: axisLine } },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value',
        name: 'CoF (μ)',
        nameLocation: 'middle',
        nameGap: 52,
        nameTextStyle: { color: axisLabel, fontSize: 12, fontWeight: 'bold' },
        axisLabel: { color: axisLabel, fontFamily: 'ui-monospace, monospace' },
        axisLine: { lineStyle: { color: axisLine } },
        splitLine: { show: true, lineStyle: { color: splitLine, type: 'dashed' } },
        scale: true,
      },
      series: [
        {
          type: 'line',
          data: loopResults.map((r, i) => ({
            value: cofValues[i],
            itemStyle: { color: r.judgment === 'pass' ? '#22c55e' : '#ef4444' },
          })),
          showSymbol: true,
          symbolSize: 8,
          lineStyle: { color: '#3b82f6', width: 2 },
          areaStyle: {
            color: {
              type: 'linear' as const,
              x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(59,130,246,0.25)' },
                { offset: 1, color: 'rgba(59,130,246,0.02)' },
              ],
            },
          },
          markLine: { data: [] },
        },
      ],
    }
  }, [loopResults, isDark])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      chartRef.current?.getEchartsInstance()?.resize()
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Double-tap / double-click resets the pinch-zoom/pan back to the full range.
  useEffect(() => {
    const inst = chartRef.current?.getEchartsInstance()
    if (!inst) return
    const zr = inst.getZr()
    const reset = () => inst.dispatchAction({ type: 'dataZoom', start: 0, end: 100 })
    zr.on('dblclick', reset)
    return () => zr.off('dblclick', reset)
  }, [])

  // Expose a PNG dataURL getter to the parent via exportRef — the parent decides what
  // to do with the string (POST it to the backend exporter).
  useEffect(() => {
    if (!exportRef) return
    exportRef.current = () => {
      const inst = chartRef.current?.getEchartsInstance()
      if (!inst) return null
      return inst.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: isDark ? '#0f172a' : '#ffffff' })
    }
  }, [exportRef, isDark])

  return (
    // touchAction:'none' overrides the global `html { touch-action: pan-y }` (index.css)
    // so the browser stops swallowing pinch/pan gestures and ECharts' inside dataZoom
    // receives them. Without this, touch zoom/pan silently does nothing.
    <div ref={containerRef} style={{ width: '100%', height: '100%', touchAction: 'none' }}>
      <ReactECharts
        ref={chartRef}
        option={option}
        notMerge
        style={{ width: '100%', height: '100%' }}
        opts={{ renderer: 'canvas' }}
      />
    </div>
  )
}
