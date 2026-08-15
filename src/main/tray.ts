import { app, Menu, nativeImage, Tray } from 'electron';
import path from 'node:path';
import type { IslandWindowController } from './windowController';

export function createTray(c: IslandWindowController): Tray {
  const icon = nativeImage.createFromPath(path.join(app.getAppPath(), 'resources', 'tray.png'));
  const tray = new Tray(icon);
  tray.setToolTip('采办岛');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '打开采办岛', click: () => c.setLevel('l2') },
      { label: '暂停/恢复灵动岛', click: () => c.togglePause() },
      { type: 'separator' },
      { label: '退出', click: () => app.quit() }
    ])
  );
  tray.on('double-click', () => c.setLevel(c.level === 'l1' ? 'l2' : 'l1'));
  return tray;
}
