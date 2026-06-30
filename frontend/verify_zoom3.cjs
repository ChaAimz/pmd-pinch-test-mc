// Playwright zoom verification v3 — ECharts instance via DOM _ec_ key
// Run from: frontend/ directory
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const SCRATCHPAD = 'C:\\Users\\pmd\\AppData\\Local\\Temp\\claude\\c--Users-pmd-source-repo-pmd-pinch-test-mc\\d3ecd839-f9f7-46db-9a3a-2997e043cf99\\scratchpad';

// ECharts stores the instance reference on the container DOM node under _ec_<id>
// We access it via Object.keys to find the key dynamically.
const GET_DZ_STATE = `
  (() => {
    // Find the echarts root container: div with _echarts_instance_ attribute OR
    // any div whose keys include something starting with '_ec_'
    const allDivs = Array.from(document.querySelectorAll('div'));
    const ecDiv = allDivs.find(d => {
      const attr = d.getAttribute('_echarts_instance_');
      return attr != null;
    });
    if (!ecDiv) return { error: 'no _echarts_instance_ div found' };
    const ecId = ecDiv.getAttribute('_echarts_instance_');
    // The instance is stored on the global echarts._instances map or on the node itself
    // Try finding it via the node's own _ec_ property (set by echarts internals)
    const ecKey = Object.keys(ecDiv).find(k => k.startsWith('__ec_'));
    if (ecKey) {
      // some versions store it directly
      const inst = ecDiv[ecKey];
      if (inst && inst.getOption) {
        const opt = inst.getOption();
        return {
          via: ecKey,
          dataZoom: (opt.dataZoom || []).map(z => ({ type: z.type, start: z.start, end: z.end }))
        };
      }
    }
    // Try the module-scoped storage via storage key on node
    // echarts 5 stores instances in a WeakMap keyed by DOM node; not accessible externally.
    // Best alternative: read the zrender layer's transform/scale as a proxy for zoom level
    const canvas = ecDiv.querySelector('canvas');
    if (!canvas) return { error: 'no canvas in ecDiv', ecId };
    // Read canvas pixel data at the axis label area to detect zoom state change
    // Instead, return the axis tick values visible on the canvas via text extraction
    // from the ECharts SVG layer (if any) or rely on visual diff
    return { error: 'echarts instance not accessible from page context', ecId, ecKey: Object.keys(ecDiv).join(',') };
  })()
`;

// Alternative: use page.evaluate to extract visible axis tick text from DOM
// ECharts canvas renderer doesn't expose tick text in DOM — but we can use
// the zrender storage to find axis models via the global __ecInspect__ if dev
// OR: we intercept the echarts bundle by injecting a script before it loads.

// Better approach: crop screenshots of JUST the x-axis area and compare pixel hashes
// to detect if the tick labels changed (proving zoom worked)

const CROP_XAXIS = async (page, canvasRect, label, outFile) => {
  // Crop to the bottom 80px of the chart canvas where x-axis ticks live
  const clip = {
    x: Math.round(canvasRect.left),
    y: Math.round(canvasRect.bottom - 80),
    width: Math.round(canvasRect.width),
    height: 80
  };
  await page.screenshot({ path: outFile, clip });
  return clip;
};

