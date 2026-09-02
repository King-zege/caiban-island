import {
  AGENT_PROVIDER_IDS,
  DEEPSEEK_BASE_URL,
  DEEPSEEK_MODELS,
  GLM_BASE_URLS,
  GLM_MODELS
} from '../shared/agentContracts';
import type {
  AgentProviderConfigInput,
  AgentProviderId,
  AgentProviderRuntimeConfig,
  AgentProviderStatus,
  DeepSeekModel
} from '../shared/agentContracts';
import type { SafeStorageAdapter } from './safeStorageAdapter';
import type { SettingsService } from './settingsService';

const ACTIVE_PROVIDER_KEY = 'agent_provider';
const MODEL_KEYS: Record<AgentProviderId, string> = {
  deepseek: 'deepseek_model',
  glm: 'glm_model',
  enterprise: 'enterprise_model'
};
const API_KEY_SETTINGS: Record<AgentProviderId, string> = {
  deepseek: 'deepseek_api_key_encrypted',
  glm: 'glm_api_key_encrypted',
  enterprise: 'enterprise_api_key_encrypted'
};
const ENTERPRISE_BASE_URL_KEY = 'enterprise_base_url';
const GLM_BASE_URL_KEY = 'glm_base_url';

export class AgentProviderConfigError extends Error {}

function validProvider(value: string | null): value is AgentProviderId {
  return value !== null && AGENT_PROVIDER_IDS.includes(value as AgentProviderId);
}

function cleanModel(raw: string): string {
  const model = raw.trim();
  if (!model || model.length > 200 || /[\u0000-\u001f\u007f]/u.test(model)) {
    throw new AgentProviderConfigError('模型 ID 必须为 1–200 个可见字符');
  }
  return model;
}

function isLoopback(hostname: string): boolean {
  const normalized = hostname.toLocaleLowerCase('en-US');
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '[::1]' || normalized === '::1';
}

export function normalizeEnterpriseBaseUrl(raw: string): string {
  const value = raw.trim();
  if (!value || value.length > 2048) throw new AgentProviderConfigError('企业 Base URL 必须为 1–2048 个字符');
  let url: URL;
  try { url = new URL(value); } catch { throw new AgentProviderConfigError('企业 Base URL 格式无效'); }
  if (url.username || url.password) throw new AgentProviderConfigError('企业 Base URL 不能包含账号或密码');
  if (url.search || url.hash) throw new AgentProviderConfigError('企业 Base URL 不能包含查询参数或片段');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback(url.hostname))) {
    throw new AgentProviderConfigError('企业 Base URL 必须使用 HTTPS；仅本机回环地址允许 HTTP');
  }
  url.pathname = url.pathname.replace(/\/chat\/completions\/?$/iu, '').replace(/\/+$/u, '');
  return url.toString().replace(/\/$/u, '');
}

export class AgentProviderConfigService {
  constructor(
    private readonly settings: SettingsService,
    private readonly safeStorage: SafeStorageAdapter,
    private readonly fetchFn: typeof fetch = fetch
  ) {}

  status(): AgentProviderStatus {
    const provider = this.provider();
    const profiles = Object.fromEntries(AGENT_PROVIDER_IDS.map((candidate) => [candidate, {
      configured: this.isConfigured(candidate),
      baseUrl: this.baseUrl(candidate),
      model: this.model(candidate)
    }])) as AgentProviderStatus['profiles'];
    return {
      provider,
      configured: this.isConfigured(provider),
      configuredProviders: AGENT_PROVIDER_IDS.filter((candidate) => this.isConfigured(candidate)),
      baseUrl: this.baseUrl(provider),
      model: this.model(provider),
      profiles
    };
  }

  saveConfig(input: AgentProviderConfigInput): void {
    if (!AGENT_PROVIDER_IDS.includes(input.provider)) throw new AgentProviderConfigError('不支持的 Agent Provider');
    const model = cleanModel(input.model);
    if (input.provider === 'deepseek' && !DEEPSEEK_MODELS.includes(model as DeepSeekModel)) {
      throw new AgentProviderConfigError('不支持的 DeepSeek 模型');
    }
    if (input.provider === 'glm' && !GLM_MODELS.includes(model as (typeof GLM_MODELS)[number])) {
      throw new AgentProviderConfigError('不支持的 GLM 模型');
    }
    const baseUrl = input.provider === 'deepseek'
      ? DEEPSEEK_BASE_URL
      : input.provider === 'glm'
        ? GLM_BASE_URLS.includes(input.baseUrl.trim() as (typeof GLM_BASE_URLS)[number])
          ? input.baseUrl.trim()
          : (() => { throw new AgentProviderConfigError('不支持的 GLM 服务地址'); })()
        : normalizeEnterpriseBaseUrl(input.baseUrl);
    const encryptedApiKey = this.encryptApiKey(input.apiKey);
    this.settings.set(ACTIVE_PROVIDER_KEY, input.provider);
    this.settings.set(MODEL_KEYS[input.provider], model);
    if (input.provider === 'glm') this.settings.set(GLM_BASE_URL_KEY, baseUrl);
    if (input.provider === 'enterprise') this.settings.set(ENTERPRISE_BASE_URL_KEY, baseUrl);
    if (encryptedApiKey) this.settings.set(API_KEY_SETTINGS[input.provider], encryptedApiKey);
  }

