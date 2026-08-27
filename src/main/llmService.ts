import { safeStorage } from 'electron';
import type { AppService } from './appService';
import type { SettingsService } from './settingsService';
import type { AiStatus, DraftNodeProposal, DraftRecord } from '../shared/draftContracts';
import type { TaskCreateRequest } from '../shared/taskContracts';
import { validateNodeInput, validateTaskCreateRequest } from '../shared/validation';

const SYSTEM_PROMPT =
  '你是采购任务规划助手。先判断用户意图：需要多阶段推进时生成 kind=task 的采购项目并拆分节点；单步骤、主要用于记录或到时提醒时生成 kind=misc 的杂事。' +
  '项目节点要具体、可执行、按时间顺序，5-12 个为宜；杂事的 nodes 必须为空。所有时间使用 ISO8601 UTC。' +
  '必须通过工具调用 propose_task_draft 返回结果，不要输出其他内容。';

const TOOL_DEF = {
  type: 'function',
  function: {
    name: 'propose_task_draft',
    description: '提交采购项目或杂事草稿',
    parameters: {
      oneOf: [
        {
          type: 'object',
          properties: {
            kind: { const: 'task' },
            name: { type: 'string' },
            description: { type: 'string' },
            deadlineUtc: { type: ['string', 'null'] },
            urgency: { type: 'string', enum: ['critical', 'high', 'normal', 'low'] },
            nodes: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  title: { type: 'string' }, description: { type: 'string' },
                  startUtc: { type: ['string', 'null'] }, endUtc: { type: ['string', 'null'] }
                },
                required: ['title'], additionalProperties: false
              }
            }
          },
          required: ['kind', 'name', 'nodes'], additionalProperties: false
        },
        {
          type: 'object',
          properties: {
            kind: { const: 'misc' }, name: { type: 'string' }, note: { type: 'string' },
            remindAtUtc: { type: ['string', 'null'] }, nodes: { type: 'array', maxItems: 0 }
          },
          required: ['kind', 'name', 'nodes'], additionalProperties: false
        }
      ]
    }
  }
};

export class AiError extends Error {}

export class LlmService {
  constructor(
    private readonly appSvc: AppService,
    private readonly settings: SettingsService
  ) {}

  status(): AiStatus {
    return {
      configured: this.settings.get('api_base_url') !== null && this.settings.get('api_key_enc') !== null,
      baseUrl: this.settings.get('api_base_url') ?? '',
      model: this.settings.get('api_model') ?? ''
    };
  }

