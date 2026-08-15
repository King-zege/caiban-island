import { app, BrowserWindow, Notification } from 'electron';
import path from 'node:path';
import { IslandWindowController } from './windowController';
import { registerIpc } from './ipc';
import { createTray } from './tray';
import { openDatabase } from './db';
import { AppService } from './appService';
import { SettingsService } from './settingsService';
import { startMcpServer } from './mcpServer';
import { FeishuService } from './feishuService';
import { FullscreenDetector } from './fullscreenDetector';

// 数据目录固定为 %APPDATA%\caiban-island（SPEC 第 5 节）
app.setPath('userData', path.join(app.getPath('appData'), 'caiban-island'));
// FR-061：Toast 通知需要 AppUserModelID（无证书也可用）
app.setAppUserModelId('caiban-island');

let controller: IslandWindowController | null = null;
let reminderTimer: NodeJS.Timeout | null = null;
let feishuTimer: NodeJS.Timeout | null = null;
let mcpRuntime: { url: string; port: number; close: () => void } | null = null;
let fullscreenDetector: FullscreenDetector | null = null;

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
        height: 6,
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

      const settings = new SettingsService(db);
      app.setLoginItemSettings({ openAtLogin: settings.get('autostart') === '1' });

      // P5：启动本机 MCP SSE 服务（Qoder 主通道）
      mcpRuntime = await startMcpServer(appSvc, appSvc.settings);

      if (process.env['ELECTRON_RENDERER_URL']) {
        await win.loadURL(process.env['ELECTRON_RENDERER_URL']);
      } else {
        await win.loadFile(path.join(__dirname, '../renderer/index.html'));
      }

      controller = new IslandWindowController(win);
      await controller.init();
      registerIpc(controller, appSvc, feishu);
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
    });
  }
}
