import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || '/Users/ddl/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const base = process.env.TEST_URL || 'http://127.0.0.1:1234';
const output = new URL('./', import.meta.url);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const results = [];
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const release = JSON.parse(await readFile('frontend/config/release-content.json', 'utf8'));
  await context.addInitScript((release) => {
    localStorage.setItem('user.email', 'layout-check@example.com');
    localStorage.setItem('user.registered', 'true');
    localStorage.setItem(`releaseTour.seen.${encodeURIComponent(release.releaseId)}`, 'true');
    for (const tip of release.tips) localStorage.setItem(`releaseTip.opened.${encodeURIComponent(release.releaseId)}.${encodeURIComponent(tip.id)}`, 'true');
  }, release);
  await context.route('**/*', route => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
  const page = await context.newPage();
  await page.goto(base);
  await page.waitForFunction(() => Boolean(window.app?.router));
  for (const [tool, layout, resizer, pseudo] of [
    ['html-template', '.html-template-layout', '.html-template-resizer', '::before'],
    ['velocity-template', '.vtl-layout', '.vtl-resizer', '::after'],
    ['splunk-template', '.vtl-layout', '.vtl-resizer', '::after'],
    ['kafka', '.kafka-workspace', '.kafka-resizer', '::before'],
  ]) {
    await page.setViewportSize({ width: 1440, height: 1000 });
    if (tool === 'kafka') {
      // Kafka is desktop-only; mount its real template and resizer without a broker connection.
      await page.evaluate(async () => {
        const { KafkaTool } = await import('/tools/kafka/main.js');
        const tool = new KafkaTool();
        tool.container = document.querySelector('.tool-root');
        tool.container.innerHTML = tool.render();
        tool.initializeResizer();
        window.kafkaLayoutFixture = tool;
      });
    } else {
      await page.evaluate(tool => window.app.router.navigate(tool), tool);
    }
    await page.locator(resizer).waitFor({ state: 'visible' });
    const read = () => page.evaluate(({ layout, resizer, pseudo }) => {
      const container = document.querySelector(layout);
      const handle = document.querySelector(resizer);
      const style = getComputedStyle(container);
      return { gap: style.columnGap, rowGap: style.rowGap, line: getComputedStyle(handle, pseudo).width,
        columns: style.gridTemplateColumns, value: handle.getAttribute('aria-valuenow'),
        overflow: container.scrollWidth > container.clientWidth + 1 };
    }, { layout, resizer, pseudo });
    const desktop = await read();
    assert.equal(desktop.gap, '4px', tool);
    assert.equal(desktop.rowGap, '4px', tool);
    assert.equal(desktop.line, '2px', tool);
    assert.equal(desktop.overflow, false, tool);
    await page.locator(resizer).focus();
    await page.keyboard.press('ArrowRight');
    const keyboard = await read();
    assert.notEqual(keyboard.columns, desktop.columns, `${tool}: keyboard resize`);
    await page.waitForTimeout(200);
    const box = await page.locator(resizer).boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x - 50, box.y + box.height / 2, { steps: 5 });
    await page.waitForTimeout(100);
    await page.mouse.up();
    const dragged = await read();
    assert.notEqual(dragged.columns, keyboard.columns, `${tool}: drag resize`);
    await page.screenshot({ path: new URL(`${tool}.png`, output).pathname });
    await page.setViewportSize({ width: 600, height: 900 });
    await page.waitForTimeout(150);
    assert.equal(await page.locator(resizer).isVisible(), false, `${tool}: mobile divider hidden`);
    results.push({ tool, desktop, keyboard, dragged, mobileDividerHidden: true });
    console.log(`PASS ${tool}`);
  }
  await writeFile(new URL('results.json', output), JSON.stringify({ status: 'PASS', results }, null, 2) + '\n');
} finally { await browser.close(); }
