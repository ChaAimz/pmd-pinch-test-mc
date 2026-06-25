import { useEffect, useMemo, useRef, type MutableRefObject } from 'react'
import ReactECharts from 'echarts-for-react'
import type { EChartsOption } from 'echarts'
import { useChartStore } from '@/store/chart'
import type { ChannelState } from '@/store/chart'
import { useSettingsStore } from '@/store/settings'

function linearize(ch: ChannelState, maxSamples: number): Array<[number, number]> {
  const { timestamps, force, count, head } = ch
  if (count === 0) return []
  const start = count < maxSamples ? 0 : head
  const t0 = timestamps[start]
  const out: Array<[number, number]> = []
  for (let i = 0; i < count; i++) {
    const idx = (start + i) % maxSamples
    out.push([(timestamps[idx] - t0) / 1000, force[idx]])
  }
  return out
}

function makeOption(
  isDark: boolean,
  xMode: 'time' | 'cycle' = 'time',
  yLabel = 'Friction Force (N)',
  valueUnit = 'N',
): EChartsOption {
  const axisLabel = isDark ? '#94a3b8' : '#475569'
  const axisLine = isDark ? '#334155' : '#cbd5e1'
  const splitLine = isDark ? 'rgba(148,163,184,0.15)' : 'rgba(148,163,184,0.3)'
  const accent = '#3b82f6'
  const unitSuffix = valueUnit ? ` ${valueUnit}` : ''
  const labelColor = isDark ? '#f1f5f9' : '#0f172a'

  return {
    animation: false,
    backgroundColor: 'transparent',
    grid: { left: 74, right: 28, top: 36, bottom: 54 },
    // Touch pinch-zoom + one-finger pan, plus mouse-wheel zoom. Double-tap / dblclick
    // resets to the full range (see the reset effect below). filterMode 'none' keeps
    // the line continuous (clip, don't drop, samples outside the zoom window).
    dataZoom: [
      { type: 'inside', xAxisIndex: 0, filterMode: 'none' },
      { type: 'inside', yAxisIndex: 0, filterMode: 'none' },
    ],
    tooltip: {
      trigger: 'axis',
      backgroundColor: isDark ? 'rgba(15,23,42,0.96)' : 'rgba(255,255,255,0.98)',
      borderColor: isDark ? '#475569' : '#cbd5e1',
      padding: [8, 12],
      textStyle: { color: isDark ? '#e2e8f0' : '#0f172a', fontFamily: 'ui-monospace, monospace', fontSize: 12 },
      axisPointer: { type: 'cross', lineStyle: { color: axisLine, width: 1 } },
      formatter: (params: unknown) => {
        const arr = params as Array<{ value: [number, number] }>
        if (!arr?.length) return ''
        const [t, f] = arr[0].value
        const xStr = xMode === 'cycle'
          ? `<span style="color:${axisLabel};font-size:11px">Cycle ${Math.floor(t) + 1}</span>`
          : `<span style="color:${axisLabel};font-size:11px">t = ${t.toFixed(3)} s</span>`
        return `${xStr}<br/><span style="font-size:15px;font-weight:700;color:${accent}">${f.toFixed(4)}${unitSuffix}</span>`
      },
    },
    xAxis: {
      type: 'value',
      name: xMode === 'cycle' ? 'Test Cycle' : 'Time (s)',
      nameLocation: 'middle',
      nameGap: 36,
      nameTextStyle: { color: axisLabel, fontSize: 13, fontWeight: 'bold' },
      axisLabel: { color: axisLabel, fontFamily: 'ui-monospace, monospace', fontSize: 11 },
      axisLine: { lineStyle: { color: axisLine } },
      splitLine: { show: true, lineStyle: { color: splitLine, type: 'dashed' } },
      min: 0,
    },
    yAxis: {
      type: 'value',
      name: yLabel,
      nameLocation: 'middle',
      nameGap: 52,
      nameTextStyle: { color: axisLabel, fontSize: 13, fontWeight: 'bold' },
      axisLabel: { color: axisLabel, fontFamily: 'ui-monospace, monospace', fontSize: 11 },
      axisLine: { lineStyle: { color: axisLine } },
      splitLine: { show: true, lineStyle: { color: splitLine, type: 'dashed' } },
      scale: true,
    },
    series: [
      {
        type: 'line',
        // No `data` field — data is patched by effects via getEchartsInstance().setOption().
        // Including data:[] here would wipe the chart whenever xMode/isDark re-renders the
        // option (because setOption merges the empty array over the existing data).
        showSymbol: false,
        sampling: 'lttb',
        smooth: false,
        lineStyle: { color: accent, width: 2 },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(59,130,246,0.3)' },
              { offset: 1, color: 'rgba(59,130,246,0.01)' },
            ],
          },
        },
        markPoint: {
          symbol: 'circle',
          symbolSize: 10,
          data: [],
          label: {
            color: labelColor,
            fontFamily: 'ui-monospace, monospace',
            fontSize: 11,
            fontWeight: 'bold',
            position: 'top',
            distance: 8,
          },
          itemStyle: { color: '#ef4444', borderColor: isDark ? '#1e293b' : '#fff', borderWidth: 2 },
        },
      },
      {
        // Optional overlay line (e.g. peak CoF per test cycle). Always present so
        // toggling it on/off is just a data swap (no series add/remove on the
        // always-mounted chart); empty data = invisible.
        type: 'line',
        name: 'Max',
        showSymbol: true,
        symbol: 'circle',
        symbolSize: 7,
        smooth: false,
        z: 5,
        lineStyle: { color: '#f59e0b', width: 2 },
        itemStyle: { color: '#f59e0b', borderColor: isDark ? '#1e293b' : '#fff', borderWidth: 1.5 },
      },
    ],
  }
}

