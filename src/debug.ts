/** With ?debug=1 the page shows its own errors and warnings in an overlay — handy on phones and in screenshots. */
export function installDebugOverlay(): void {
  if (!new URLSearchParams(location.search).has('debug')) return;
  const box = document.createElement('pre');
  box.style.cssText =
    'position:fixed;left:8px;bottom:8px;z-index:99;max-width:60vw;max-height:40vh;overflow:auto;margin:0;padding:8px;' +
    'background:rgba(0,0,0,.8);color:#ffb86b;font:11px/1.35 monospace;white-space:pre-wrap;border-radius:8px';
  const show = (kind: string, parts: unknown[]) => {
    if (!box.isConnected) document.body.appendChild(box);
    const text = parts
      .map((part) => (part instanceof Error ? `${part.message}\n${part.stack ?? ''}` : String(part)))
      .join(' ');
    box.textContent += `[${kind}] ${text.slice(0, 600)}\n`;
  };
  for (const kind of ['error', 'warn'] as const) {
    const original = console[kind].bind(console);
    console[kind] = (...parts: unknown[]) => {
      show(kind, parts);
      original(...parts);
    };
  }
  window.addEventListener('error', (event) => show('uncaught', [event.error ?? event.message]));
  window.addEventListener('unhandledrejection', (event) => show('rejection', [event.reason]));
}
