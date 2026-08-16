import { describe, expect, it } from 'vitest';
import { resolveUserDataPath } from '../src/main/userData';

describe('resolveUserDataPath', () => {
  const appData = 'C:\\Users\\tester\\AppData\\Roaming';
  const temp = 'C:\\Users\\tester\\AppData\\Local\\Temp';

  it('默认使用正式 caiban-island 目录', () => {
    expect(resolveUserDataPath(appData, undefined, false, temp)).toBe(
      'C:\\Users\\tester\\AppData\\Roaming\\caiban-island'
    );
  });

  it('开发测试只接受临时目录内的绝对路径', () => {
    const target = temp + '\\caiban-ui-test-123';
    expect(resolveUserDataPath(appData, target, false, temp)).toBe(target);
    expect(() => resolveUserDataPath(appData, 'relative-dir', false, temp)).toThrow('绝对路径');
    expect(() => resolveUserDataPath(appData, appData, false, temp)).toThrow('系统临时目录');
    expect(() => resolveUserDataPath(appData, temp, false, temp)).toThrow('临时目录根');
  });

  it('生产包拒绝任何测试覆盖', () => {
    expect(() => resolveUserDataPath(appData, temp + '\\caiban-ui-test-123', true, temp)).toThrow('生产环境');
  });
});
