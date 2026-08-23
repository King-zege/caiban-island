import { describe, expect, it } from 'vitest';
import electronViteConfig from '../electron.vite.config';

describe('Electron main ESM 打包边界', () => {
  it('将 Pi 的两个纯 ESM 包内联，避免 portable 以 CommonJS require 加载', () => {
    const config = electronViteConfig as {
      main?: { build?: { externalizeDeps?: { exclude?: string[] } } };
    };
    expect(config.main?.build?.externalizeDeps).toEqual({
      exclude: ['@earendil-works/pi-agent-core', '@earendil-works/pi-ai']
    });
  });
});
