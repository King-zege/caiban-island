import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { IslandWindowController } from './windowController';
import { registerIpc } from './ipc';
import { createTray } from './tray';

let controller: IslandWindowController | null = null;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (controller) controller.setLevel('l2');
  });

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

    if (process.env['ELECTRON_RENDERER_URL']) {
      await win.loadURL(process.env['ELECTRON_RENDERER_URL']);
    } else {
      await win.loadFile(path.join(__dirname, '../renderer/index.html'));
    }

    controller = new IslandWindowController(win);
    await controller.init();
    registerIpc(controller);
    createTray(controller);
  }

  app.whenReady().then(createWindow);

  // 无主窗口：关闭即隐藏，进程常驻托盘
  app.on('window-all-closed', () => {});
  app.on('before-quit', () => {
    if (controller) controller.dispose();
  });
}
