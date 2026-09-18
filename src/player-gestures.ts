// Game fingers belong to the controller, not the browser's zoom/selection UI.
// Keep these guards off the scrollable menu and its editable form controls.
export function bindPlayerGestures() {
  const workspace = document.querySelector<HTMLElement>('#player-workspace');
  if (!workspace) return;
  const prevent = (event: Event) => { if (event.cancelable) event.preventDefault(); };
  const controller = workspace.querySelector('.controller');
  // Pointer Events still drive the game. Cancel the separate native touch
  // defaults too: pointerdown.preventDefault alone does not own iOS gestures.
  for (const type of ['touchstart', 'touchmove', 'touchend']) {
    controller?.addEventListener(type, prevent, { passive: false });
  }
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
    workspace.addEventListener(type, prevent, { passive: false });
  }
  workspace.addEventListener('touchmove', event => {
    if (event.touches.length > 1) prevent(event);
  }, { passive: false });
  const protectControl = (event: Event) => {
    const target = event.target instanceof Element ? event.target : event.target instanceof Node ? event.target.parentElement : null;
    if (target?.closest('#player-workspace, .player-body button')) prevent(event);
  };
  for (const type of ['selectstart', 'contextmenu', 'dragstart', 'dblclick']) {
    document.addEventListener(type, protectControl, { capture: true });
  }
}
