import { useEffect, useMemo, useRef, type MutableRefObject } from 'react'
import ReactECharts from 'echarts-for-react'
import type { EChartsOption } from 'echarts'
import { useChartStore } from '@/store/chart'
import type { ChannelState } from '@/store/chart'
import { useSettingsStore } from '@/store/settings'
import { decimateIndices, lowerBoundIndex } from '@/lib/waveform'

// Max points handed to ECharts per live tick. The panel is FHD (~1920 device px at
// 150% scale), so ~2000 points is visually lossless. Decimating straight off the ring
// buffer means each tick allocates only ~LIVE_MAX_POINTS pairs instead of the whole
// buffer (up to 500k in continuous mode) — feeding the full buffer to setOption 20x/sec
// was the dominant allocation churn that exhausted the renderer heap over a long run.
const LIVE_MAX_POINTS = 2000

// Build the live series straight off the ring buffer, peak-preserving, capped at
// `maxOut` points so each tick allocates only the output — not the whole buffer (up to
// 500k in continuous mode). When `view` (the chart's currently-visible time window, in
// seconds) is given, only that index range is decimated, so zooming in reveals full local
// detail from the ring while a zoomed-out view stays light. timestamps increase with i,
// so the window maps to a contiguous index range via binary search.
function linearizeLive(
  ch: ChannelState,
  maxSamples: number,
  maxOut = LIVE_MAX_POINTS,
  view?: { lo: number; hi: number },
): Array<[number, number]> {
  const { timestamps, force, count, head } = ch
  if (count === 0) return []
  const start = count < maxSamples ? 0 : head
  const t0 = timestamps[start]
  const getX = (i: number) => (timestamps[(start + i) % maxSamples] - t0) / 1000
  const getY = (i: number) => force[(start + i) % maxSamples]
  let a = 0, b = count
  if (view && view.hi > view.lo) {
    // One sample of padding each side so the line still reaches the chart edges.
    a = Math.max(0, lowerBoundIndex(count, getX, view.lo) - 1)
    b = Math.min(count, lowerBoundIndex(count, getX, view.hi) + 1)
  }
  const idx = decimateIndices(getY, a, b, maxOut)
  const out: Array<[number, number]> = new Array(idx.length)
  for (let k = 0; k < idx.length; k++) out[k] = [getX(idx[k]), getY(idx[k])]
  return out
}

