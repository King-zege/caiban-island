import { app, BrowserWindow, Notification } from 'electron';
import path from 'node:path';
import { IslandWindowController } from './windowController';
import { registerIpc } from './ipc';
import { createTray } from './tray';
import { openDatabase } from './db';
import { AppService } from './appService';
import { SettingsService } from './settingsService';

// 数据目录固定为 %APPDATA%\caiban-island（SPEC 第 5 节）
app.setPath('userData', path.join(app.getPath('appData'), 'caiban-island'));
// FR-061：Toast 通知需要 AppUserModelID（无证书也可用）
app.setAppUserModelId('caiban-island');

let controller: IslandWindowController | null = null;
let reminderTimer: NodeJS.Timeout | null = null;

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
    // 启动时：FR-064 漏发合并摘要
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
      // 轻弹兜底：系统通知不可用（如被禁用）时展开岛内提示
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

    // 开机自启（设置持久化）
    const settings = new SettingsService(db);
    app.setLoginItemSettings({ openAtLogin: settings.get('autostart') === '1' });

    if (process.env['ELECTRON_RENDERER_URL']) {
      await win.loadURL(process.env['ELECTRON_RENDERER_URL']);
    } else {
      await win.loadFile(path.join(__dirname, '../renderer/index.html'));
    }

    controller = new IslandWindowController(win);
    await controller.init();
    registerIpc(controller, appSvc);
    createTray(controller);
    startReminderScheduler(appSvc);
  }

  app.whenReady().then(createWindow);

  // 无主窗口：关闭即隐藏，进程常驻托盘
  app.on('window-all-closed', () => {});
  app.on('before-quit', () => {
    if (controller) controller.dispose();
    if (reminderTimer) clearInterval(reminderTimer);
  });
}