export function WaveformChart({
  staticData,
  cycleBoundaries,
  xMode = 'time',
  yLabel,
  valueUnit,
  minForceN,
  maxForceN,
  overlay,
  exportRef,
}: {
  staticData?: Array<[number, number]>
  cycleBoundaries?: number[]
  xMode?: 'time' | 'cycle'
  yLabel?: string
  valueUnit?: string
  minForceN?: number | null
  maxForceN?: number | null
  /** Optional 2nd line (e.g. peak value per test cycle); empty/undefined = hidden. */
  overlay?: Array<[number, number]>
  exportRef?: MutableRefObject<(() => void) | null>
} = {}) {
  const chartRef = useRef<ReactECharts>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const theme = useSettingsStore((s) => s.theme)
  const isDark = useMemo(() => {
    if (theme === 'dark') return true
    if (theme === 'light') return false
    return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
  }, [theme])
  const option = useMemo(() => makeOption(isDark, xMode, yLabel, valueUnit), [isDark, xMode, yLabel, valueUnit])

  // Live polling — only runs when no static data is provided.
  // Immediately clears any leftover static data on mode switch.
  useEffect(() => {
    if (staticData !== undefined) return
    chartRef.current?.getEchartsInstance()?.setOption({
      series: [{ data: [], markLine: { data: [] }, markPoint: { data: [] }, markArea: { data: [] } }, { data: [] }],
    }, { notMerge: false })
    const timer = setInterval(() => {
      const inst = chartRef.current?.getEchartsInstance()
      if (!inst) return
      const s = useChartStore.getState()
      const data = linearize(s.imada, s.maxSamples)
      inst.setOption({ series: [{ data }] }, { notMerge: false })
    }, 50)
    return () => clearInterval(timer)
  }, [staticData])

  // Render frozen waveform when static data is supplied
  useEffect(() => {
    if (staticData === undefined) return
    const inst = chartRef.current?.getEchartsInstance()
    if (!inst) return

    const unitSuffix = valueUnit ? ` ${valueUnit}` : ' N'

    // With many cycles (e.g. 100) the per-cycle badges/dividers overlap into an
    // unreadable smear — thin them so at most ~18 show; the rest rely on the X-axis
    // ticks (and pinch-zoom to inspect a region).
    const nCycles = cycleBoundaries?.length ?? 0
    const labelStep = Math.max(1, Math.ceil(nCycles / 18))

    // Cycle boundary dividers (all-cycles xMode='cycle' view) — dashed lines only, no labels
    const cycleDividers = cycleBoundaries?.length
      ? cycleBoundaries.slice(1).filter((x) => x % labelStep === 0).map((x) => ({ xAxis: x, label: { show: false } }))
      : []

    // Cycle band labels — markArea centers label within each [N, N+1] band
    const markArea = cycleBoundaries?.length
      ? {
          silent: true,
          itemStyle: { color: 'transparent' },
          emphasis: { disabled: true },
          label: {
            show: true,
            // Bottom of each band — the top is where the peak waveform and the
            // optional Max/Cycle overlay line sit, which would cover the badges.
            position: 'insideBottom' as const,
            formatter: (p: { name: string }) => (p.name ? `{b|${p.name}}` : ''),
            rich: {
              b: {
                // Solid badge + white text so it reads on both light and dark themes
                // (the old translucent light-blue washed out on a light background).
                backgroundColor: isDark ? 'rgba(59,130,246,0.92)' : 'rgba(37,99,235,0.96)',
                borderColor: isDark ? 'rgba(147,197,253,0.7)' : 'rgba(30,64,175,0.9)',
                borderWidth: 1,
                borderRadius: 4,
                padding: [3, 7],
                color: '#ffffff',
                fontSize: 11,
                fontFamily: 'ui-monospace, monospace',
                fontWeight: 'bold' as const,
              },
            },
          },
          data: cycleBoundaries.map((x, idx) => [
            { xAxis: x, name: idx % labelStep === 0 ? `C${idx + 1}` : '' },
            { xAxis: x + 1 },
          ]),
        }
      : { data: [] }

    // Recipe threshold reference lines
    const thresholdLines: Array<{ yAxis: number; name: string; lineStyle: { color: string; type: 'dashed'; width: number }; label: { show: true; formatter: string; position: 'insideEndTop'; fontSize: number; color: string } }> = []
    if (minForceN != null) {
      thresholdLines.push({
        yAxis: minForceN,
        name: `Min ${minForceN.toFixed(2)}${unitSuffix}`,
        lineStyle: { color: '#22c55e', type: 'dashed', width: 1.5 },
        label: { show: true, formatter: `Min ${minForceN.toFixed(2)}${unitSuffix}`, position: 'insideEndTop', fontSize: 11, color: '#22c55e' },
      })
    }
    if (maxForceN != null) {
      thresholdLines.push({
        yAxis: maxForceN,
        name: `Max ${maxForceN.toFixed(2)}${unitSuffix}`,
        lineStyle: { color: '#ef4444', type: 'dashed', width: 1.5 },
        label: { show: true, formatter: `Max ${maxForceN.toFixed(2)}${unitSuffix}`, position: 'insideEndTop', fontSize: 11, color: '#ef4444' },
      })
    }

    const markLine = (cycleDividers.length > 0 || thresholdLines.length > 0)
      ? {
          silent: true,
          symbol: 'none',
          lineStyle: { color: '#64748b', type: 'dashed' as const, width: 1 },
          label: { show: false },
          data: [...cycleDividers, ...thresholdLines],
        }
      : { data: [] }

    // Peak markPoint — only in single-loop / non-cycle view
    const markPoint = !cycleBoundaries?.length && staticData.length > 0
      ? {
          data: [{
            type: 'max' as const,
            name: 'Peak',
            label: {
              formatter: (p: { value: number }) => `${p.value?.toFixed(3)}${unitSuffix}`,
            },
          }],
        }
      : { data: [] }

    inst.setOption({ series: [{ data: staticData, markLine, markPoint, markArea }, { data: overlay ?? [] }] }, { notMerge: false })
  }, [staticData, cycleBoundaries, minForceN, maxForceN, valueUnit, overlay, isDark])

  // Resize ECharts canvas whenever the container changes size (e.g. when the
  // loop results table appears below the chart, shifting the flex-1 height).
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

  // Expose a PNG export callback to the parent via exportRef.
  useEffect(() => {
    if (!exportRef) return
    exportRef.current = () => {
      const inst = chartRef.current?.getEchartsInstance()
      if (!inst) return
      const url = inst.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: isDark ? '#0f172a' : '#ffffff' })
      const a = document.createElement('a')
      a.href = url
      a.download = 'waveform.png'
      a.click()
    }
  }, [exportRef, isDark])

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%' }}>
      <ReactECharts
        ref={chartRef}
        option={option}
        lazyUpdate
        style={{ width: '100%', height: '100%' }}
        opts={{ renderer: 'canvas' }}
      />
    </div>
  )
}
