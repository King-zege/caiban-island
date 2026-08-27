import { app, BrowserWindow, nativeTheme, Notification, powerMonitor, safeStorage } from 'electron';
import path from 'node:path';
import { IslandWindowController } from './windowController';
import { registerIpc } from './ipc';
import { createTray } from './tray';
import { openDatabase } from './db';
import { AppService } from './appService';
import { startMcpServer } from './mcpServer';
import { FeishuService } from './feishuService';
import { FullscreenDetector } from './fullscreenDetector';
import { McpTokenVault } from './mcpTokenVault';
import { AgentSessionService } from './agentSessionService';
import { DeepSeekConfigService } from './deepSeekConfigService';
import { AgentService } from './agentService';
import { MemoryContextProvider, MemoryService } from './memoryService';
import { resolveUserDataPath } from './userData';
import { classifyRenderMode } from '../shared/renderMode';
import type { RenderMode } from '../shared/types';
import type { ReminderEvent } from '../shared/types';
import type { DueReminder } from './reminderService';

// 数据目录固定为 %APPDATA%\caiban-island（SPEC 第 5 节）
const testUserDataDir = process.env['CAIBAN_TEST_USER_DATA_DIR'];
const resolvedUserDataPath = resolveUserDataPath(app.getPath('appData'), testUserDataDir, app.isPackaged);
const isolatedTestMode = !app.isPackaged && Boolean(testUserDataDir);
app.setPath('userData', resolvedUserDataPath);
if (isolatedTestMode && process.env['CAIBAN_TEST_DISABLE_HARDWARE_ACCELERATION'] === '1') {
  app.disableHardwareAcceleration();
}
const testDebugPort = process.env['CAIBAN_TEST_REMOTE_DEBUGGING_PORT'];
if (!app.isPackaged && testUserDataDir && testDebugPort && /^\d{4,5}$/.test(testDebugPort)) {
  const port = Number.parseInt(testDebugPort, 10);
  if (port >= 1024 && port <= 65535) app.commandLine.appendSwitch('remote-debugging-port', String(port));
}
if (!app.isPackaged && testUserDataDir && process.env['CAIBAN_TEST_COLOR_SCHEME'] === 'dark') {
  nativeTheme.themeSource = 'dark';
}
// FR-061：Toast 通知需要 AppUserModelID（无证书也可用）
app.setAppUserModelId('caiban-island');

let controller: IslandWindowController | null = null;
let reminderTimer: NodeJS.Timeout | null = null;
let reminderResumeHandler: (() => void) | null = null;
let feishuTimer: NodeJS.Timeout | null = null;
let mcpRuntime: { url: string; port: number; close: () => void } | null = null;
let fullscreenDetector: FullscreenDetector | null = null;
let agentService: AgentService | null = null;
let detectedRenderMode: RenderMode = 'software';
let gpuCrashed = false;

function refreshRenderMode(): void {
  detectedRenderMode = classifyRenderMode({
    gpuCompositing: app.getGPUFeatureStatus().gpu_compositing,
    gpuCrashed
  });
  controller?.setRenderMode(detectedRenderMode);
}

app.on('gpu-info-update', refreshRenderMode);
app.on('child-process-gone', (_event, details) => {
  if (details.type !== 'GPU') return;
  gpuCrashed = true;
  refreshRenderMode();
});