function makeOption(
  isDark: boolean,
  xMode: 'time' | 'cycle' = 'time',
  yLabel = 'Friction Force (N)',
  valueUnit = 'N',
  cfg: {
    lineWidth: number
    showSymbol: boolean
    symbolSize: number
    smooth: boolean
    showGrid: boolean
    decimals: number
  } = { lineWidth: 2, showSymbol: false, symbolSize: 7, smooth: false, showGrid: true, decimals: 4 },
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
    // Pinch / one-finger pan / mouse-wheel zoom the X (time) axis ONLY — the time-series
    // convention. The Y (force) axis is left to auto-scale (yAxis.scale) so the waveform
    // always fills the height. Double-tap / dblclick resets to the full range (see the
    // reset effect below). filterMode 'none' keeps the line continuous (clip, don't drop,
    // samples outside the zoom window).
    dataZoom: [
      { type: 'inside', xAxisIndex: 0, filterMode: 'none' },
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
        return `${xStr}<br/><span style="font-size:15px;font-weight:700;color:${accent}">${f.toFixed(cfg.decimals)}${unitSuffix}</span>`
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
      splitLine: { show: cfg.showGrid, lineStyle: { color: splitLine, type: 'dashed' } },
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
      splitLine: { show: cfg.showGrid, lineStyle: { color: splitLine, type: 'dashed' } },
      scale: true,
    },
    series: [
      {
        type: 'line',
        // No `data` field — data is patched by effects via getEchartsInstance().setOption().
        // Including data:[] here would wipe the chart whenever xMode/isDark re-renders the
        // option (because setOption merges the empty array over the existing data).
        showSymbol: cfg.showSymbol,
        symbolSize: cfg.symbolSize,
        sampling: 'lttb',
        smooth: cfg.smooth,
        lineStyle: { color: accent, width: cfg.lineWidth },
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
  resampleWindow,
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
  exportRef?: MutableRefObject<((filename: string) => void) | null>
  /**
   * Optional progressive-detail resampler for static data. Given the visible X window
   * (axis units), returns higher-resolution points for that window (or the overview when
   * zoomed out). Called on every zoom so deep zoom reveals full detail instead of the
   * once-decimated overview. Omit for full-resolution single-loop / live charts.
   */
  resampleWindow?: (loX: number, hiX: number) => Array<[number, number]> | null
} = {}) {
  const chartRef = useRef<ReactECharts>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const theme = useSettingsStore((s) => s.theme)
  const isDark = useMemo(() => {
    if (theme === 'dark') return true
    if (theme === 'light') return false
    return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
  }, [theme])

  // Global chart-display preferences (Settings page → app_settings). Read straight from
  // the store so Run/HistoryDetail don't need to thread them through as props.
  const chartLineWidth = useSettingsStore((s) => s.chartLineWidth)
  const chartShowSymbol = useSettingsStore((s) => s.chartShowSymbol)
  const chartSymbolSize = useSettingsStore((s) => s.chartSymbolSize)
  const chartSmooth = useSettingsStore((s) => s.chartSmooth)
  const chartShowGrid = useSettingsStore((s) => s.chartShowGrid)
  const chartDecimals = useSettingsStore((s) => s.chartDecimals)
  const chartShowThresholds = useSettingsStore((s) => s.chartShowThresholds)

  const option = useMemo(
    () => makeOption(isDark, xMode, yLabel, valueUnit, {
      lineWidth: chartLineWidth,
      showSymbol: chartShowSymbol,
      symbolSize: chartSymbolSize,
      smooth: chartSmooth,
      showGrid: chartShowGrid,
      decimals: chartDecimals,
    }),
    [isDark, xMode, yLabel, valueUnit, chartLineWidth, chartShowSymbol, chartSymbolSize, chartSmooth, chartShowGrid, chartDecimals],
  )

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
      // Current visible x-window (seconds) so zooming in pulls full-resolution detail from
      // the ring buffer for that span. Read from the axis scale (reflects pinch/wheel zoom);
      // try/catch so an ECharts internals change just degrades to whole-buffer rendering.
      let view: { lo: number; hi: number } | undefined
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ext = (inst as any).getModel?.().getComponent('xAxis', 0)?.axis?.scale?.getExtent?.()
        if (ext && Number.isFinite(ext[0]) && Number.isFinite(ext[1]) && ext[1] > ext[0]) {
          view = { lo: ext[0], hi: ext[1] }
        }
      } catch { /* whole-buffer fallback */ }
      const data = linearizeLive(s.imada, s.maxSamples, LIVE_MAX_POINTS, view)
      inst.setOption({ series: [{ data }] }, { notMerge: false })
    }, 120)
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
    if (chartShowThresholds && minForceN != null) {
      thresholdLines.push({
        yAxis: minForceN,
        name: `Min ${minForceN.toFixed(2)}${unitSuffix}`,
        lineStyle: { color: '#22c55e', type: 'dashed', width: 1.5 },
        label: { show: true, formatter: `Min ${minForceN.toFixed(2)}${unitSuffix}`, position: 'insideEndTop', fontSize: 11, color: '#22c55e' },
      })
    }
    if (chartShowThresholds && maxForceN != null) {
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
  }, [staticData, cycleBoundaries, minForceN, maxForceN, valueUnit, overlay, isDark, chartShowThresholds])

  // Progressive detail-on-zoom for static data. When the parent supplies a resampler,
  // re-derive a higher-resolution slice of the visible window on every zoom — the same
  // idea as live mode pulling detail from the ring buffer. Without this the static chart
  // only ever shows the once-decimated overview, which looks coarse/sawtoothed zoomed in.
  // rAF-throttled so a pinch doesn't trigger a resample storm; read through a ref so the
  // listener binds once per static dataset, not on every parent re-render.
  const resampleRef = useRef(resampleWindow)
  resampleRef.current = resampleWindow
  useEffect(() => {
    if (staticData === undefined || !resampleWindow) return
    const inst = chartRef.current?.getEchartsInstance()
    if (!inst) return
    let last = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    const refine = () => {
      last = Date.now()
      const fn = resampleRef.current
      if (!fn) return
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ext = (inst as any).getModel?.().getComponent('xAxis', 0)?.axis?.scale?.getExtent?.()
        if (!ext || !Number.isFinite(ext[0]) || !Number.isFinite(ext[1]) || ext[1] <= ext[0]) return
        const data = fn(ext[0], ext[1])
        if (data) inst.setOption({ series: [{ data }] }, { notMerge: false })
      } catch { /* keep current data on any ECharts internals change */ }
    }
    // Leading + trailing throttle (~120 ms, matching live mode's proven cadence) so a
    // pinch doesn't fire a 6000-point setOption every frame on the kiosk PC.
    const onZoom = () => {
      const wait = 120 - (Date.now() - last)
      if (wait <= 0) { if (timer) { clearTimeout(timer); timer = undefined } refine() }
      else if (!timer) timer = setTimeout(() => { timer = undefined; refine() }, wait)
    }
    inst.on('dataZoom', onZoom)
    onZoom() // sync once (e.g. switching view while already zoomed in)
    return () => { inst.off('dataZoom', onZoom); if (timer) clearTimeout(timer) }
    // resampleWindow is read via ref; only re-bind when the static dataset itself changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staticData])

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

  // Reset pinch-zoom/pan to the full range on double-tap (touch) or double-click (mouse).
  // zrender's 'dblclick' fires only for a REAL mouse double-click — on touch, touchend
  // synthesises 'click' but never 'dblclick' (HandlerProxy.js), so the kiosk operator had
  // no way to reset after pinching in. Detect two DOM 'click's within 300 ms on the
  // container instead: that fires for both finger taps and mouse clicks. Reading the
  // instance lazily inside the handler also sidesteps the first-mount race where
  // getEchartsInstance() isn't ready when a `[]` effect runs.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    let lastTap = 0
    const onClick = () => {
      const now = Date.now()
      if (now - lastTap < 300) {
        chartRef.current?.getEchartsInstance()?.dispatchAction({ type: 'dataZoom', start: 0, end: 100 })
        lastTap = 0
      } else {
        lastTap = now
      }
    }
    el.addEventListener('click', onClick)
    return () => el.removeEventListener('click', onClick)
  }, [])

  // Expose a PNG export callback to the parent via exportRef.
  useEffect(() => {
    if (!exportRef) return
    exportRef.current = (filename: string) => {
      const inst = chartRef.current?.getEchartsInstance()
      if (!inst) return
      const url = inst.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: isDark ? '#0f172a' : '#ffffff' })
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
    }
    // Null the callback on unmount so a parent that retained exportRef can't invoke a
    // closure bound to a disposed chart instance after navigating away.
    return () => { exportRef.current = null }
  }, [exportRef, isDark])

  return (
    // touchAction:'none' overrides the global `html { touch-action: pan-y }` (index.css)
    // so the browser stops swallowing pinch/pan gestures and ECharts' inside dataZoom
    // receives them. Without this, touch zoom/pan silently does nothing.
    <div ref={containerRef} style={{ width: '100%', height: '100%', touchAction: 'none' }}>
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
