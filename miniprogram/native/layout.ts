const clamp = (n: number, low: number, high: number) => Math.min(high, Math.max(low, n));
const position = (left: number, top: number, width: number, height: number) =>
  `left:${Math.round(left)}px;top:${Math.round(top)}px;width:${Math.round(width)}px;height:${Math.round(height)}px;`;
export function playerLayout(width: number, height: number) {
  const wide = width > height;
  let screenWidth: number, screenHeight: number, stickSize: number;
  let screen: string, stick: string, actions: string, transport: string, actionSize: number;
  if (wide) {
    const left = clamp(width * 0.21, 128, 180), right = clamp(width * 0.26, 170, 210);
    screenWidth = Math.max(32, Math.min(width - left - right - 24, height * 256 / 240));
    screenHeight = screenWidth * 240 / 256;
    screen = position(left + 12 + (width - left - right - 24 - screenWidth) / 2, (height - screenHeight) / 2, screenWidth, screenHeight);
    stickSize = Math.min(left - 8, height - 60, 168);
    stick = position((left - stickSize) / 2, Math.max(0, (height - 48 - stickSize) / 2), stickSize, stickSize);
    actionSize = Math.floor((right - 32) / 2);
    actions = position(width - right, (height - actionSize * 1.65) / 2, right, actionSize * 1.65);
    transport = position(0, height - 40, left, 40);
  } else {
    const controlsHeight = clamp(height * 0.32, 122, 184);
    screenWidth = Math.min(width, Math.max(32, height - controlsHeight - 58) * 256 / 240);
    screenHeight = screenWidth * 240 / 256;
    screen = position((width - screenWidth) / 2, 0, screenWidth, screenHeight);
    stickSize = Math.min(width * 0.43, controlsHeight - 8, 168);
    const controlsTop = screenHeight + 12;
    stick = position(0, controlsTop + (controlsHeight - stickSize) / 2, stickSize, stickSize);
    const right = width * 0.49;
    actionSize = Math.min(74, Math.floor((right - 24) / 2));
    actions = position(width - right, controlsTop + (controlsHeight - actionSize * 1.65) / 2, right, actionSize * 1.65);
    transport = position((width - 176) / 2, height - 40, 176, 40);
  }
  return { wide, screen, stick, actions, transport, actionSize, stickSize,
    screenWidth: Math.round(screenWidth), screenHeight: Math.round(screenHeight) };
}
