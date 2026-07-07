import { useMemo, useRef, useEffect, type MutableRefObject } from 'react'
import ReactECharts from 'echarts-for-react'
import type { EChartsOption } from 'echarts'
import { useSettingsStore } from '@/store/settings'
import type { Annotation, ChartConfig } from '@/lib/types'

export type { Annotation }

export interface RunCofSeries {
  runId: number
  label: string
  recipeName?: string | null
  cofPerCycle: (number | null)[]
}

export const SERIES_COLORS = [
  '#3b82f6', '#ef4444', '#22c55e', '#f59e0b',
  '#8b5cf6', '#ec4899', '#06b6d4', '#f97316',
]

export const ANNOTATION_COLORS = [
  '#f59e0b', '#ef4444', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899',
]

export const DEFAULT_CHART_CONFIG: ChartConfig = {
  yMin: null,
  yMax: null,
  showYGrid: true,
  yNameGap: 52,
  xLabelInterval: null,
  lineWidth: 2,
  symbolSize: 7,
  showSymbol: true,
  smooth: false,
  connectNulls: false,
  showValueLabels: false,
  decimals: 4,
  annotationSymbolSize: 14,
  annotationFontSize: 11,
  showAnnotationLabels: true,
}

export function CompareCofChart({
  series,
  maxCycles,
  exportRef,
  annotations,
  onChartClick,
  annotationMode,
  hiddenSeries,
  config,
}: {
  series: RunCofSeries[]
  maxCycles: number
  exportRef?: MutableRefObject<(() => string | null) | null>
  annotations?: Annotation[]
  onChartClick?: (cycleIndex: number, yValue: number) => void
  annotationMode?: boolean
  hiddenSeries?: Set<number>
  config?: ChartConfig
}) {
  const cfg = config ?? DEFAULT_CHART_CONFIG

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

    const categories = Array.from({ length: maxCycles }, (_, i) => `C${i + 1}`)

    // Internal series name MUST be unique even when two runs share the same
    // display label (e.g. comparing repeats of the same recipe). Legend toggle
    // works by name, so colliding names would hide/show every matching series.
    const seriesName = (s: RunCofSeries) => `run-${s.runId}`

    // Build markPoint data for first series if there are annotations
    const markPointData =
      annotations && annotations.length > 0
        ? annotations.map((a) => ({
            name: a.text,
            coord: [`C${a.cycleIndex + 1}`, a.yValue] as [string, number],
            itemStyle: { color: a.color },
            label: { color: a.color },
          }))
        : []

    // Resolve x-axis label interval: null → adaptive default, else use value directly
    const resolvedXInterval: number | 'auto' =
      cfg.xLabelInterval == null
        ? maxCycles > 30
          ? 'auto'
          : 0
        : cfg.xLabelInterval

    return {
      animation: false,
      backgroundColor: 'transparent',
      grid: { left: 64, right: 24, top: 16, bottom: 48 },
      // Hidden legend — not rendered, but its `selected` map declaratively drives
      // per-series visibility. Keyed by the unique internal name so toggling one
      // run never affects another that happens to share a display label.
      legend: {
        show: false,
        data: series.map(seriesName),
        selected: Object.fromEntries(
          series.map((s) => [seriesName(s), !hiddenSeries?.has(s.runId)])
        ),
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
            seriesIndex: number
            dataIndex: number
            value: number | null | undefined
            color: string
          }>
          if (!list.length) return ''
          const cycle = list[0].dataIndex + 1
          const lines = [`<b>C${cycle}</b>`]
          for (const p of list) {
            const val = p.value != null ? Number(p.value).toFixed(cfg.decimals) : '—'
            // Internal series name is `run-<id>`; show the friendly label instead.
            const label = series[p.seriesIndex]?.label ?? ''
            lines.push(`<span style="color:${p.color}">■</span> ${label}: <b>${val}</b>`)
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
          interval: resolvedXInterval,
        },
        axisLine: { lineStyle: { color: axisLine } },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value',
        name: 'CoF (μ)',
        nameLocation: 'middle',
        nameGap: cfg.yNameGap,
        nameTextStyle: { color: axisLabel, fontSize: 12, fontWeight: 'bold' },
        axisLabel: { color: axisLabel, fontFamily: 'ui-monospace, monospace' },
        axisLine: { lineStyle: { color: axisLine } },
        splitLine: {
          show: cfg.showYGrid,
          lineStyle: { color: splitLine, type: 'dashed' },
        },
        scale: cfg.yMin == null && cfg.yMax == null,
        min: cfg.yMin ?? undefined,
        max: cfg.yMax ?? undefined,
      },
      series: series.map((s, i) => ({
        type: 'line',
        name: seriesName(s),
        data: s.cofPerCycle,
        showSymbol: cfg.showSymbol,
        symbolSize: cfg.symbolSize,
        connectNulls: cfg.connectNulls,
        smooth: cfg.smooth,
        lineStyle: { color: SERIES_COLORS[i % SERIES_COLORS.length], width: cfg.lineWidth },
        itemStyle: { color: SERIES_COLORS[i % SERIES_COLORS.length] },
        label: {
          show: cfg.showValueLabels,
          position: 'top',
          fontSize: 10,
          color: axisLabel,
          formatter: (p: { value: unknown }) =>
            p.value != null ? Number(p.value).toFixed(cfg.decimals) : '',
        },
        // Attach markPoint to first series only
        ...(i === 0 && markPointData.length > 0
          ? {
              markPoint: {
                symbol: 'arrow',
                symbolSize: cfg.annotationSymbolSize,
                symbolRotate: 180,
                silent: false,
                label: {
                  show: cfg.showAnnotationLabels,
                  position: 'top',
                  distance: 6,
                  fontSize: cfg.annotationFontSize,
                  formatter: (params: { name: string }) => params.name,
                },
                data: markPointData,
              },
            }
          : {}),
      })),
    }
  }, [series, maxCycles, isDark, annotations, hiddenSeries, cfg])

  // ResizeObserver
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      chartRef.current?.getEchartsInstance()?.resize()
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Double-click to reset zoom
  useEffect(() => {
    const inst = chartRef.current?.getEchartsInstance()
    if (!inst) return
    const zr = inst.getZr()
    const reset = () => inst.dispatchAction({ type: 'dataZoom', start: 0, end: 100 })
    zr.on('dblclick', reset)
    return () => zr.off('dblclick', reset)
  }, [])

  // ZRender click handler for annotation placement
  useEffect(() => {
    const inst = chartRef.current?.getEchartsInstance()
    if (!inst) return
    const zr = inst.getZr()

    const handler = (event: { offsetX: number; offsetY: number }) => {
      if (!annotationMode || !onChartClick) return
      const result = inst.convertFromPixel(
        { xAxisIndex: 0, yAxisIndex: 0 },
        [event.offsetX, event.offsetY]
      )
      if (!Array.isArray(result)) return
      const [xFloat, yValue] = result as [number, number]
      const cycleIndex = Math.max(0, Math.min(maxCycles - 1, Math.round(xFloat)))
      onChartClick(cycleIndex, yValue)
    }

    zr.on('click', handler)
    return () => zr.off('click', handler)
  }, [annotationMode, maxCycles, onChartClick])

  // Export PNG — expose the dataURL to the parent, which decides what to do with it
  // (POST it to the backend exporter).
  useEffect(() => {
    if (!exportRef) return
    exportRef.current = () => {
      const inst = chartRef.current?.getEchartsInstance()
      if (!inst) return null
      return inst.getDataURL({
        type: 'png',
        pixelRatio: 2,
        backgroundColor: isDark ? '#0f172a' : '#ffffff',
      })
    }
  }, [exportRef, isDark])

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%', touchAction: 'none' }}
      className={annotationMode ? 'cursor-crosshair ring-2 ring-amber-400 ring-offset-2 rounded-lg' : ''}
    >
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
