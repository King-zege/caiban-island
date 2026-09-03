import {
  AGENT_PROVIDER_IDS,
  DEEPSEEK_BASE_URL,
  DEEPSEEK_MODELS,
  GLM_BASE_URLS,
  GLM_MODELS,
  PENG_MODELS_URL,
  PENG_OPENAI_BASE_URL,
  PENG_PROVIDER_IDS,
  PENG_ROOT_URL
} from '../shared/agentContracts';
import type {
  AgentProviderConfigInput,
  AgentProviderId,
  AgentProviderRuntimeConfig,
  AgentProviderStatus,
  AgentProviderProtocol,
  DeepSeekModel,
  PengModelDiscoveryResult,
  PengProviderId
} from '../shared/agentContracts';
import type { SafeStorageAdapter } from './safeStorageAdapter';
import type { SettingsService } from './settingsService';

const ACTIVE_PROVIDER_KEY = 'agent_provider';
const MODEL_KEYS: Record<AgentProviderId, string> = {
  deepseek: 'deepseek_model',
  glm: 'glm_model',
  peng_deepseek: 'peng_deepseek_model',
  peng_openai: 'peng_openai_model',
  peng_anthropic: 'peng_anthropic_model'
};
const DEEPSEEK_API_KEY = 'deepseek_api_key_encrypted';
const GLM_API_KEY = 'glm_api_key_encrypted';
const PENG_API_KEY = 'peng_api_key_encrypted';
const GLM_BASE_URL_KEY = 'glm_base_url';
const LEGACY_ENTERPRISE_BASE_URL_KEY = 'enterprise_base_url';
const LEGACY_ENTERPRISE_MODEL_KEY = 'enterprise_model';
const LEGACY_ENTERPRISE_API_KEY = 'enterprise_api_key_encrypted';

export class AgentProviderConfigError extends Error {
  constructor(
    message: string,
    readonly category: 'configuration' | 'authentication' | 'model_not_allowed' | 'rate_limit' | 'provider' | 'timeout' | 'network' | 'invalid_response' = 'configuration',
    readonly retryable = false
  ) { super(message); }
}

function httpError(action: string, status: number): AgentProviderConfigError {
  if (status === 401 || status === 403) return new AgentProviderConfigError(`${action}：认证失败（HTTP ${status}）`, 'authentication');
  if (status === 400 || status === 404 || status === 422) return new AgentProviderConfigError(`${action}：模型未授权或与所选协议不兼容（HTTP ${status}）`, 'model_not_allowed');
  if (status === 429) return new AgentProviderConfigError(`${action}：请求受到限流（HTTP 429）`, 'rate_limit', true);
  if (status >= 500) return new AgentProviderConfigError(`${action}：网关暂时不可用（HTTP ${status}）`, 'provider', true);
  return new AgentProviderConfigError(`${action}（HTTP ${status}）`, 'provider');
}

async function safeFetch(fetchFn: typeof fetch, input: string, init: RequestInit): Promise<Response> {
  try { return await fetchFn(input, init); }
  catch (error) {
    if (init.signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
      throw new AgentProviderConfigError('连接超时，请稍后重试', 'timeout', true);
    }
    throw new AgentProviderConfigError('网络连接失败，请检查网络后重试', 'network', true);
  }
}

function isPengProvider(provider: AgentProviderId): provider is PengProviderId {
  return PENG_PROVIDER_IDS.includes(provider as PengProviderId);
}

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

function cleanApiKey(raw: string): string {
  const apiKey = raw.trim();
  if (!apiKey) throw new AgentProviderConfigError('请输入 API Key');
  if (apiKey.length > 8192) throw new AgentProviderConfigError('API Key 不能超过 8192 个字符');
  return apiKey;
}

function safeLegacyUrl(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    if (url.username || url.password || url.search || url.hash || url.protocol !== 'https:') return null;
    url.pathname = url.pathname.replace(/\/chat\/completions\/?$/iu, '').replace(/\/+$/u, '');
    return url.toString().replace(/\/$/u, '');
  } catch {
    return null;
  }
}

function parseModelList(value: unknown): string[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new AgentProviderConfigError('模型列表响应格式无效');
  }
  const data = (value as { data?: unknown }).data;
  if (!Array.isArray(data)) throw new AgentProviderConfigError('模型列表响应缺少 data 数组');
  const models = data.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return [];
    const id = (entry as { id?: unknown }).id;
    if (typeof id !== 'string') return [];
    try { return [cleanModel(id)]; } catch { return []; }
  });
  return [...new Set(models)].sort((left, right) => left.localeCompare(right, 'zh-CN'));
}

export class AgentProviderConfigService {
  constructor(
    private readonly settings: SettingsService,
    private readonly safeStorage: SafeStorageAdapter,
    private readonly fetchFn: typeof fetch = fetch
  ) {
    this.migratePengEnterprise();
  }

