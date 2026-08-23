import { randomBytes } from 'node:crypto';
import type { SettingsService } from './settingsService';

const ENCRYPTED_TOKEN_KEY = 'mcp_token_encrypted';
const LEGACY_TOKEN_KEY = 'mcp_token';

export interface SafeStorageAdapter {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

/** Keeps the MCP session bootstrap credential out of plaintext SQLite storage. */
export class McpTokenVault {
  private token: string | null = null;

  constructor(
    private readonly settings: SettingsService,
    private readonly safeStorage: SafeStorageAdapter
  ) {}

  initialize(): string {
    if (this.token) return this.token;
    if (!this.safeStorage.isEncryptionAvailable()) {
      this.settings.delete(LEGACY_TOKEN_KEY);
      this.settings.delete(ENCRYPTED_TOKEN_KEY);
      this.token = this.generate();
      return this.token;
    }

    const encrypted = this.settings.get(ENCRYPTED_TOKEN_KEY);
    if (encrypted) {
      try {
        this.token = this.safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
        this.settings.delete(LEGACY_TOKEN_KEY);
        return this.token;
      } catch {
        this.settings.delete(ENCRYPTED_TOKEN_KEY);
      }
    }

    const legacy = this.settings.get(LEGACY_TOKEN_KEY);
    if (legacy) {
      try {
        this.storeEncrypted(legacy);
        this.settings.delete(LEGACY_TOKEN_KEY);
        this.token = legacy;
        return legacy;
      } catch {
        this.settings.delete(LEGACY_TOKEN_KEY);
        this.settings.delete(ENCRYPTED_TOKEN_KEY);
      }
    }

    return this.reset();
  }

  current(): string {
    return this.token ?? this.initialize();
  }

  reset(): string {
    const next = this.generate();
    this.settings.delete(LEGACY_TOKEN_KEY);
    if (this.safeStorage.isEncryptionAvailable()) {
      try {
        this.storeEncrypted(next);
      } catch {
        this.settings.delete(ENCRYPTED_TOKEN_KEY);
      }
    } else {
      this.settings.delete(ENCRYPTED_TOKEN_KEY);
    }
    this.token = next;
    return next;
  }

  private storeEncrypted(value: string): void {
    const encrypted = this.safeStorage.encryptString(value).toString('base64');
    this.settings.set(ENCRYPTED_TOKEN_KEY, encrypted);
  }

  private generate(): string {
    return randomBytes(24).toString('base64url');
  }
}
