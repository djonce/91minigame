import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
test('30-second original-ROM run produces audio and keeps emulation near 60 Hz', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/player.html?game=nes-chise-yaosai');
  await expect(page.locator('#launch')).toBeEnabled({ timeout: 70000 }); await page.locator('#launch').click();
  await page.waitForTimeout(1800); await page.keyboard.press('Enter', { delay: 180 });
  const measurements = await page.evaluate(async () => {
    const e = (window as any).EJS_emulator; const context = e.Module.AL.currentCtx;
    const analyser = context.audioCtx.createAnalyser(); analyser.fftSize = 1024;
    const gains = Object.values(context.sources).map((source: any) => source.gain as GainNode);
    for (const gain of gains) gain.connect(analyser);
    const data = new Float32Array(analyser.fftSize);
    const start = performance.now(); const frame = e.gameManager.functions.getFrameNum();
    let peak = 0;
    for (let i = 0; i < 60; i++) {
      await new Promise(resolve => setTimeout(resolve, 500));
      analyser.getFloatTimeDomainData(data); for (const value of data) peak = Math.max(peak, Math.abs(value));
    }
    for (const gain of gains) gain.disconnect(analyser);
    const durationMs = performance.now() - start; const frames = e.gameManager.functions.getFrameNum() - frame;
    return { durationMs, frames, fps: frames / durationMs * 1000, audioPeak: peak, audioState: context.audioCtx.state, coreName: e.coreName, browser: navigator.userAgent };
  });
  console.log('Local run:', JSON.stringify(measurements));
  await writeFile(info.outputPath('measurements.json'), JSON.stringify(measurements, null, 2));
  expect(measurements.fps).toBeGreaterThan(52); expect(measurements.fps).toBeLessThan(65);
  expect(measurements.audioPeak).toBeGreaterThan(0.001); expect(measurements.audioState).toBe('running');
  await page.keyboard.down('ArrowRight'); await page.keyboard.down('KeyX'); await page.waitForTimeout(800); await page.keyboard.up('KeyX'); await page.keyboard.up('ArrowRight');
  await page.locator('#pause').click(); await page.screenshot({ path: info.outputPath('gameplay.png'), fullPage: true });
  expect(errors).toEqual([]);
});