  /** @deprecated Compatibility adapter for the previous DeepSeek-only API. */
  save(model: DeepSeekModel, apiKey: string): void {
    this.saveConfig({ provider: 'deepseek', baseUrl: DEEPSEEK_BASE_URL, model, apiKey });
  }

  provider(): AgentProviderId {
    const value = this.settings.get(ACTIVE_PROVIDER_KEY);
    return validProvider(value) ? value : 'deepseek';
  }

  model(provider = this.provider()): string {
    const value = this.settings.get(MODEL_KEYS[provider]);
    if (provider === 'deepseek') return value && DEEPSEEK_MODELS.includes(value as DeepSeekModel) ? value : 'deepseek-v4-flash';
    if (provider === 'glm') return value && GLM_MODELS.includes(value as (typeof GLM_MODELS)[number]) ? value : 'glm-5.2';
    return value?.trim() || '';
  }

  baseUrl(provider = this.provider()): string {
    if (provider === 'deepseek') return DEEPSEEK_BASE_URL;
    if (provider === 'glm') {
      const value = this.settings.get(GLM_BASE_URL_KEY);
      return value && GLM_BASE_URLS.includes(value as (typeof GLM_BASE_URLS)[number]) ? value : GLM_BASE_URLS[0];
    }
    return this.settings.get(ENTERPRISE_BASE_URL_KEY)?.trim() ?? '';
  }

  apiKey(provider = this.provider()): string {
    const encrypted = this.settings.get(API_KEY_SETTINGS[provider]);
    if (!encrypted) throw new AgentProviderConfigError(`尚未配置${this.providerLabel(provider)} API Key`);
    try {
      return this.safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
    } catch {
      throw new AgentProviderConfigError(`${this.providerLabel(provider)} API Key 解密失败，请重新配置`);
    }
  }

  runtime(): AgentProviderRuntimeConfig {
    const provider = this.provider();
    const model = cleanModel(this.model(provider));
    const baseUrl = provider === 'enterprise' ? normalizeEnterpriseBaseUrl(this.baseUrl(provider)) : this.baseUrl(provider);
    return { provider, baseUrl, model, apiKey: this.apiKey(provider) };
  }

  async test(signal?: AbortSignal): Promise<string> {
    const config = this.runtime();
    const requestSignal = signal ?? AbortSignal.timeout(15000);
    const response = config.provider === 'deepseek'
      ? await this.fetchFn(`${config.baseUrl}/models`, {
          method: 'GET', headers: { Authorization: `Bearer ${config.apiKey}` }, signal: requestSignal
        })
      : await this.fetchFn(`${config.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: config.model, messages: [{ role: 'user', content: '仅回复 OK' }], stream: false, max_tokens: 1 }),
          signal: requestSignal
        });
    if (!response.ok) throw new AgentProviderConfigError(`连接失败（HTTP ${response.status}）`);
    return `连接成功（HTTP ${response.status}）`;
  }

  private isConfigured(provider: AgentProviderId): boolean {
    return Boolean(this.settings.get(API_KEY_SETTINGS[provider]));
  }

  private encryptApiKey(rawApiKey: string): string | null {
    const apiKey = rawApiKey.trim();
    if (!apiKey) return null;
    if (apiKey.length > 8192) throw new AgentProviderConfigError('API Key 不能超过 8192 个字符');
    if (!this.safeStorage.isEncryptionAvailable()) throw new AgentProviderConfigError('系统加密不可用，无法安全保存 API Key');
    return this.safeStorage.encryptString(apiKey).toString('base64');
  }

  private providerLabel(provider: AgentProviderId): string {
    return provider === 'deepseek' ? 'DeepSeek' : provider === 'glm' ? 'GLM' : '企业网关';
  }
}
