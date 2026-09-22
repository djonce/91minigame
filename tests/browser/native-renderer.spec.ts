import { test, expect } from '@playwright/test';
import { buildSync } from 'esbuild';

test('native WebGL pixels match Canvas 2D after drawing and recreating the surface', async ({ page }) => {
  const source = buildSync({ entryPoints: ['miniprogram/native/renderer.ts'], bundle: true, format: 'iife', globalName: 'NativeRenderer', write: false }).outputFiles[0].text;
  await page.setContent('<canvas id="gpu"></canvas><canvas id="fallback"></canvas>');
  await page.addScriptTag({ content: source });
  const result = await page.evaluate(() => {
    const { createRenderer } = (window as any).NativeRenderer;
    const gpu = document.querySelector<HTMLCanvasElement>('#gpu')!;
    const fallback = document.querySelector<HTMLCanvasElement>('#fallback')!;
    const frame = new Uint32Array(256 * 240);
    for (let y = 0; y < 240; y++) for (let x = 0; x < 256; x++) frame[y * 256 + x] = (x << 16) | (y << 8) | (x ^ y);
    const cpu = createRenderer(fallback, '2d'); cpu.draw(frame);
    const expected = fallback.getContext('2d')!.getImageData(0, 0, 256, 240).data;
    let mismatch = 0;
    for (let pass = 0; pass < 2; pass++) {
      const renderer = createRenderer(gpu, 'webgl');
      renderer.draw(frame); renderer.draw(frame);
      const gl = gpu.getContext('webgl')!, output = new Uint8Array(256 * 240 * 4);
      gl.readPixels(0, 0, 256, 240, gl.RGBA, gl.UNSIGNED_BYTE, output);
      for (let y = 0; y < 240; y++) for (let x = 0; x < 256; x++) for (let c = 0; c < 4; c++) {
        if (output[((239 - y) * 256 + x) * 4 + c] !== expected[(y * 256 + x) * 4 + c]) mismatch++;
      }
      renderer.close();
    }
    cpu.close();
    return { mismatch, sourceAlpha: frame[100] >>> 24 };
  });
  expect(result).toEqual({ mismatch: 0, sourceAlpha: 0 });
});
