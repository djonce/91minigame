import { test, expect, type Page } from '@playwright/test';

test.use({ viewport: { width: 390, height: 740 }, hasTouch: true, isMobile: true });
async function start(page: Page) {
  await page.goto('/player.html?game=nes-chise-yaosai&source=wechat');
  await expect(page.locator('#launch')).toBeEnabled({ timeout: 70000 });
  await page.locator('#launch').tap();
  await expect(page.locator('#play-status')).toHaveText('正在游玩');
  await page.evaluate(() => {
    const manager = (window as any).EJS_emulator.gameManager;
    (window as any).touchEdges = [];
    const send = manager.simulateInput.bind(manager);
    manager.simulateInput = (port: number, key: number, down: number) => { (window as any).touchEdges.push([key, down]); send(port, key, down); };
  });
}

test('rapid game taps keep the viewport stable, release buttons, and retain normal menu clicks', async ({ page }) => {
  await start(page);
  for (let i = 0; i < 12; i++) await page.locator('[data-input="a"]').tap();
  const edges = await page.evaluate(() => (window as any).touchEdges);
  expect(edges.filter(([key, down]: number[]) => key === 8 && down === 1)).toHaveLength(12);
  expect(edges.filter(([key, down]: number[]) => key === 8 && down === 0)).toHaveLength(12);
  await expect(page.locator('.pressed')).toHaveCount(0);
  expect(await page.evaluate(() => ({ scale: visualViewport?.scale, selection: getSelection()?.toString(), width: document.documentElement.scrollWidth })))
    .toEqual({ scale: 1, selection: '', width: 390 });
  await page.locator('#pause').tap(); await expect(page.getByRole('dialog')).toBeVisible();
  await page.locator('#control-size').selectOption('large');
  await page.locator('#volume').tap({ position: { x: 32, y: 22 } });
  await expect(page.locator('#volume')).not.toHaveValue('65');
  await expect(page.locator('#volume-value')).toHaveText(`${await page.locator('#volume').inputValue()}%`);
  await page.locator('#resume').tap(); await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.locator('#play-status')).toHaveText('正在游玩');
});

test('WebKit gesture and selection defaults are blocked only on game surfaces', async ({ page }) => {
  await start(page);
  const protectedEvents = await page.evaluate(() => {
    const button = document.querySelector('#pause')!;
    const style = getComputedStyle(button);
    const results = ['selectstart', 'contextmenu', 'gesturestart', 'gesturechange'].map(type => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      button.dispatchEvent(event); return event.defaultPrevented;
    });
    return { results, selection: style.getPropertyValue('-webkit-user-select') || style.userSelect };
  });
  expect(protectedEvents).toEqual({ results: [true, true, true, true], selection: 'none' });
  await page.locator('#pause').tap();
  const defaults = await page.locator('.menu-scroll').evaluate(node => {
    const event = new Event('touchmove', { bubbles: true, cancelable: true });
    node.dispatchEvent(event); return event.defaultPrevented;
  });
  expect(defaults).toBe(false);
  await page.goto('/netplay.html?game=nes-chise-yaosai');
  await page.locator('#room-code').fill('ABCDEF1234');
  expect(await page.locator('#room-code').evaluate(node => {
    const event = new Event('selectstart', { bubbles: true, cancelable: true });
    node.dispatchEvent(event); return event.defaultPrevented;
  })).toBe(false);
  await expect(page.locator('#room-code')).toHaveValue('ABCDEF1234');
});

test('pinching across controls cannot zoom or interrupt simultaneous input', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Real multi-touch injection uses Chromium CDP; WebKit fallback is checked separately.');
  await start(page);
  const client = await page.context().newCDPSession(page);
  const right = (await page.locator('[data-input="right"]').boundingBox())!;
  const a = (await page.locator('[data-input="a"]').boundingBox())!;
  const center = (box: typeof a, id: number) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2, id });
  const points = [center(right, 1), center(a, 2)];
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points });
  await expect(page.locator('[data-input="right"]')).toHaveClass(/pressed/);
  await expect(page.locator('[data-input="a"]')).toHaveClass(/pressed/);
  for (let offset = 4; offset <= 24; offset += 4) {
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...points[0], x: points[0].x - offset }, { ...points[1], x: points[1].x + offset }] });
  }
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  expect(await page.evaluate(() => visualViewport?.scale)).toBe(1);
  await expect(page.locator('.pressed')).toHaveCount(0);
  // A long touch on the menu must not select its text or open a native callout.
  const menu = (await page.locator('#pause').boundingBox())!;
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [center(menu, 3)] });
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => getSelection()?.toString())).toBe('');
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
});
