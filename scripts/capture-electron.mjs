import { writeFileSync } from 'node:fs';
import path from 'node:path';

const port = Number.parseInt(process.argv[2] ?? '', 10);
const output = process.argv[3] ? path.resolve(process.argv[3]) : '';
const selector = process.argv[4];
const targetLevel = process.argv[5];
const secondSelector = process.argv[6];
const preferenceMode = process.argv[7];

if (!Number.isInteger(port) || port < 1024 || port > 65535 || !output) {
  throw new Error('用法：node scripts/capture-electron.mjs <port> <output.png> [click-selector] [l1|l2|l3] [second-click-selector] [high-contrast|reduced-motion]');
}

async function findTarget() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const targets = await fetch('http://127.0.0.1:' + port + '/json').then((response) => response.json());
      const target = targets.find((item) => item.type === 'page' && item.webSocketDebuggerUrl);
      if (target) return target;
    } catch {
      // Electron 仍在启动。
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('未找到 Electron CDP 页面');
}

const target = await findTarget();
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

let requestId = 0;
const pending = new Map();
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (!message.id || !pending.has(message.id)) return;
  const { resolve, reject } = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) reject(new Error(message.error.message));
  else resolve(message.result);
});

function send(method, params = {}) {
  requestId += 1;
  return new Promise((resolve, reject) => {
    pending.set(requestId, { resolve, reject });
    socket.send(JSON.stringify({ id: requestId, method, params }));
  });
}

await send('Page.enable');
if (targetLevel) {
  if (!['l1', 'l2', 'l3'].includes(targetLevel)) throw new Error('截图层级必须是 l1、l2 或 l3');
  await send('Runtime.evaluate', {
    expression: `window.api?.setLevel(${JSON.stringify(targetLevel)})`,
    awaitPromise: true,
    returnByValue: true
  });
  await new Promise((resolve) => setTimeout(resolve, 100));
  await send('Runtime.evaluate', { expression: 'window.api?.interacting?.(true)', awaitPromise: true, returnByValue: true });
  await new Promise((resolve) => setTimeout(resolve, 350));
}
if (selector) {
  await send('Runtime.evaluate', {
    expression: `document.querySelector(${JSON.stringify(selector)})?.click()`,
    returnByValue: true
  });
}
await new Promise((resolve) => setTimeout(resolve, selector ? 350 : 100));
if (secondSelector) {
  await send('Runtime.evaluate', {
    expression: `document.querySelector(${JSON.stringify(secondSelector)})?.click()`,
    returnByValue: true
  });
  await new Promise((resolve) => setTimeout(resolve, 450));
}
if (preferenceMode) {
  if (!['high-contrast', 'reduced-motion'].includes(preferenceMode)) throw new Error('辅助功能模式无效');
  await send('Runtime.evaluate', {
    expression: `(() => { const root = document.querySelector('[data-high-contrast]'); if (!root) return false; root.setAttribute('data-high-contrast', ${JSON.stringify(preferenceMode === 'high-contrast' ? 'true' : 'false')}); root.setAttribute('data-reduced-motion', ${JSON.stringify(preferenceMode === 'reduced-motion' ? 'true' : 'false')}); return true; })()`,
    returnByValue: true
  });
}
await send('Runtime.evaluate', { expression: 'window.api?.interacting?.(true)', awaitPromise: true, returnByValue: true });
await new Promise((resolve) => setTimeout(resolve, 100));
const result = await send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
const metadata = await send('Runtime.evaluate', {
  expression: `({ devicePixelRatio: window.devicePixelRatio, innerWidth: window.innerWidth, innerHeight: window.innerHeight, highContrast: document.querySelector('[data-high-contrast]')?.getAttribute('data-high-contrast'), reducedMotion: document.querySelector('[data-reduced-motion]')?.getAttribute('data-reduced-motion'), sampleTransitionDuration: getComputedStyle(document.querySelector('.panel') ?? document.body).transitionDuration })`,
  returnByValue: true
});
writeFileSync(output, Buffer.from(result.data, 'base64'));
socket.close();
process.stdout.write(output + '\n' + JSON.stringify(metadata.result.value) + '\n');
