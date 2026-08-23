import { app, BrowserWindow, nativeTheme, Notification, safeStorage } from 'electron';
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

    function showToast(title: string, body: string, onClick?: () => void): void {
      if (!Notification.isSupported()) return;
      const n = new Notification({ title, body, silent: false });
      if (onClick) n.on('click', onClick);
      n.show();
    }

    function startReminderScheduler(appSvc: AppService): void {
      setTimeout(() => {
        const missed = appSvc.reminders.missedSince();
        if (missed > 0) {
          showToast('采办岛', '有 ' + missed + ' 条提醒在关机/睡眠期间错过，请查看任务列表');
        }
      }, 5000);

      reminderTimer = setInterval(() => {
        if (!controller || controller.paused) return;
        const due = appSvc.reminders.dueNow();
        for (const d of due) {
          const task = appSvc.tasks.getTask(d.taskId);
          const deadlineText = task?.deadlineUtc ? task.deadlineUtc.slice(0, 16).replace('T', ' ') : '';
          showToast('采办岛：' + d.taskName, '截止 ' + deadlineText, () => {
            if (controller) controller.setLevel('l2');
          });
        }
        if (due.length > 0 && !Notification.isSupported()) {
          controller.setLevel('l2');
        }
      }, 20000);
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
      startReminderScheduler(appSvc);
    }

    app.whenReady().then(createWindow);

    app.on('window-all-closed', () => {});
    app.on('before-quit', () => {
      if (controller) controller.dispose();
      if (fullscreenDetector) fullscreenDetector.stop();
      if (reminderTimer) clearInterval(reminderTimer);
      if (feishuTimer) clearTimeout(feishuTimer);
      if (mcpRuntime) mcpRuntime.close();
      if (agentService) void agentService.dispose();
    });
  }
}
