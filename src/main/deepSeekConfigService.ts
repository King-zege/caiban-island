import type { DeepSeekModel, DeepSeekStatus } from '../shared/agentContracts';
import { DEEPSEEK_MODELS } from '../shared/agentContracts';
import type { SafeStorageAdapter } from './mcpTokenVault';
import type { SettingsService } from './settingsService';

export const DEEPSEEK_BASE_URL = 'https://api.deepseek.com' as const;
const MODEL_KEY = 'deepseek_model';
const API_KEY_SETTING = 'deepseek_api_key_encrypted';

export class DeepSeekConfigError extends Error {}

export class DeepSeekConfigService {
  constructor(
    private readonly settings: SettingsService,
    private readonly safeStorage: SafeStorageAdapter,
    private readonly fetchFn: typeof fetch = fetch
  ) {}

  status(): DeepSeekStatus {
    return {
      configured: this.settings.get(API_KEY_SETTING) !== null,
      baseUrl: DEEPSEEK_BASE_URL,
      model: this.model()
    };
  }

  save(model: DeepSeekModel, apiKey: string): void {
    if (!DEEPSEEK_MODELS.includes(model)) throw new DeepSeekConfigError('不支持的 DeepSeek 模型');
    this.settings.set(MODEL_KEY, model);
    if (apiKey.trim()) {
      if (!this.safeStorage.isEncryptionAvailable()) throw new DeepSeekConfigError('系统加密不可用，无法安全保存 DeepSeek API Key');
      this.settings.set(API_KEY_SETTING, this.safeStorage.encryptString(apiKey.trim()).toString('base64'));
    }
  }

  model(): DeepSeekModel {
    const value = this.settings.get(MODEL_KEY);
    return value && DEEPSEEK_MODELS.includes(value as DeepSeekModel) ? value as DeepSeekModel : 'deepseek-v4-flash';
  }

  apiKey(): string {
    const encrypted = this.settings.get(API_KEY_SETTING);
    if (!encrypted) throw new DeepSeekConfigError('尚未配置 DeepSeek API Key');
    try {
      return this.safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
    } catch {
      throw new DeepSeekConfigError('DeepSeek API Key 解密失败，请重新配置');
    }
  }

  async test(signal?: AbortSignal): Promise<string> {
    const response = await this.fetchFn(DEEPSEEK_BASE_URL + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + this.apiKey() },
      body: JSON.stringify({ model: this.model(), messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 }),
      signal: signal ?? AbortSignal.timeout(15000)
    });
    if (!response.ok) throw new DeepSeekConfigError('连接失败（HTTP ' + response.status + '）');
    return '连接成功（HTTP ' + response.status + '）';
  }
}
