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

test('fixed joystick follows eight directions, clamps travel and centers after release or menu', async ({ page }) => {
  await start(page);
  await expect(page.locator('body')).toHaveAttribute('data-direction', 'joystick');
  const pad = page.locator('.dpad');
  const box = (await pad.boundingBox())!;
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  const offset = () => pad.evaluate(node => ({ x: parseFloat((node as HTMLElement).style.getPropertyValue('--stick-x') || '0'), y: parseFloat((node as HTMLElement).style.getPropertyValue('--stick-y') || '0') }));
  await page.mouse.move(cx, cy); await page.mouse.down();
  await expect(page.locator('.pressed')).toHaveCount(0);
  const sectors = [['right'], ['right', 'down'], ['down'], ['down', 'left'], ['left'], ['left', 'up'], ['up'], ['up', 'right']];
  for (let i = 0; i < sectors.length; i++) {
    const angle = i * Math.PI / 4;
    await page.mouse.move(cx + Math.cos(angle) * box.width * .4, cy + Math.sin(angle) * box.height * .4);
    expect(await pad.locator('.pressed').evaluateAll(nodes => nodes.map(node => (node as HTMLElement).dataset.input).sort())).toEqual([...sectors[i]].sort());
    const position = await offset();
    expect(Math.hypot(position.x, position.y)).toBeCloseTo(box.width * .27, 1);
  }
  await page.mouse.move(cx + box.width, cy); // Captured finger outside the base.
  await expect(page.locator('[data-input=right]')).toHaveClass(/pressed/);
  await page.mouse.up();
  await expect(page.locator('.pressed')).toHaveCount(0);
  expect(await offset()).toEqual({ x: 0, y: 0 });
  await page.mouse.move(cx + box.width * .35, cy); await page.mouse.down();
  await page.mouse.move(cx + 2, cy + 2); await expect(page.locator('.pressed')).toHaveCount(0);
  await page.mouse.move(cx, cy - box.height * .35);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.locator('.pressed')).toHaveCount(0);
  expect(await offset()).toEqual({ x: 0, y: 0 });
  await page.mouse.up();
  await page.locator('#control-direction').selectOption('dpad');
  await page.locator('#resume').tap();
  await expect(page.locator('.joystick-thumb')).toBeHidden();
  await page.locator('[data-input=right]').tap();
  await expect(page.locator('.pressed')).toHaveCount(0);
  await page.reload(); await expect(page.locator('#launch')).toBeEnabled({ timeout: 70000 });
  await expect(page.locator('body')).toHaveAttribute('data-direction', 'dpad');
  await page.goto('/netplay.html?game=nes-chise-yaosai');
  await expect(page.locator('#control-direction')).toHaveValue('dpad');
  await page.locator('#control-direction').selectOption('joystick');
  await expect(page.locator('body')).toHaveAttribute('data-direction', 'joystick');
});

test('landscape A and B have a wide diagonal gap for both hand layouts and sizes', async ({ page }, info) => {
  await start(page);
  for (const size of [{ width: 568, height: 320 }, { width: 667, height: 300 }, { width: 844, height: 390 }, { width: 932, height: 360 }]) {
    await page.setViewportSize(size);
    await expect.poll(() => page.evaluate(() => Math.round(document.body.getBoundingClientRect().width))).toBe(size.width);
    for (const hand of ['right', 'left']) for (const buttonSize of ['standard', 'large']) {
      await page.locator('#pause').tap();
      await page.locator('#control-hand').selectOption(hand);
      await page.locator('#control-size').selectOption(buttonSize);
      await page.locator('#resume').tap();
      const a = (await page.locator('[data-input=a]').boundingBox())!;
      const b = (await page.locator('[data-input=b]').boundingBox())!;
      const screen = (await page.locator('.screen-stage').boundingBox())!;
      const centerGap = Math.hypot(a.x - b.x, a.y - b.y);
      expect(centerGap - a.width).toBeCloseTo(28, 0);
      expect(a.y + 40).toBeLessThan(b.y);
      expect(b.x + b.width).toBeLessThan(a.x); // Non-overlapping rectangular hit targets too.
      for (const box of [a, b]) {
        expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(size.width);
        expect(box.y).toBeGreaterThanOrEqual(0); expect(box.y + box.height).toBeLessThanOrEqual(size.height);
        if (hand === 'right') expect(box.x).toBeGreaterThanOrEqual(screen.x + screen.width);
        else expect(box.x + box.width).toBeLessThanOrEqual(screen.x);
      }
      expect(await page.evaluate(() => ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight }))).toEqual(size);
    }
  }
  await page.locator('#pause').tap();
  await page.locator('#control-hand').selectOption('right'); await page.locator('#control-size').selectOption('standard');
  await page.locator('#resume').tap();
  await page.screenshot({ path: info.outputPath('joystick-landscape.png') });
  await page.setViewportSize({ width: 390, height: 740 });
  await expect(page.locator('body')).toHaveAttribute('data-layout', 'portrait');
  await expect.poll(() => page.evaluate(() => ({ scale: visualViewport?.scale, inner: innerWidth, root: document.documentElement.clientWidth, body: Math.round(document.body.getBoundingClientRect().width) }))).toEqual({ scale: 1, inner: 390, root: 390, body: 390 });
  await page.screenshot({ path: info.outputPath('joystick-portrait.png') });
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
