// Targeted Playwright verification — reads ECharts dataZoom state numerically
// Run from: frontend/ directory
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const SCRATCHPAD = 'C:\\Users\\pmd\\AppData\\Local\\Temp\\claude\\c--Users-pmd-source-repo-pmd-pinch-test-mc\\d3ecd839-f9f7-46db-9a3a-2997e043cf99\\scratchpad';

// Helper: read ECharts dataZoom state from the first echarts instance on the page
const READ_ZOOM = `
  (() => {
    // echarts keeps a registry: echarts.getInstanceById / iterating the chart list
    // The easiest cross-version way: find the echarts _ec_ property on the DOM node
    const nodes = Array.from(document.querySelectorAll('div._echarts_instance_'));
    if (!nodes.length) {
      // fallback: look for __echarts_instance__ attribute (older echarts)
      const fallback = Array.from(document.querySelectorAll('[_echarts_instance_]'));
      nodes.push(...fallback);
    }
    if (!nodes.length) return { error: 'no echarts instance nodes found' };
    // Use the global echarts object from the page bundle
    const echarts = window.echarts;
    if (!echarts) return { error: 'window.echarts not exposed' };
    const inst = echarts.getInstanceByDom(nodes[0]);
    if (!inst) return { error: 'getInstanceByDom returned null' };
    const model = inst.getModel();
    if (!model) return { error: 'getModel() null' };
    const dzModels = model.queryComponents({ mainType: 'dataZoom' });
    if (!dzModels || !dzModels.length) return { error: 'no dataZoom components' };
    return dzModels.map((dz, i) => ({
      index: i,
      type: dz.type,
      start: dz.option ? dz.option.start : '?',
      end: dz.option ? dz.option.end : '?',
      // percentRange is start..end (0..100 = full view)
    }));
  })()
`;