const CROP_CHART = async (page, canvasRect, outFile) => {
  const clip = {
    x: Math.round(canvasRect.left - 10),
    y: Math.round(canvasRect.top - 10),
    width: Math.round(canvasRect.width + 20),
    height: Math.round(canvasRect.height + 20)
  };
  await page.screenshot({ path: outFile, clip });
};

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();

  const consoleMsgs = [];
  page.on('console', msg => consoleMsgs.push({ type: msg.type(), text: msg.text() }));

  // ── 1. Navigate ────────────────────────────────────────────────────────────
  console.log('=== Navigating to history/130 ===');
  await page.goto('http://localhost:5173/history/130');
  await page.waitForTimeout(4500); // extra slack for parquet fetch + render

  // Full page screenshot
  await page.screenshot({ path: path.join(SCRATCHPAD, 'A1_initial.png') });
  console.log('A1: full page initial');

  // ── 2. DOM touch-action check ──────────────────────────────────────────────
  console.log('\n=== DOM touch-action check ===');
  const domResult = await page.evaluate(() => {
    const canvases = Array.from(document.querySelectorAll('canvas'));
    return canvases.map((canvas, ci) => {
      const chain = [];
      let el = canvas;
      for (let d = 0; d < 8 && el; d++, el = el.parentElement) {
        chain.push({
          d, tag: el.tagName,
          inline: el.style?.touchAction || '',
          computed: getComputedStyle(el).touchAction
        });
      }
      return { ci, chain };
    });
  });

  const taResults = [];
  for (const { ci, chain } of domResult) {
    const fixEl = chain.find(e => e.inline === 'none');
    const msg = fixEl
      ? `Canvas[${ci}]: touch-action:none FOUND at depth=${fixEl.d} (${fixEl.tag}) — FIX APPLIED`
      : `Canvas[${ci}]: touch-action:none NOT FOUND — fix missing`;
    taResults.push(msg);
    console.log(msg);
    chain.slice(0, 5).forEach(e => console.log(`   d${e.d} ${e.tag}: inline="${e.inline}" computed="${e.computed}"`));
  }

  // ── 3. WaveformChart zoom — visual x-axis comparison ──────────────────────
  console.log('\n=== WaveformChart wheel-zoom ===');
  const canvasData = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height,
             cx: r.left + r.width/2, cy: r.top + r.height/2 };
  });

  if (!canvasData) {
    console.log('ERROR: no canvas found');
    await browser.close();
    return;
  }
  console.log('WaveformChart canvas:', JSON.stringify(canvasData));

  // Crop before
  await CROP_XAXIS(page, canvasData, 'before', path.join(SCRATCHPAD, 'B1_xaxis_before.png'));
  await CROP_CHART(page, canvasData, path.join(SCRATCHPAD, 'B2_chart_before.png'));
  console.log('B1/B2: before-zoom crops');

  // Move mouse + wheel zoom x6
  await page.mouse.move(canvasData.cx, canvasData.cy);
  await page.waitForTimeout(200);
  for (let i = 0; i < 6; i++) {
    await page.evaluate(([x, y]) => {
      const el = document.elementFromPoint(x, y);
      if (el) el.dispatchEvent(new WheelEvent('wheel', {
        deltaY: -300, deltaMode: 0, clientX: x, clientY: y, bubbles: true, cancelable: true
      }));
    }, [canvasData.cx, canvasData.cy]);
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(700);

  await CROP_XAXIS(page, canvasData, 'after', path.join(SCRATCHPAD, 'B3_xaxis_after.png'));
  await CROP_CHART(page, canvasData, path.join(SCRATCHPAD, 'B4_chart_after.png'));
  await page.screenshot({ path: path.join(SCRATCHPAD, 'B5_full_after_zoom.png') });
  console.log('B3/B4/B5: after-zoom crops + full page');

  // ── 4. Double-click reset ──────────────────────────────────────────────────
  console.log('\n=== Double-click reset ===');
  await page.evaluate(([x, y]) => {
    const el = document.elementFromPoint(x, y);
    if (el) el.dispatchEvent(new MouseEvent('dblclick', { clientX: x, clientY: y, bubbles: true, cancelable: true }));
  }, [canvasData.cx, canvasData.cy]);
  await page.waitForTimeout(700);

  await CROP_XAXIS(page, canvasData, 'reset', path.join(SCRATCHPAD, 'B6_xaxis_reset.png'));
  await CROP_CHART(page, canvasData, path.join(SCRATCHPAD, 'B7_chart_reset.png'));
  console.log('B6/B7: after-dblclick-reset crops');

  // ── 5. MaxCycleChart ───────────────────────────────────────────────────────
  console.log('\n=== MaxCycleChart ===');
  const maxBtn = page.locator('button', { hasText: 'All Max' }).first();
  if (await maxBtn.count() > 0) {
    await maxBtn.click();
    console.log('Clicked "All Max"');
    await page.waitForTimeout(1500);
  } else {
    console.log('No "All Max" button found');
  }

  await page.screenshot({ path: path.join(SCRATCHPAD, 'C0_max_full.png') });

  const maxCanvasData = await page.evaluate(() => {
    // After clicking "All Max", MaxCycleChart may render alongside WaveformChart
    // or replace it. Find the canvas(es).
    const canvases = Array.from(document.querySelectorAll('canvas'));
    return canvases.map(c => {
      const r = c.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom,
               width: r.width, height: r.height, cx: r.left+r.width/2, cy: r.top+r.height/2 };
    });
  });
  console.log(`Canvases after Max toggle: ${maxCanvasData.length}`, JSON.stringify(maxCanvasData));

  // DOM check for MaxCycleChart containers
  const maxDomCheck = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('canvas')).map((canvas, ci) => {
      const chain = [];
      let el = canvas;
      for (let d = 0; d < 6 && el; d++, el = el.parentElement) {
        chain.push({ d, tag: el.tagName, inline: el.style?.touchAction || '', computed: getComputedStyle(el).touchAction });
      }
      return { ci, fixApplied: chain.some(e => e.inline === 'none'), chain };
    });
  });
  for (const { ci, fixApplied, chain } of maxDomCheck) {
    console.log(`MaxChart Canvas[${ci}]: touch-action:none = ${fixApplied ? 'YES' : 'NO'}`);
    chain.slice(0,4).forEach(e => console.log(`   d${e.d} ${e.tag}: inline="${e.inline}" computed="${e.computed}"`));
  }

  // Wheel-zoom on the last canvas (most likely the MaxCycleChart if two are present)
  const targetCanvas = maxCanvasData[maxCanvasData.length - 1];
  if (targetCanvas) {
    const { cx: mcx, cy: mcy } = targetCanvas;

    await CROP_XAXIS(page, targetCanvas, 'max_before', path.join(SCRATCHPAD, 'C1_max_xaxis_before.png'));
    await CROP_CHART(page, targetCanvas, path.join(SCRATCHPAD, 'C2_max_chart_before.png'));

    await page.mouse.move(mcx, mcy);
    await page.waitForTimeout(200);
    for (let i = 0; i < 6; i++) {
      await page.evaluate(([x, y]) => {
        const el = document.elementFromPoint(x, y);
        if (el) el.dispatchEvent(new WheelEvent('wheel', {
          deltaY: -300, deltaMode: 0, clientX: x, clientY: y, bubbles: true, cancelable: true
        }));
      }, [mcx, mcy]);
      await page.waitForTimeout(120);
    }
    await page.waitForTimeout(700);

    await CROP_XAXIS(page, targetCanvas, 'max_after', path.join(SCRATCHPAD, 'C3_max_xaxis_after.png'));
    await CROP_CHART(page, targetCanvas, path.join(SCRATCHPAD, 'C4_max_chart_after.png'));
    await page.screenshot({ path: path.join(SCRATCHPAD, 'C5_max_full_after_zoom.png') });
    console.log('C1–C5: MaxCycleChart zoom screenshots');

    // Dblclick reset
    await page.evaluate(([x, y]) => {
      const el = document.elementFromPoint(x, y);
      if (el) el.dispatchEvent(new MouseEvent('dblclick', { clientX: x, clientY: y, bubbles: true }));
    }, [mcx, mcy]);
    await page.waitForTimeout(700);
    await CROP_CHART(page, targetCanvas, path.join(SCRATCHPAD, 'C6_max_chart_reset.png'));
    console.log('C6: MaxCycleChart after dblclick reset');
  }

  // ── 6. Synthetic touch pinch ───────────────────────────────────────────────
  console.log('\n=== Synthetic touch pinch ===');
  await page.goto('http://localhost:5173/history/130');
  await page.waitForTimeout(3500);

  const pinchCanvas = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return { cx: r.left + r.width/2, cy: r.top + r.height/2, w: r.width };
  });

  if (pinchCanvas) {
    const { cx, cy } = pinchCanvas;

    // Before crop
    const preCanvas = await page.evaluate(() => {
      const c = document.querySelector('canvas');
      if (!c) return null;
      const r = c.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    });
    await CROP_XAXIS(page, preCanvas, 'pinch_before', path.join(SCRATCHPAD, 'D1_pinch_xaxis_before.png'));
    await CROP_CHART(page, preCanvas, path.join(SCRATCHPAD, 'D2_pinch_chart_before.png'));

    const pinchResult = await page.evaluate(([cx, cy]) => {
      const el = document.elementFromPoint(cx, cy);
      if (!el) return 'no el';
      const mk = (id, dx) => new Touch({ identifier: id, target: el, clientX: cx+dx, clientY: cy, radiusX: 10, radiusY: 10, rotationAngle: 0, force: 1 });
      try {
        el.dispatchEvent(new TouchEvent('touchstart', {
          touches: [mk(1,-15), mk(2,15)], targetTouches: [mk(1,-15), mk(2,15)],
          changedTouches: [mk(1,-15), mk(2,15)], bubbles: true, cancelable: true
        }));
        for (let s=1; s<=8; s++) {
          const dx = 15 + s * 16;
          el.dispatchEvent(new TouchEvent('touchmove', {
            touches: [mk(1,-dx), mk(2,dx)], targetTouches: [mk(1,-dx), mk(2,dx)],
            changedTouches: [mk(1,-dx), mk(2,dx)], bubbles: true, cancelable: true
          }));
        }
        el.dispatchEvent(new TouchEvent('touchend', {
          touches: [], targetTouches: [],
          changedTouches: [mk(1,-143), mk(2,143)], bubbles: true, cancelable: true
        }));
        return 'ok';
      } catch(e) { return 'error: ' + e.message; }
    }, [cx, cy]);
    console.log('Pinch dispatch:', pinchResult);
    await page.waitForTimeout(700);

    await CROP_XAXIS(page, preCanvas, 'pinch_after', path.join(SCRATCHPAD, 'D3_pinch_xaxis_after.png'));
    await CROP_CHART(page, preCanvas, path.join(SCRATCHPAD, 'D4_pinch_chart_after.png'));
    console.log('D1–D4: synthetic pinch before/after crops');
  }

  // ── 7. Console summary ─────────────────────────────────────────────────────
  const errors = consoleMsgs.filter(m => m.type === 'error');
  fs.writeFileSync(path.join(SCRATCHPAD, 'console_v3.json'), JSON.stringify(consoleMsgs, null, 2));
  console.log(`\n=== Console errors: ${errors.length} ===`);
  [...new Set(errors.map(e => e.text.split('\n')[0].substring(0,120)))].forEach(t => console.log(' ', t));

  await browser.close();
  console.log('\n=== DONE ===');
})().catch(e => { console.error('FATAL:', e.message, '\n', e.stack); process.exit(1); });
