const port = Number.parseInt(process.argv[2] ?? '', 10);
const shouldAssert = process.argv.includes('--assert');

if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error('用法：npm run benchmark:transitions -- <CDP 端口> [--assert]');
}

async function findTarget() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const targets = await fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json());
      const page = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl);
      if (page) return page;
    } catch {
      // 隔离 Electron 仍在启动。
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
  const request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id);
  if (message.error) request.reject(new Error(message.error.message));
  else request.resolve(message.result);
});

function send(method, params = {}) {
  requestId += 1;
  return new Promise((resolve, reject) => {
    pending.set(requestId, { resolve, reject });
    socket.send(JSON.stringify({ id: requestId, method, params }));
  });
}

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}

function summarize(samples) {
  if (samples.length === 0) {
    return { frames: 0, p50Ms: 0, p95Ms: 0, maxMs: 0, over20Ms: 0, over50Ms: 0, over20Ratio: 0 };
  }
  const ordered = [...samples].sort((left, right) => left - right);
  const percentile = (value) => ordered[Math.min(ordered.length - 1, Math.floor((ordered.length - 1) * value))];
  const over20Ms = samples.filter((value) => value > 20).length;
  return {
    frames: samples.length,
    p50Ms: Number(percentile(0.5).toFixed(2)),
    p95Ms: Number(percentile(0.95).toFixed(2)),
    maxMs: Number(Math.max(...samples).toFixed(2)),
    over20Ms,
    over50Ms: samples.filter((value) => value > 50).length,
    over20Ratio: Number((over20Ms / samples.length).toFixed(4))
  };
}

await send('Performance.enable');

async function settle(level) {
  await evaluate(`new Promise(async (resolve) => {
    const keepAlive = setInterval(() => void window.api.interacting(true), 40);
    await window.api.setLevel(${JSON.stringify(level)});
    setTimeout(() => { clearInterval(keepAlive); resolve(); }, 650);
  })`);
}

