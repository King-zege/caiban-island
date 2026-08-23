import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../src/main/db';
import { McpTokenVault, type SafeStorageAdapter } from '../src/main/mcpTokenVault';
import { SettingsService } from '../src/main/settingsService';

const dirs: string[] = [];

class FakeSafeStorage implements SafeStorageAdapter {
  constructor(private readonly available = true) {}
  isEncryptionAvailable(): boolean { return this.available; }
  encryptString(value: string): Buffer { return Buffer.from('sealed:' + value, 'utf8'); }
  decryptString(value: Buffer): string {
    const text = value.toString('utf8');
    if (!text.startsWith('sealed:')) throw new Error('bad ciphertext');
    return text.slice(7);
  }
}

function fresh(): SettingsService {
  const dir = mkdtempSync(path.join(tmpdir(), 'caiban-token-'));
  dirs.push(dir);
  return new SettingsService(openDatabase(path.join(dir, 'island.db')));
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

describe('MCP token safeStorage 保险库', () => {
  it('启动时迁移旧明文 token，并只保存加密值', () => {
    const settings = fresh();
    settings.set('mcp_token', 'legacy-secret');
    const vault = new McpTokenVault(settings, new FakeSafeStorage());
    expect(vault.initialize()).toBe('legacy-secret');
    expect(settings.get('mcp_token')).toBeNull();
    expect(settings.get('mcp_token_encrypted')).not.toContain('legacy-secret');
  });

  it('损坏密文会被替换，重置后运行时立即使用新 token', () => {
    const settings = fresh();
    settings.set('mcp_token_encrypted', Buffer.from('broken').toString('base64'));
    const vault = new McpTokenVault(settings, new FakeSafeStorage());
    const first = vault.initialize();
    const next = vault.reset();
    expect(first).not.toBe(next);
    expect(vault.current()).toBe(next);
    expect(settings.get('mcp_token')).toBeNull();
  });

  it('系统加密不可用时使用仅限当前进程的 token', () => {
    const settings = fresh();
    settings.set('mcp_token', 'must-not-survive');
    const vault = new McpTokenVault(settings, new FakeSafeStorage(false));
    expect(vault.initialize()).not.toBe('must-not-survive');
    expect(settings.get('mcp_token')).toBeNull();
    expect(settings.get('mcp_token_encrypted')).toBeNull();
  });
});