// Simpler fallback: just read the x-axis visible range from the grid
const READ_XAXIS = `
  (() => {
    const echarts = window.echarts;
    if (!echarts) return { error: 'no echarts' };
    const nodes = Array.from(document.querySelectorAll('div[_echarts_instance_]'));
    if (!nodes.length) return { error: 'no echarts nodes' };
    const inst = echarts.getInstanceByDom(nodes[0]);
    if (!inst) return { error: 'no inst' };
    // getOption() returns the merged option including dataZoom state
    const opt = inst.getOption();
    const dz = opt.dataZoom;
    const xa = opt.xAxis;
    return {
      dataZoom: dz ? dz.map(z => ({ type: z.type, start: z.start, end: z.end, startValue: z.startValue, endValue: z.endValue })) : [],
      xAxisMin: xa && xa[0] ? xa[0].min : '?',
      xAxisMax: xa && xa[0] ? xa[0].max : '?',
    };
  })()
`;

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();

  const consoleMsgs = [];
  page.on('console', msg => consoleMsgs.push({ type: msg.type(), text: msg.text() }));

  // ── 1. Navigate and wait for page + chart ──────────────────────────────────
  console.log('=== STEP 1: Navigate to history/130 ===');
  await page.goto('http://localhost:5173/history/130');
  await page.waitForTimeout(4000);

  await page.screenshot({ path: path.join(SCRATCHPAD, 'A1_initial_1440.png') });
  console.log('Screenshot A1: initial page (1440px wide)');

  // ── 2. DOM check — confirm touch-action:none on chart container ─────────────
  console.log('\n=== STEP 2: DOM touch-action check ===');
  const domCheck = await page.evaluate(() => {
    const canvases = Array.from(document.querySelectorAll('canvas'));
    return canvases.map((canvas, ci) => {
      const results = [];
      let el = canvas;
      for (let depth = 0; depth < 10 && el; depth++, el = el.parentElement) {
        const inline = el.style ? el.style.touchAction : '';
        const computed = getComputedStyle(el).touchAction;
        if (inline || depth <= 4) {
          results.push({ depth, tag: el.tagName, inline, computed });
        }
      }
      return { canvasIndex: ci, ancestors: results };
    });
  });

  for (const { canvasIndex, ancestors } of domCheck) {
    console.log(`\nCanvas[${canvasIndex}]:`);
    for (const a of ancestors) {
      const marker = a.inline === 'none' ? ' <<<< FIX APPLIED' : '';
      console.log(`  depth${a.depth} ${a.tag}: inline="${a.inline}" computed="${a.computed}"${marker}`);
    }
  }

  // ── 3. WaveformChart wheel-zoom — read axis range before/after ─────────────
  console.log('\n=== STEP 3: WaveformChart wheel-zoom ===');

  // Get canvas center
  const canvasInfo = await page.evaluate(() => {
    const canvases = Array.from(document.querySelectorAll('canvas'));
    return canvases.map(c => {
      const r = c.getBoundingClientRect();
      return { cx: r.left + r.width/2, cy: r.top + r.height/2, w: r.width, h: r.height };
    });
  });
  console.log('Canvas count:', canvasInfo.length, 'rects:', JSON.stringify(canvasInfo));

  if (canvasInfo.length === 0) {
    console.log('ERROR: no canvases found — chart did not render');
    await browser.close();
    return;
  }

  const { cx, cy } = canvasInfo[0];

  // Read ECharts zoom state before
  const zoomBefore = await page.evaluate(READ_XAXIS);
  console.log('Zoom state BEFORE wheel:', JSON.stringify(zoomBefore, null, 2));

  // Screenshot before
  await page.screenshot({ path: path.join(SCRATCHPAD, 'B1_waveform_before_zoom.png') });

  // Move mouse over chart
  await page.mouse.move(cx, cy);
  await page.waitForTimeout(100);

  // Dispatch 6 wheel events (deltaY negative = zoom in)
  for (let i = 0; i < 6; i++) {
    await page.evaluate(([x, y]) => {
      const el = document.elementFromPoint(x, y);
      if (el) el.dispatchEvent(new WheelEvent('wheel', {
        deltaY: -300, deltaMode: 0,
        clientX: x, clientY: y,
        bubbles: true, cancelable: true
      }));
    }, [cx, cy]);
    await page.waitForTimeout(100);
  }
  await page.waitForTimeout(600);

  // Read ECharts zoom state after
  const zoomAfter = await page.evaluate(READ_XAXIS);
  console.log('Zoom state AFTER wheel:', JSON.stringify(zoomAfter, null, 2));

  // Screenshot after
  await page.screenshot({ path: path.join(SCRATCHPAD, 'B2_waveform_after_zoom.png') });

  // Evaluate zoom effectiveness
  const dzBefore = zoomBefore.dataZoom || [];
  const dzAfter = zoomAfter.dataZoom || [];
  if (dzBefore.length && dzAfter.length) {
    const xBefore = dzBefore.find(z => z.type && z.type.includes('inside')) || dzBefore[0];
    const xAfter = dzAfter.find(z => z.type && z.type.includes('inside')) || dzAfter[0];
    const rangeBefore = (xBefore.end ?? 100) - (xBefore.start ?? 0);
    const rangeAfter = (xAfter.end ?? 100) - (xAfter.start ?? 0);
    console.log(`\nX-axis range: before=${rangeBefore.toFixed(1)}% after=${rangeAfter.toFixed(1)}%`);
    if (rangeAfter < rangeBefore - 5) {
      console.log('RESULT: WaveformChart wheel-zoom -> WORKS (x range narrowed)');
    } else {
      console.log('RESULT: WaveformChart wheel-zoom -> POSSIBLY FAILED (range unchanged)');
    }
  } else {
    console.log('Could not read dataZoom state from ECharts option');
    // Fall back to visual comparison only
  }

  // ── 4. Double-click reset ──────────────────────────────────────────────────
  console.log('\n=== STEP 4: Double-click reset ===');
  // zrender listens for dblclick; dispatch it directly on the canvas
  await page.evaluate(([x, y]) => {
    const el = document.elementFromPoint(x, y);
    if (el) el.dispatchEvent(new MouseEvent('dblclick', { clientX: x, clientY: y, bubbles: true, cancelable: true }));
  }, [cx, cy]);
  await page.waitForTimeout(600);

  const zoomAfterReset = await page.evaluate(READ_XAXIS);
  console.log('Zoom state AFTER dblclick reset:', JSON.stringify(zoomAfterReset, null, 2));
  await page.screenshot({ path: path.join(SCRATCHPAD, 'B3_waveform_after_dblclick.png') });

  const dzReset = zoomAfterReset.dataZoom || [];
  if (dzReset.length) {
    const xr = dzReset.find(z => z.type && z.type.includes('inside')) || dzReset[0];
    const resetStart = xr.start ?? 0;
    const resetEnd = xr.end ?? 100;
    if (Math.abs(resetStart) < 2 && Math.abs(resetEnd - 100) < 2) {
      console.log('RESULT: Double-click reset -> WORKS (returned to 0..100%)');
    } else {
      console.log(`RESULT: Double-click reset -> check manually (start=${resetStart} end=${resetEnd})`);
    }
  }

  // ── 5. MaxCycleChart ────────────────────────────────────────────────────────
  console.log('\n=== STEP 5: MaxCycleChart (All Max) ===');

  // Find and click the "All Max" or "Max / Cycle" toggle
  const allButtons = await page.evaluate(() =>
    Array.from(document.querySelectorAll('button')).map(b => b.textContent?.trim() || '')
  );
  console.log('All buttons:', allButtons.filter(t => t).join(' | '));

  // Click "All Max" button
  const maxBtn = page.locator('button', { hasText: 'All Max' }).first();
  if (await maxBtn.count() > 0) {
    await maxBtn.click();
    console.log('Clicked "All Max" button');
  } else {
    // try "Max / Cycle"
    const maxCycleBtn = page.locator('button', { hasText: 'Max / Cycle' }).first();
    if (await maxCycleBtn.count() > 0) {
      await maxCycleBtn.click();
      console.log('Clicked "Max / Cycle" button');
    } else {
      console.log('No MaxCycleChart toggle found; trying all text buttons:');
      console.log(allButtons.join(', '));
    }
  }
  await page.waitForTimeout(1500);

  await page.screenshot({ path: path.join(SCRATCHPAD, 'C1_max_cycle_chart.png') });
  console.log('Screenshot C1: after clicking Max toggle');

  // Check if MaxCycleChart is now rendered (may be a second canvas or same canvas with new data)
  const maxCanvasInfo = await page.evaluate(() => {
    const canvases = Array.from(document.querySelectorAll('canvas'));
    return canvases.map(c => {
      const r = c.getBoundingClientRect();
      return { cx: r.left + r.width/2, cy: r.top + r.height/2, w: r.width, h: r.height };
    });
  });
  console.log('Max chart canvases:', JSON.stringify(maxCanvasInfo));

  // DOM check on new canvas layout
  const domCheckMax = await page.evaluate(() => {
    const canvases = Array.from(document.querySelectorAll('canvas'));
    return canvases.map((canvas, ci) => {
      const results = [];
      let el = canvas;
      for (let depth = 0; depth < 6 && el; depth++, el = el.parentElement) {
        results.push({
          depth, tag: el.tagName,
          inline: el.style ? el.style.touchAction : '',
          computed: getComputedStyle(el).touchAction
        });
      }
      return { ci, ancestors: results };
    });
  });
  for (const { ci, ancestors } of domCheckMax) {
    const noneFound = ancestors.find(a => a.inline === 'none');
    console.log(`MaxChart Canvas[${ci}]: touch-action:none ancestor = ${noneFound ? 'YES at depth ' + noneFound.depth : 'NOT FOUND'}`);
  }

  if (maxCanvasInfo.length > 0) {
    const { cx: mcx, cy: mcy } = maxCanvasInfo[0];

    const maxZoomBefore = await page.evaluate(READ_XAXIS);
    console.log('MaxChart zoom BEFORE:', JSON.stringify(maxZoomBefore, null, 2));

    await page.screenshot({ path: path.join(SCRATCHPAD, 'C2_max_before_zoom.png') });

    await page.mouse.move(mcx, mcy);
    await page.waitForTimeout(100);
    for (let i = 0; i < 6; i++) {
      await page.evaluate(([x, y]) => {
        const el = document.elementFromPoint(x, y);
        if (el) el.dispatchEvent(new WheelEvent('wheel', {
          deltaY: -300, deltaMode: 0,
          clientX: x, clientY: y,
          bubbles: true, cancelable: true
        }));
      }, [mcx, mcy]);
      await page.waitForTimeout(100);
    }
    await page.waitForTimeout(600);

    const maxZoomAfter = await page.evaluate(READ_XAXIS);
    console.log('MaxChart zoom AFTER:', JSON.stringify(maxZoomAfter, null, 2));

    await page.screenshot({ path: path.join(SCRATCHPAD, 'C3_max_after_zoom.png') });

    const mdzB = (maxZoomBefore.dataZoom || []);
    const mdzA = (maxZoomAfter.dataZoom || []);
    if (mdzB.length && mdzA.length) {
      const mb = mdzB[0]; const ma = mdzA[0];
      const rb = (mb.end ?? 100) - (mb.start ?? 0);
      const ra = (ma.end ?? 100) - (ma.start ?? 0);
      console.log(`MaxChart range: before=${rb.toFixed(1)}% after=${ra.toFixed(1)}%`);
      console.log(`RESULT: MaxCycleChart wheel-zoom -> ${ra < rb - 5 ? 'WORKS' : 'POSSIBLY FAILED'}`);
    }

    // Double-click reset
    await page.evaluate(([x, y]) => {
      const el = document.elementFromPoint(x, y);
      if (el) el.dispatchEvent(new MouseEvent('dblclick', { clientX: x, clientY: y, bubbles: true }));
    }, [mcx, mcy]);
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(SCRATCHPAD, 'C4_max_after_dblclick.png') });
    const maxZoomReset = await page.evaluate(READ_XAXIS);
    const mdzR = (maxZoomReset.dataZoom || []);
    if (mdzR.length) {
      const mr = mdzR[0];
      const s = mr.start ?? 0; const e = mr.end ?? 100;
      console.log(`MaxChart after dblclick: start=${s} end=${e} -> ${Math.abs(s) < 2 && Math.abs(e-100) < 2 ? 'RESET OK' : 'NOT FULLY RESET'}`);
    }
  }

  // ── 6. Synthetic touch pinch ────────────────────────────────────────────────
  console.log('\n=== STEP 6: Synthetic touch pinch ===');
  // Navigate back to waveform chart for a clean test
  await page.goto('http://localhost:5173/history/130');
  await page.waitForTimeout(3000);

  const ci2 = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return { cx: r.left + r.width/2, cy: r.top + r.height/2 };
  });

  const zoomBeforePinch = await page.evaluate(READ_XAXIS);
  console.log('Zoom BEFORE pinch:', JSON.stringify(zoomBeforePinch, null, 2));

  const pinchResult = ci2 ? await page.evaluate(([cx, cy]) => {
    const el = document.elementFromPoint(cx, cy);
    if (!el) return 'no element at point';
    const results = [];
    // Start: two fingers 30px apart
    const mkTouch = (id, dx) => new Touch({ identifier: id, target: el, clientX: cx + dx, clientY: cy, radiusX: 10, radiusY: 10, rotationAngle: 0, force: 1 });

    try {
      el.dispatchEvent(new TouchEvent('touchstart', {
        touches: [mkTouch(1, -15), mkTouch(2, 15)],
        targetTouches: [mkTouch(1, -15), mkTouch(2, 15)],
        changedTouches: [mkTouch(1, -15), mkTouch(2, 15)],
        bubbles: true, cancelable: true
      }));
      results.push('touchstart dispatched');

      // Spread from ±15 to ±145 over 8 moves
      for (let step = 1; step <= 8; step++) {
        const dx = 15 + step * 16; // 31..143
        el.dispatchEvent(new TouchEvent('touchmove', {
          touches: [mkTouch(1, -dx), mkTouch(2, dx)],
          targetTouches: [mkTouch(1, -dx), mkTouch(2, dx)],
          changedTouches: [mkTouch(1, -dx), mkTouch(2, dx)],
          bubbles: true, cancelable: true
        }));
      }
      results.push('touchmove x8 dispatched');

      el.dispatchEvent(new TouchEvent('touchend', {
        touches: [], targetTouches: [],
        changedTouches: [mkTouch(1, -143), mkTouch(2, 143)],
        bubbles: true, cancelable: true
      }));
      results.push('touchend dispatched');
      return results.join('; ');
    } catch (e) {
      return 'error: ' + e.message;
    }
  }, [ci2.cx, ci2.cy]) : 'no canvas found';

  console.log('Pinch dispatch result:', pinchResult);
  await page.waitForTimeout(600);

  const zoomAfterPinch = await page.evaluate(READ_XAXIS);
  console.log('Zoom AFTER pinch:', JSON.stringify(zoomAfterPinch, null, 2));

  await page.screenshot({ path: path.join(SCRATCHPAD, 'D1_after_pinch.png') });

  const dzPB = (zoomBeforePinch.dataZoom || []);
  const dzPA = (zoomAfterPinch.dataZoom || []);
  if (dzPB.length && dzPA.length) {
    const rB = (dzPB[0].end ?? 100) - (dzPB[0].start ?? 0);
    const rA = (dzPA[0].end ?? 100) - (dzPA[0].start ?? 0);
    console.log(`Pinch range: before=${rB.toFixed(1)}% after=${rA.toFixed(1)}%`);
    console.log(`RESULT: synthetic pinch -> ${rA < rB - 5 ? 'WORKS' : 'INCONCLUSIVE (unchanged)'}`);
  }

  // ── 7. Console error summary ─────────────────────────────────────────────────
  console.log('\n=== STEP 7: Console messages ===');
  const errors = consoleMsgs.filter(m => m.type === 'error');
  const warnings = consoleMsgs.filter(m => m.type === 'warning');
  fs.writeFileSync(path.join(SCRATCHPAD, 'console_msgs2.json'), JSON.stringify(consoleMsgs, null, 2));
  console.log(`Total console errors: ${errors.length}, warnings: ${warnings.length}`);

  // Deduplicate errors
  const uniqueErrors = [...new Set(errors.map(e => e.text.split('\n')[0].substring(0, 120)))];
  uniqueErrors.forEach(e => console.log(`  [ERROR] ${e}`));

  await browser.close();
  console.log('\n=== DONE ===');
})().catch(e => {
  console.error('FATAL:', e.message, e.stack);
  process.exit(1);
});