  status(): AgentProviderStatus {
    const provider = this.provider();
    const profiles = Object.fromEntries(AGENT_PROVIDER_IDS.map((candidate) => [candidate, {
      configured: this.isConfigured(candidate),
      baseUrl: this.baseUrl(candidate),
      model: this.model(candidate),
      protocol: this.protocol(candidate)
    }])) as AgentProviderStatus['profiles'];
    return {
      provider,
      protocol: this.protocol(provider),
      configured: this.isConfigured(provider),
      configuredProviders: AGENT_PROVIDER_IDS.filter((candidate) => this.isConfigured(candidate)),
      baseUrl: this.baseUrl(provider),
      model: this.model(provider),
      profiles,
      pengKeyConfigured: Boolean(this.settings.get(PENG_API_KEY)),
      pengMigrationRequired: this.pengMigrationRequired()
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
    if (input.provider === 'glm' && !GLM_BASE_URLS.includes(input.baseUrl.trim() as (typeof GLM_BASE_URLS)[number])) {
      throw new AgentProviderConfigError('不支持的 GLM 服务地址');
    }
    if (isPengProvider(input.provider) && input.baseUrl.trim() !== this.baseUrl(input.provider)) {
      throw new AgentProviderConfigError('Peng 服务地址由应用固定管理');
    }

    const encryptedApiKey = input.apiKey.trim() ? this.encryptApiKey(input.apiKey) : null;
    this.settings.set(ACTIVE_PROVIDER_KEY, input.provider);
    this.settings.set(MODEL_KEYS[input.provider], model);
    if (input.provider === 'glm') this.settings.set(GLM_BASE_URL_KEY, input.baseUrl.trim());
    if (encryptedApiKey) this.settings.set(this.apiKeySetting(input.provider), encryptedApiKey);
    if (isPengProvider(input.provider)) this.clearLegacyEnterprise();
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
    return provider === 'peng_anthropic' ? PENG_ROOT_URL : PENG_OPENAI_BASE_URL;
  }

  apiKey(provider = this.provider()): string {
    const encrypted = this.settings.get(this.apiKeySetting(provider));
    if (!encrypted) throw new AgentProviderConfigError(`尚未配置${this.providerLabel(provider)} API Key`);
    try {
      return this.safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
    } catch {
      throw new AgentProviderConfigError(`${this.providerLabel(provider)} API Key 解密失败，请重新配置`);
    }
  }

  runtime(): AgentProviderRuntimeConfig {
    const provider = this.provider();
    return { provider, protocol: this.protocol(provider), baseUrl: this.baseUrl(provider), model: cleanModel(this.model(provider)), apiKey: this.apiKey(provider) };
  }

  protocol(provider = this.provider()): AgentProviderProtocol {
    if (provider === 'peng_openai') return 'openai-responses';
    if (provider === 'peng_anthropic') return 'anthropic-messages';
    return 'openai-completions';
  }

  async discoverPengModels(rawApiKey = '', signal?: AbortSignal): Promise<PengModelDiscoveryResult> {
    const apiKey = rawApiKey.trim() ? cleanApiKey(rawApiKey) : this.apiKey('peng_deepseek');
    const response = await safeFetch(this.fetchFn, PENG_MODELS_URL, {
      method: 'GET', headers: { Authorization: `Bearer ${apiKey}` }, signal: signal ?? AbortSignal.timeout(15000)
    });
    if (!response.ok) throw httpError('获取模型失败', response.status);
    let payload: unknown;
    try { payload = await response.json() as unknown; } catch { throw new AgentProviderConfigError('模型列表不是有效 JSON'); }
    const models = parseModelList(payload);
    if (models.length === 0) throw new AgentProviderConfigError('网关未返回可用模型');
    return { models, fetchedAt: new Date().toISOString() };
  }

  async test(signal?: AbortSignal): Promise<string> {
    const config = this.runtime();
    const requestSignal = signal ?? AbortSignal.timeout(15000);
    if (isPengProvider(config.provider)) {
      const discovered = await this.discoverPengModels('', requestSignal);
      if (!discovered.models.includes(config.model)) throw new AgentProviderConfigError('选定模型不在网关返回的模型列表中');
    }
    const response = await safeFetch(this.fetchFn, this.testUrl(config.provider), this.testRequest(config, requestSignal));
    if (!response.ok) throw httpError('连接失败', response.status);
    await this.validateTestResponse(config.provider, response);
    return `连接成功（HTTP ${response.status}）`;
  }

  private async validateTestResponse(provider: AgentProviderId, response: Response): Promise<void> {
    let payload: unknown;
    try { payload = await response.json() as unknown; }
    catch { throw new AgentProviderConfigError('模型测试响应不是有效 JSON', 'invalid_response'); }
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
      throw new AgentProviderConfigError('模型测试响应格式无效', 'invalid_response');
    }
    const record = payload as Record<string, unknown>;
    let valid = false;
    if (provider === 'deepseek') valid = Array.isArray(record.data);
    else if (provider === 'peng_openai') valid = Array.isArray(record.output) || typeof record.output_text === 'string';
    else if (provider === 'peng_anthropic') valid = Array.isArray(record.content);
    else valid = Array.isArray(record.choices);
    if (!valid) throw new AgentProviderConfigError('模型测试返回了异常协议响应', 'invalid_response');
  }