  saveConfig(baseUrl: string, model: string, key: string): void {
    if (!/^https?:\/\//.test(baseUrl)) throw new AiError('Base URL 必须是 http(s) 地址');
    this.settings.set('api_base_url', baseUrl.trim().replace(/\/$/, ''));
    this.settings.set('api_model', model.trim());
    if (key) {
      if (!safeStorage.isEncryptionAvailable()) throw new AiError('系统加密不可用，无法安全保存 API Key');
      this.settings.set('api_key_enc', safeStorage.encryptString(key).toString('base64'));
    }
  }

  async test(): Promise<string> {
    const cfg = this.requireConfig();
    const res = await fetch(cfg.baseUrl + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.key },
      body: JSON.stringify({ model: cfg.model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 }),
      signal: AbortSignal.timeout(15000)
    });
    if (!res.ok) throw new AiError('连接失败（HTTP ' + res.status + '）：' + (await res.text()).slice(0, 200));
    return '连接成功（HTTP ' + res.status + '）';
  }

  // FR-042：内置 API 拆解 → 草稿（function call + 一次自动修复）
  async breakdown(description: string): Promise<DraftRecord> {
    const cfg = this.requireConfig();
    const call = async (messages: Array<{ role: string; content: string }>): Promise<unknown> => {
      const res = await fetch(cfg.baseUrl + '/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.key },
        body: JSON.stringify({
          model: cfg.model,
          messages,
          tools: [TOOL_DEF],
          tool_choice: 'auto',
          temperature: 0.2
        }),
        signal: AbortSignal.timeout(60000)
      });
      if (!res.ok) throw new AiError('模型调用失败（HTTP ' + res.status + '）');
      const data = (await res.json()) as {
        choices: Array<{ message: { tool_calls?: Array<{ function: { arguments: string } }>; content?: string | null } }>;
      };
      const msg = data.choices?.[0]?.message;
      const toolCall = msg?.tool_calls?.[0]?.function;
      if (toolCall && toolCall.arguments) {
        try {
          return JSON.parse(toolCall.arguments);
        } catch {
          throw new AiError('模型返回了无法解析的 JSON');
        }
      }
      if (msg?.content) {
        try {
          return JSON.parse(msg.content);
        } catch {
          throw new AiError('模型未返回结构化结果');
        }
      }
      throw new AiError('模型未返回结果');
    };

    const buildPayload = (raw: unknown): { taskInput: TaskCreateRequest; nodes: DraftNodeProposal[] } => {
      const o = raw as Record<string, unknown>;
      const nodes = Array.isArray(o.nodes)
        ? o.nodes.map((n) => ({
            title: String((n as Record<string, unknown>).title ?? ''),
            description: String((n as Record<string, unknown>).description ?? ''),
            startUtc: (n as Record<string, unknown>).startUtc ? String((n as Record<string, unknown>).startUtc) : null,
            endUtc: (n as Record<string, unknown>).endUtc ? String((n as Record<string, unknown>).endUtc) : null
          }))
        : [];
      const tzId = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (o.kind === 'misc') {
        return {
          taskInput: {
            kind: 'misc', name: String(o.name ?? ''), note: String(o.note ?? ''),
            remindAtUtc: o.remindAtUtc ? String(o.remindAtUtc) : null, tzId
          },
          nodes: []
        };
      }
      return {
        taskInput: {
          kind: 'task', name: String(o.name ?? ''), description: String(o.description ?? ''),
          deadlineUtc: o.deadlineUtc ? String(o.deadlineUtc) : null,
          urgency: String(o.urgency ?? 'normal') as 'critical' | 'high' | 'normal' | 'low', tzId
        },
        nodes
      };
    };

    const tryCreate = (payload: ReturnType<typeof buildPayload>): { ok: true; draft: DraftRecord } | { ok: false; errors: string[] } => {
      const tv = validateTaskCreateRequest(payload.taskInput);
      if (!tv.ok) return { ok: false, errors: tv.errors };
      for (const n of payload.nodes) {
        const nv = validateNodeInput(n);
        if (!nv.ok) return { ok: false, errors: nv.errors };
      }
      return {
        ok: true,
        draft: this.appSvc.drafts.create('api', {
          type: 'task',
          taskInput: payload.taskInput,
          nodes: payload.nodes,
          warnings: []
        })
      };
    };

    const baseMessages = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: description }
    ];

    // 首次调用
    const first = tryCreate(buildPayload(await call(baseMessages)));
    if (first.ok) return first.draft;

    // FR-046：自动修复一次
    const repairMessages = [
      ...baseMessages,
      {
        role: 'assistant',
        content: '我之前的输出校验未通过，我将重新提交。'
      },
      { role: 'user', content: '上次输出未通过校验：' + first.errors.join('；') + '。请重新调用工具，确保字段合法。' }
    ];
    const second = tryCreate(buildPayload(await call(repairMessages)));
    if (second.ok) return second.draft;
    throw new AiError('模型输出两次校验失败：' + second.errors.join('；'));
  }

  private requireConfig(): { baseUrl: string; model: string; key: string } {
    const baseUrl = this.settings.get('api_base_url');
    const model = this.settings.get('api_model');
    const enc = this.settings.get('api_key_enc');
    if (!baseUrl || !model || !enc) throw new AiError('未配置内置 AI（设置 → AI 配置）');
    let key: string;
    try {
      key = safeStorage.decryptString(Buffer.from(enc, 'base64'));
    } catch {
      throw new AiError('API Key 解密失败，请重新配置');
    }
    return { baseUrl, model, key };
  }
}
