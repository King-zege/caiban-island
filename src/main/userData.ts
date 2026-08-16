import os from 'node:os';
import path from 'node:path';

export function resolveUserDataPath(
  appDataDir: string,
  testOverride: string | undefined,
  isPackaged: boolean,
  tempDir = os.tmpdir()
): string {
  if (!testOverride) return path.join(appDataDir, 'caiban-island');
  if (isPackaged) throw new Error('生产环境不允许覆盖用户数据目录');
  if (!path.isAbsolute(testOverride)) throw new Error('测试用户数据目录必须是绝对路径');

  const target = path.resolve(testOverride);
  const tempRoot = path.resolve(tempDir);
  const relative = path.relative(tempRoot, target);
  const outsideTemp = relative === '' || relative.startsWith('..') || path.isAbsolute(relative);
  if (outsideTemp) throw new Error('测试用户数据目录必须位于系统临时目录内，且不能是临时目录根');
  return target;
}