async function measure(from, to) {
  await settle(from);
  const result = await evaluate(`new Promise(async (resolve, reject) => {
    const frameTimes = [];
    const longTasks = [];
    const resizeTimes = [];
    let firstFrameMs = null;
    let transitionId = null;
    let sawTransition = false;
    let animatingAt = null;
    let visualEndedAt = null;
    let settledAt = null;
    let finished = false;
    const requestedAt = performance.now();
    const keepAlive = setInterval(() => void window.api.interacting(true), 40);
    const timeout = setTimeout(() => finish(new Error('transition timeout')), 1000);
    const onResize = () => resizeTimes.push(performance.now());
    addEventListener('resize', onResize);
    const longTaskObserver = typeof PerformanceObserver === 'undefined' ? null : new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) longTasks.push(entry.duration);
    });
    try { longTaskObserver?.observe({ entryTypes: ['longtask'] }); } catch { /* 当前 Chromium 不支持时保持空数组。 */ }

    const frame = (now) => {
      if (firstFrameMs === null) firstFrameMs = now - requestedAt;
      frameTimes.push(now);
      if (!finished) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);

    const offTransition = window.api.onTransition((transition) => {
      if (transitionId && transition?.id === transitionId) {
        sawTransition = true;
        if (transition.phase === 'animating' && animatingAt === null) animatingAt = performance.now();
        if (transition.phase === 'settling' && visualEndedAt === null) visualEndedAt = performance.now();
      }
      if (transitionId && sawTransition && transition === null) {
        settledAt = performance.now();
        const waitForCommit = (attempt = 0) => requestAnimationFrame(() => {
          const app = document.querySelector('.app');
          const committed = app?.classList.contains(${JSON.stringify('level-' + to)})
            && app?.getAttribute('data-transitioning') === 'false';
          if (committed || attempt >= 8) requestAnimationFrame(() => finish());
          else waitForCommit(attempt + 1);
        });
        waitForCommit();
      }
    });

    function finish(error) {
      if (finished) return;
      finished = true;
      clearInterval(keepAlive);
      clearTimeout(timeout);
      removeEventListener('resize', onResize);
      longTaskObserver?.disconnect();
      offTransition();
      if (error) reject(error);
      else resolve({
        elapsedMs: (settledAt ?? performance.now()) - requestedAt,
        visualDurationMs: animatingAt === null ? 0 : (visualEndedAt ?? settledAt ?? performance.now()) - animatingAt,
        firstFrameMs: Math.max(0, firstFrameMs ?? 0),
        samples: frameTimes.slice(1).map((time, index) => time - frameTimes[index]),
        visualSamples: frameTimes.slice(1).flatMap((time, index) => {
          const previous = frameTimes[index];
          if (animatingAt === null || visualEndedAt === null || time < animatingAt || previous > visualEndedAt) return [];
          return [time - previous];
        }),
        longTasks,
        resizeEvents: resizeTimes.length,
        domNodes: document.querySelectorAll('*').length,
        taskCards: document.querySelectorAll('[data-carousel-card="true"]').length
      });
    }

    const request = await window.api.setLevel(${JSON.stringify(to)});
    transitionId = request.transitionId ?? null;
    if (!request.accepted || !transitionId) {
      finish(new Error('transition request rejected'));
      return;
    }
    const state = await window.api.getState();
    if (state.transition?.id === transitionId) sawTransition = true;
    if (state.transition === null && state.level === ${JSON.stringify(to)}) {
      sawTransition = true;
      finish();
    }
  })`);
  return {
    transition: `${from}->${to}`,
    elapsedMs: Number(result.elapsedMs.toFixed(2)),
    visualDurationMs: Number(result.visualDurationMs.toFixed(2)),
    firstFrameMs: Number(result.firstFrameMs.toFixed(2)),
    resizeEvents: result.resizeEvents,
    domNodes: result.domNodes,
    taskCards: result.taskCards,
    frames: summarize(result.visualSamples),
    fullSwitchFrames: summarize(result.samples),
    longTasks: summarize(result.longTasks)
  };
}

try {
  const preferences = await evaluate('window.api.getUiPreferences()');
  const transitions = [
    await measure('l2', 'l3'),
    await measure('l3', 'l2'),
    await measure('l2', 'l1'),
    await measure('l1', 'l2')
  ];
  const report = { preferences, transitions };
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');

  if (shouldAssert) {
    const failures = [];
    for (const item of transitions) {
      if (item.resizeEvents > 1) failures.push(`${item.transition}: resize ${item.resizeEvents} 次`);
      if (item.firstFrameMs > 50) failures.push(`${item.transition}: 首帧 ${item.firstFrameMs}ms`);
      if (item.transition.endsWith('->l2') && item.domNodes > 700) failures.push(`${item.transition}: DOM ${item.domNodes}`);
      if (item.transition.endsWith('->l2') && item.taskCards > 7) failures.push(`${item.transition}: TaskCard ${item.taskCards}`);
      if (preferences.renderMode === 'composited') {
        if (item.visualDurationMs < 160 || item.visualDurationMs > 240) failures.push(`${item.transition}: 视觉过渡 ${item.visualDurationMs}ms`);
        if (item.frames.over50Ms > 0) failures.push(`${item.transition}: ${item.frames.over50Ms} 个 >50ms 帧间隔`);
        if (item.frames.over20Ratio >= 0.05) failures.push(`${item.transition}: >20ms 帧间隔占比 ${item.frames.over20Ratio}`);
        if (item.longTasks.over50Ms > 0) failures.push(`${item.transition}: ${item.longTasks.over50Ms} 个 >50ms 主线程长任务`);
      }
    }
    if (failures.length > 0) throw new Error('性能门禁失败：\n- ' + failures.join('\n- '));
  }
} finally {
  socket.close();
}
