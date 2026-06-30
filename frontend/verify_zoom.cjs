// Playwright verification script for touch-action / zoom fix
// Run from: frontend/ directory
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const SCRATCHPAD = 'C:\\Users\\pmd\\AppData\\Local\\Temp\\claude\\c--Users-pmd-source-repo-pmd-pinch-test-mc\\d3ecd839-f9f7-46db-9a3a-2997e043cf99\\scratchpad';

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  // Capture console messages
  const consoleMsgs = [];
  page.on('console', msg => {
    consoleMsgs.push({ type: msg.type(), text: msg.text() });
  });

  // 1. Navigate
  console.log('Navigating to history/130...');
  await page.goto('http://localhost:5173/history/130');
  await page.waitForTimeout(4000); // let charts render (parquet fetch + ECharts init)

  // Take initial screenshot
  await page.screenshot({ path: path.join(SCRATCHPAD, '01_initial.png') });
  console.log('Screenshot 1: initial page taken');

  // 2. DOM check — walk up from each canvas checking touch-action
  const touchActionChain = await page.evaluate(() => {
    const canvases = Array.from(document.querySelectorAll('canvas'));
    return canvases.map((c, ci) => {
      let el = c;
      const chain = [];
      for (let i = 0; i < 8 && el; i++, el = el.parentElement) {
        chain.push({
          tag: el.tagName,
          id: el.id || '',
          className: (typeof el.className === 'string' ? el.className : '').substring(0, 80),
          inline: el.style ? (el.style.touchAction || '') : '',
          computed: getComputedStyle(el).touchAction
        });
      }
      return { canvasIndex: ci, chain };
    });
  });

  fs.writeFileSync(path.join(SCRATCHPAD, 'touch_action_chain.json'), JSON.stringify(touchActionChain, null, 2));
  console.log(`Found ${touchActionChain.length} canvas elements`);

  for (const { canvasIndex, chain } of touchActionChain) {
    const noneEl = chain.find(el => el.inline === 'none');
    const computedNone = chain.find(el => el.computed === 'none');
    console.log(`Canvas[${canvasIndex}]: inline touch-action:none = ${noneEl ? 'YES on ' + noneEl.tag + '.'+noneEl.className.split(' ')[0] : 'NOT FOUND'}`);
    console.log(`Canvas[${canvasIndex}]: computed touch-action:none = ${computedNone ? 'YES on ' + computedNone.tag : 'NOT FOUND (all pan-y or auto?)'}`);
    // Print first 4 of the chain
    chain.slice(0,5).forEach((el, i) => {
      console.log(`  [${i}] ${el.tag} | inline="${el.inline}" | computed="${el.computed}" | class="${el.className.substring(0,50)}"`);
    });
  }

  // 3. Mouse-wheel zoom test on WaveformChart (first canvas = waveform chart)
  const canvasRects = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('canvas')).map(c => {
      const r = c.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, left: r.left, top: r.top, width: r.width, height: r.height };
    });
  });
  console.log('Canvas rects:', JSON.stringify(canvasRects));

  if (canvasRects.length > 0) {
    const { x: cx, y: cy } = canvasRects[0];
    console.log(`Wheel-zooming WaveformChart at (${cx}, ${cy})`);

    // Take before-zoom screenshot
    await page.screenshot({ path: path.join(SCRATCHPAD, '02_waveform_before_zoom.png') });
    console.log('Screenshot 2: WaveformChart before zoom');

    // Move mouse to chart center first
    await page.mouse.move(cx, cy);
    await page.waitForTimeout(100);

    // Dispatch 5 wheel-zoom-in events
    for (let i = 0; i < 5; i++) {
      await page.evaluate(([x, y]) => {
        const el = document.elementFromPoint(x, y);
        if (el) {
          el.dispatchEvent(new WheelEvent('wheel', {
            deltaY: -300,
            clientX: x,
            clientY: y,
            bubbles: true,
            cancelable: true
          }));
        }
      }, [cx, cy]);
      await page.waitForTimeout(150);
    }

    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(SCRATCHPAD, '03_waveform_after_zoom.png') });
    console.log('Screenshot 3: WaveformChart after zoom');

    // 4. Double-click reset
    await page.evaluate(([x, y]) => {
      const el = document.elementFromPoint(x, y);
      if (el) {
        el.dispatchEvent(new MouseEvent('dblclick', { clientX: x, clientY: y, bubbles: true }));
      }
    }, [cx, cy]);
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(SCRATCHPAD, '04_waveform_after_dblclick.png') });
    console.log('Screenshot 4: WaveformChart after double-click reset');
  }

  // 5. Find toggle buttons for MaxCycleChart
  const pageButtons = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('button')).map(b => ({
      text: b.textContent?.trim().substring(0, 50) || '',
      type: b.type || '',
      id: b.id || '',
      disabled: b.disabled
    })).filter(b => b.text);
  });

  fs.writeFileSync(path.join(SCRATCHPAD, 'page_buttons.json'), JSON.stringify(pageButtons, null, 2));
  console.log('Buttons found:', pageButtons.map(b => `"${b.text}"`).join(', '));

  // Look for view toggle buttons (All, Max, CoF, etc.)
  const viewToggle = pageButtons.find(b =>
    /all|max|cof|cycle|view/i.test(b.text)
  );
  console.log('View toggle candidate:', JSON.stringify(viewToggle));

  // Try to click any button that would show MaxCycleChart
  // Common labels: "All Cycles", "Max", "CoF", "All Max"
  const maxBtn = await page.$('button:has-text("All"), button:has-text("Max"), button:has-text("CoF"), button:has-text("All Max")');
  if (maxBtn) {
    const btnText = await maxBtn.textContent();
    console.log(`Found MaxCycleChart toggle button: "${btnText}"`);
    await maxBtn.click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(SCRATCHPAD, '05_max_cycle_chart.png') });
    console.log('Screenshot 5: MaxCycleChart view activated');

    // Now test wheel zoom on the MaxCycleChart
    const maxCanvasRects = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('canvas')).map(c => {
        const r = c.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2, width: r.width, height: r.height };
      });
    });

    if (maxCanvasRects.length > 0) {
      const { x: mcx, y: mcy } = maxCanvasRects[0];
      await page.mouse.move(mcx, mcy);
      await page.waitForTimeout(100);

      await page.screenshot({ path: path.join(SCRATCHPAD, '06_max_before_zoom.png') });
      console.log('Screenshot 6: MaxCycleChart before zoom');

      for (let i = 0; i < 5; i++) {
        await page.evaluate(([x, y]) => {
          const el = document.elementFromPoint(x, y);
          if (el) {
            el.dispatchEvent(new WheelEvent('wheel', {
              deltaY: -300,
              clientX: x,
              clientY: y,
              bubbles: true,
              cancelable: true
            }));
          }
        }, [mcx, mcy]);
        await page.waitForTimeout(150);
      }

      await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(SCRATCHPAD, '07_max_after_zoom.png') });
      console.log('Screenshot 7: MaxCycleChart after zoom');

      // Double-click reset
      await page.evaluate(([x, y]) => {
        const el = document.elementFromPoint(x, y);
        if (el) {
          el.dispatchEvent(new MouseEvent('dblclick', { clientX: x, clientY: y, bubbles: true }));
        }
      }, [mcx, mcy]);
      await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(SCRATCHPAD, '08_max_after_dblclick.png') });
      console.log('Screenshot 8: MaxCycleChart after double-click reset');
    }
  } else {
    console.log('No MaxCycleChart toggle button found; trying page snapshot for clues');
    const content = await page.content();
    const snippet = content.substring(0, 3000);
    console.log('Page content snippet (first 3000 chars):');
    console.log(snippet);
  }

  // 6. Synthetic touch pinch (best-effort)
  if (canvasRects.length > 0) {
    // Navigate back to waveform view first if needed
    await page.goto('http://localhost:5173/history/130');
    await page.waitForTimeout(3000);

    const { x: cx, y: cy } = canvasRects[0];

    const touchPinchResult = await page.evaluate(([centerX, centerY]) => {
      try {
        const el = document.elementFromPoint(centerX, centerY);
        if (!el) return 'no element at canvas center';

        // Two-finger pinch: fingers start close, spread apart
        const t1start = new Touch({ identifier: 1, target: el, clientX: centerX - 20, clientY: centerY });
        const t2start = new Touch({ identifier: 2, target: el, clientX: centerX + 20, clientY: centerY });
        el.dispatchEvent(new TouchEvent('touchstart', {
          touches: [t1start, t2start],
          targetTouches: [t1start, t2start],
          changedTouches: [t1start, t2start],
          bubbles: true, cancelable: true
        }));

        // Spread fingers apart (simulate zoom-in pinch)
        for (let i = 1; i <= 5; i++) {
          const offset = 20 + i * 25;
          const t1 = new Touch({ identifier: 1, target: el, clientX: centerX - offset, clientY: centerY });
          const t2 = new Touch({ identifier: 2, target: el, clientX: centerX + offset, clientY: centerY });
          el.dispatchEvent(new TouchEvent('touchmove', {
            touches: [t1, t2],
            targetTouches: [t1, t2],
            changedTouches: [t1, t2],
            bubbles: true, cancelable: true
          }));
        }

        const t1end = new Touch({ identifier: 1, target: el, clientX: centerX - 145, clientY: centerY });
        const t2end = new Touch({ identifier: 2, target: el, clientX: centerX + 145, clientY: centerY });
        el.dispatchEvent(new TouchEvent('touchend', {
          touches: [],
          targetTouches: [],
          changedTouches: [t1end, t2end],
          bubbles: true, cancelable: true
        }));
        return 'dispatched successfully';
      } catch (e) {
        return 'error: ' + e.message;
      }
    }, [cx, cy]);

    console.log('Synthetic touch pinch result:', touchPinchResult);
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(SCRATCHPAD, '09_after_touch_pinch.png') });
    console.log('Screenshot 9: after synthetic touch pinch');
  }

  await browser.close();

  // Write console messages
  const errors = consoleMsgs.filter(m => m.type === 'error');
  const warnings = consoleMsgs.filter(m => m.type === 'warning');
  fs.writeFileSync(path.join(SCRATCHPAD, 'console_msgs.json'), JSON.stringify(consoleMsgs, null, 2));
  console.log(`\nConsole errors: ${errors.length}, warnings: ${warnings.length}`);
  if (errors.length) {
    errors.forEach(e => console.log(`  [ERROR] ${e.text}`));
  }
  if (warnings.length) {
    warnings.forEach(w => console.log(`  [WARN] ${w.text}`));
  }

  console.log('\nDONE — check scratchpad for screenshots and JSON files');
})().catch(e => {
  console.error('FATAL:', e.message);
  console.error(e.stack);
  process.exit(1);
});
