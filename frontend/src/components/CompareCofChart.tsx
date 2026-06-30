import { useMemo, useRef, useEffect, type MutableRefObject } from 'react'
import ReactECharts from 'echarts-for-react'
import type { EChartsOption } from 'echarts'
import { useSettingsStore } from '@/store/settings'

export interface RunCofSeries {
  runId: number
  label: string
  cofPerCycle: (number | null)[]
}

const SERIES_COLORS = [
  '#3b82f6', '#ef4444', '#22c55e', '#f59e0b',
  '#8b5cf6', '#ec4899', '#06b6d4', '#f97316',
]

export function CompareCofChart({
  series,
  maxCycles,
  exportRef,
}: {
  series: RunCofSeries[]
  maxCycles: number
  exportRef?: MutableRefObject<((filename: string) => void) | null>
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
    const legendText = isDark ? '#e2e8f0' : '#0f172a'

    const categories = Array.from({ length: maxCycles }, (_, i) => `C${i + 1}`)

    return {
      animation: false,
      backgroundColor: 'transparent',
      grid: { left: 64, right: 24, top: 56, bottom: 48 },
      legend: {
        type: 'scroll',
        top: 0,
        textStyle: { color: legendText, fontSize: 11 },
        pageTextStyle: { color: axisLabel },
        pageIconColor: axisLabel,
        data: series.map((s) => s.label),
      },
      dataZoom: [
        { type: 'inside', xAxisIndex: 0, filterMode: 'none' },
        { type: 'inside', yAxisIndex: 0, filterMode: 'none' },
      ],
      tooltip: {
        trigger: 'axis',
        backgroundColor: isDark ? 'rgba(15,23,42,0.92)' : 'rgba(255,255,255,0.95)',
        borderColor: isDark ? '#334155' : '#e2e8f0',
        textStyle: {
          color: isDark ? '#e2e8f0' : '#0f172a',
          fontFamily: 'ui-monospace, monospace',
          fontSize: 12,
        },
        formatter: (params: unknown) => {
          const list = params as Array<{
            seriesName: string
            dataIndex: number
            value: number | null | undefined
            color: string
          }>
          if (!list.length) return ''
          const cycle = list[0].dataIndex + 1
          const lines = [`<b>C${cycle}</b>`]
          for (const p of list) {
            const val = p.value != null ? Number(p.value).toFixed(4) : '—'
            lines.push(`<span style="color:${p.color}">■</span> ${p.seriesName}: <b>${val}</b>`)
          }
          return lines.join('<br/>')
        },
      },
      xAxis: {
        type: 'category',
        data: categories,
        name: 'Test Cycle',
        nameLocation: 'middle',
        nameGap: 30,
        nameTextStyle: { color: axisLabel, fontSize: 12, fontWeight: 'bold' },
        axisLabel: {
          color: axisLabel,
          fontFamily: 'ui-monospace, monospace',
          interval: maxCycles > 30 ? 'auto' : 0,
        },
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
      series: series.map((s, i) => ({
        type: 'line',
        name: s.label,
        data: s.cofPerCycle,
        showSymbol: true,
        symbolSize: 7,
        connectNulls: false,
        lineStyle: { color: SERIES_COLORS[i % SERIES_COLORS.length], width: 2 },
        itemStyle: { color: SERIES_COLORS[i % SERIES_COLORS.length] },
      })),
    }
  }, [series, maxCycles, isDark])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      chartRef.current?.getEchartsInstance()?.resize()
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const inst = chartRef.current?.getEchartsInstance()
    if (!inst) return
    const zr = inst.getZr()
    const reset = () => inst.dispatchAction({ type: 'dataZoom', start: 0, end: 100 })
    zr.on('dblclick', reset)
    return () => zr.off('dblclick', reset)
  }, [])

  useEffect(() => {
    if (!exportRef) return
    exportRef.current = (filename: string) => {
      const inst = chartRef.current?.getEchartsInstance()
      if (!inst) return
      const url = inst.getDataURL({
        type: 'png',
        pixelRatio: 2,
        backgroundColor: isDark ? '#0f172a' : '#ffffff',
      })
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
    }
  }, [exportRef, isDark])

  return (
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
