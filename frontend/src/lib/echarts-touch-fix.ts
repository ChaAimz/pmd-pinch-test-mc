// zrender 6.1.0 misdetects Chromium Edge as legacy EdgeHTML: its UA regex
// `/Edge?\//` (zrender/lib/core/env.js:50) has an optional `e`, so it matches the
// modern Edge token `Edg/` and sets `browser.edge = true`. That cascades to the wrong
// feature flags (env.js:69-71):
//   touchEventsSupported   = 'ontouchstart' in window && !ie && !edge  ->  false
//   pointerEventsSupported = 'onpointerdown' in window && (edge || ...) ->  true
// HandlerProxy then takes the pointer-only branch (HandlerProxy.js:189) and never
// mounts touchstart/touchmove/touchend. Only those touch handlers call
// `processGesture()` (HandlerProxy.js:123/130/136), the pinch recogniser that drives
// `inside` dataZoom; the pointer handlers skip touch-origin pointers entirely
// (isPointerFromTouch guard). Net effect on the Edge touch kiosk: pinch-zoom and
// one-finger pan are dead, while mouse-wheel zoom still works (mounted separately).
//
// Fix: when the device genuinely has touch but zrender wrongly disabled touch events,
// flip the flags to the Chrome-equivalent path (touch + mouse, no pointer). Gate ONLY
// on `navigator.maxTouchPoints > 0` — NOT on `'ontouchstart' in window`. On the actual
// Edge kiosk, `'ontouchstart' in window` is FALSE even though real touchstart/touchmove
// events fire (verified live: maxTouchPoints=10, multi-finger touchstart events reach
// the document). That same false reading is *why* zrender disabled touch in the first
// place (env.js:69 ANDs in `'ontouchstart' in window`), so the patch must not repeat it.
// Safe by construction: it is a no-op on Chrome (pointerEventsSupported already false off
// Edge/IE) and on any non-touch desktop (maxTouchPoints === 0). Even if a hybrid device
// fired no touch events, zrender's else-branch still mounts the mouse handlers, so
// mouse-wheel zoom is never lost.
//
// Imported first in main.tsx so it runs before the first ECharts chart initialises
// (the flags are read at chart-init time, inside echarts' shared zrender singleton).
import env from 'zrender/lib/core/env'

if (
  typeof navigator !== 'undefined' &&
  navigator.maxTouchPoints > 0 &&
  env.pointerEventsSupported &&
  !env.touchEventsSupported
) {
  env.touchEventsSupported = true
  env.pointerEventsSupported = false
}
