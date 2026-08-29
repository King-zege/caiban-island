import { randomBytes } from 'node:crypto';
import type { SafeStorageAdapter } from './safeStorageAdapter';
import type { SettingsService } from './settingsService';

const TOKEN_KEY = 'local_command_token_encrypted';

export class LocalApiTokenVault {
  private token: string | null = null;

  constructor(private readonly settings: SettingsService, private readonly safeStorage: SafeStorageAdapter) {}

  initialize(): string {
    if (this.token) return this.token;
    if (!this.safeStorage.isEncryptionAvailable()) throw new Error('系统加密不可用，无法启动本地命令接口');
    const encrypted = this.settings.get(TOKEN_KEY);
    if (encrypted) {
      try {
        this.token = this.safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
        return this.token;
      } catch {
        this.settings.delete(TOKEN_KEY);
      }
    }
    this.token = randomBytes(32).toString('base64url');
    this.settings.set(TOKEN_KEY, this.safeStorage.encryptString(this.token).toString('base64'));
    return this.token;
  }

  current(): string { return this.initialize(); }

  reset(): string {
    this.token = null;
    this.settings.delete(TOKEN_KEY);
    return this.initialize();
  }
}