  private testUrl(provider: AgentProviderId): string {
    if (provider === 'deepseek') return `${DEEPSEEK_BASE_URL}/models`;
    if (provider === 'glm') return `${this.baseUrl(provider)}/chat/completions`;
    if (provider === 'peng_deepseek') return `${PENG_OPENAI_BASE_URL}/chat/completions`;
    if (provider === 'peng_openai') return `${PENG_OPENAI_BASE_URL}/responses`;
    return `${PENG_ROOT_URL}/v1/messages`;
  }

  private testRequest(config: AgentProviderRuntimeConfig, signal: AbortSignal): RequestInit {
    if (config.provider === 'deepseek') {
      return { method: 'GET', headers: { Authorization: `Bearer ${config.apiKey}` }, signal };
    }
    if (config.provider === 'peng_openai') {
      return {
        method: 'POST', headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: config.model, input: '仅回复 OK', max_output_tokens: 16 }), signal
      };
    }
    if (config.provider === 'peng_anthropic') {
      return {
        method: 'POST', headers: { 'x-api-key': config.apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: config.model, messages: [{ role: 'user', content: '仅回复 OK' }], max_tokens: 8 }), signal
      };
    }
    return {
      method: 'POST', headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: config.model, messages: [{ role: 'user', content: '仅回复 OK' }], stream: false, max_tokens: 8 }), signal
    };
  }

  private isConfigured(provider: AgentProviderId): boolean {
    return Boolean(this.settings.get(this.apiKeySetting(provider))) && (provider === 'deepseek' || provider === 'glm' || Boolean(this.model(provider)));
  }

  private apiKeySetting(provider: AgentProviderId): string {
    if (provider === 'deepseek') return DEEPSEEK_API_KEY;
    if (provider === 'glm') return GLM_API_KEY;
    return PENG_API_KEY;
  }

  private encryptApiKey(rawApiKey: string): string {
    const apiKey = cleanApiKey(rawApiKey);
    if (!this.safeStorage.isEncryptionAvailable()) throw new AgentProviderConfigError('系统加密不可用，无法安全保存 API Key');
    return this.safeStorage.encryptString(apiKey).toString('base64');
  }

  private providerLabel(provider: AgentProviderId): string {
    if (provider === 'deepseek') return 'DeepSeek';
    if (provider === 'glm') return 'GLM';
    return 'Peng 企业网关';
  }

  private migratePengEnterprise(): void {
    if (this.settings.get(ACTIVE_PROVIDER_KEY) !== 'enterprise') return;
    const legacyUrl = this.settings.get(LEGACY_ENTERPRISE_BASE_URL_KEY);
    if (!legacyUrl || safeLegacyUrl(legacyUrl) !== PENG_OPENAI_BASE_URL) {
      this.settings.set(ACTIVE_PROVIDER_KEY, 'deepseek');
      return;
    }
    const model = this.settings.get(LEGACY_ENTERPRISE_MODEL_KEY)?.trim();
    const encrypted = this.settings.get(LEGACY_ENTERPRISE_API_KEY);
    if (model) this.settings.set(MODEL_KEYS.peng_deepseek, model);
    if (encrypted) this.settings.set(PENG_API_KEY, encrypted);
    this.settings.set(ACTIVE_PROVIDER_KEY, 'peng_deepseek');
    this.clearLegacyEnterprise();
  }

  private pengMigrationRequired(): boolean {
    const legacyKey = this.settings.get(LEGACY_ENTERPRISE_API_KEY);
    if (!legacyKey) return false;
    const legacyUrl = this.settings.get(LEGACY_ENTERPRISE_BASE_URL_KEY);
    return !legacyUrl || safeLegacyUrl(legacyUrl) !== PENG_OPENAI_BASE_URL;
  }

  private clearLegacyEnterprise(): void {
    this.settings.delete(LEGACY_ENTERPRISE_BASE_URL_KEY);
    this.settings.delete(LEGACY_ENTERPRISE_MODEL_KEY);
    this.settings.delete(LEGACY_ENTERPRISE_API_KEY);
  }
}