{
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
  } else {
    app.on('second-instance', () => {
      if (controller) controller.setLevel('l2');
    });

    function showToast(title: string, body: string, onClick?: () => void, onFailure?: () => void): void {
      if (!Notification.isSupported()) {
        onFailure?.();
        return;
      }
      const n = new Notification({ title, body, silent: false });
      if (onClick) n.on('click', onClick);
      if (onFailure) n.once('failed', onFailure);
      n.show();
    }

    function startReminderScheduler(appSvc: AppService, win: BrowserWindow): void {
      let deferredWhilePaused = false;

      const sendEvent = (event: ReminderEvent): void => {
        if (!win.isDestroyed()) win.webContents.send('reminder:event', event);
      };

      const openNode = (reminder: Extract<DueReminder, { kind: 'node' }>): void => {
        if (!controller) return;
        sendEvent({ type: 'open-node', taskId: reminder.taskId, nodeId: reminder.nodeId });
        if (controller.paused) controller.togglePause();
        controller.setLevel('l3');
        controller.win.focus();
      };

      const openMisc = (reminder: Extract<DueReminder, { kind: 'misc' }>): void => {
        if (!controller) return;
        sendEvent({ type: 'open-misc', taskId: reminder.taskId });
        if (controller.paused) controller.togglePause();
        controller.setLevel('l3');
        controller.win.focus();
      };

      const openTaskList = (): void => {
        if (!controller) return;
        if (controller.paused) controller.togglePause();
        controller.setLevel('l2');
        controller.win.focus();
      };

      const deliverDue = (due: DueReminder[]): void => {
        if (due.length === 0 || !controller) return;
        const showFallback = (message: string): void => {
          sendEvent({ type: 'fallback', message });
          controller?.setLevel('l2');
        };
        if (!Notification.isSupported()) {
          const first = due[0];
          const message = due.length === 1
            ? first.kind === 'node'
              ? '节点「' + first.nodeTitle + '」现在开始'
              : first.kind === 'misc'
                ? '杂事「' + first.taskName + '」到时间了'
                : '任务“' + first.taskName + '”的截止提醒已到'
            : '有 ' + due.length + ' 条提醒已到，请查看任务列表';
          showFallback(message);
          return;
        }
        for (const reminder of due) {
          if (reminder.kind === 'node') {
            const body = '节点「' + reminder.nodeTitle + '」现在开始';
            showToast('采办岛：' + reminder.taskName, body, () => openNode(reminder), () => showFallback(body));
          } else if (reminder.kind === 'misc') {
            const body = '杂事「' + reminder.taskName + '」到时间了';
            showToast('采办岛：杂事提醒', body, () => openMisc(reminder), () => showFallback(body));
          } else {
            const deadlineText = new Date(reminder.deadlineUtc).toLocaleString('zh-CN', { hour12: false });
            const body = '任务“' + reminder.taskName + '”的截止提醒已到';
            showToast('采办岛：' + reminder.taskName, '截止 ' + deadlineText, openTaskList, () => showFallback(body));
          }
        }
      };

      const deliverMissed = (missed: DueReminder[]): void => {
        if (missed.length === 0 || !controller) return;
        const nodeCount = missed.filter((item) => item.kind === 'node').length;
        const miscCount = missed.filter((item) => item.kind === 'misc').length;
        const parts = [
          nodeCount > 0 ? nodeCount + ' 条节点提醒' : '',
          miscCount > 0 ? miscCount + ' 条杂事提醒' : ''
        ].filter(Boolean);
        const detail = parts.length > 0 ? '，其中 ' + parts.join('、') : '';
        const message = '有 ' + missed.length + ' 条提醒在关机/睡眠期间错过' + detail + '，请查看任务列表';
        if (Notification.isSupported()) showToast('采办岛', message, openTaskList, () => {
          sendEvent({ type: 'fallback', message });
          controller?.setLevel('l2');
        });
        else {
          sendEvent({ type: 'fallback', message });
          controller.setLevel('l2');
        }
      };

      const scheduleNext = (): void => {
        if (reminderTimer) clearTimeout(reminderTimer);
        const next = appSvc.reminders.nextPendingAt();
        const pausedWithoutToast = controller?.paused === true && !Notification.isSupported();
        const delay = pausedWithoutToast
          ? 60000
          : next
            ? Math.max(1000, Math.min(60000, Date.parse(next) - Date.now()))
            : 60000;
        reminderTimer = setTimeout(tick, delay);
      };

      const tick = (): void => {
        if (!controller) {
          scheduleNext();
          return;
        }
        if (!Notification.isSupported() && controller.paused) {
          deferredWhilePaused = true;
          scheduleNext();
          return;
        }
        if (deferredWhilePaused) {
          deliverMissed(appSvc.reminders.claimMissed(new Date(), 0));
          deferredWhilePaused = false;
        }
        deliverDue(appSvc.reminders.dueNow());
        scheduleNext();
      };

      const resume = (): void => {
        if (!controller) return;
        if (!Notification.isSupported() && controller.paused) {
          deferredWhilePaused = true;
          scheduleNext();
          return;
        }
        deliverMissed(appSvc.reminders.claimMissed());
        tick();
      };

      reminderResumeHandler = resume;
      powerMonitor.on('resume', resume);
      appSvc.onChange(scheduleNext);
      reminderTimer = setTimeout(() => {
        if (!controller) return;
        if (!Notification.isSupported() && controller.paused) {
          deferredWhilePaused = true;
          scheduleNext();
          return;
        }
        deliverMissed(appSvc.reminders.claimMissed());
        tick();
      }, 5000);
    }

    async function createWindow(): Promise<void> {
      const win = new BrowserWindow({
        width: 96,
        height: 35,
        x: 0,
        y: 0,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        hasShadow: false,
        resizable: false,
        movable: false,
        show: false,
        fullscreenable: false,
        webPreferences: {
          preload: path.join(__dirname, '../preload/index.js'),
          contextIsolation: true,
          sandbox: false,
          backgroundThrottling: false
        }
      });
      win.setAlwaysOnTop(true, 'screen-saver');

      const db = openDatabase(path.join(app.getPath('userData'), 'island.db'));
      const appSvc = new AppService(db, app.getPath('userData'));
      const mcpTokenVault = new McpTokenVault(appSvc.settings, safeStorage);
      const agentSessions = new AgentSessionService(db, app.getPath('userData'));
      const deepSeek = new DeepSeekConfigService(appSvc.settings, safeStorage);
      const memories = new MemoryService(db);

      // P6：飞书同步（手动按钮 + 变更后自动同步，防抖 3s）
      const feishu = new FeishuService(appSvc.tasks, appSvc.settings);
      const scheduleFeishu = () => {
        if (!feishu.autoSyncEnabled()) return;
        if (feishuTimer) clearTimeout(feishuTimer);
        feishuTimer = setTimeout(() => {
          feishuTimer = null;
          void feishu.sync().catch(() => { /* 自动同步失败不打断使用，状态在设置页可见 */ });
        }, 3000);
      };
      appSvc.onChange(scheduleFeishu);

      const settings = appSvc.settings;
      app.setLoginItemSettings({ openAtLogin: settings.get('autostart') === '1' });

      // P5：启动本机 MCP SSE 服务（Qoder 主通道）
      mcpRuntime = await startMcpServer(appSvc, appSvc.settings, mcpTokenVault);

      controller = new IslandWindowController(win, () => appSvc.settings.get('acrylic_disabled') === '1');
      controller.setRenderMode(detectedRenderMode);
      agentService = new AgentService(
        appSvc, agentSessions, deepSeek, (event) => win.webContents.send('agent:event', event),
        undefined, memories, [new MemoryContextProvider(memories)]
      );
      registerIpc(controller, appSvc, feishu, mcpTokenVault, agentService, deepSeek, memories);

      if (process.env['ELECTRON_RENDERER_URL']) {
        await win.loadURL(process.env['ELECTRON_RENDERER_URL']);
      } else {
        await win.loadFile(path.join(__dirname, '../renderer/index.html'));
      }

      await controller.init();
      const testInitialLevel = process.env['CAIBAN_TEST_INITIAL_LEVEL'];
      if (
        !app.isPackaged &&
        testUserDataDir &&
        (testInitialLevel === 'l2' || testInitialLevel === 'l3')
      ) {
        controller.setLevel(testInitialLevel);
        if (process.env['CAIBAN_TEST_HOLD_LEVEL'] === '1') controller.setInteracting(true);
      }
      createTray(controller);
      // P7：真正全屏前台应用出现时自动暂停岛（FR-018）
      fullscreenDetector = new FullscreenDetector(controller);
      fullscreenDetector.start();
      startReminderScheduler(appSvc, win);
    }

    app.whenReady().then(createWindow);

    app.on('window-all-closed', () => {});
    app.on('before-quit', () => {
      if (controller) controller.dispose();
      if (fullscreenDetector) fullscreenDetector.stop();
      if (reminderTimer) clearTimeout(reminderTimer);
      if (reminderResumeHandler) powerMonitor.removeListener('resume', reminderResumeHandler);
      if (feishuTimer) clearTimeout(feishuTimer);
      if (mcpRuntime) mcpRuntime.close();
      if (agentService) void agentService.dispose();
    });
  }
}
