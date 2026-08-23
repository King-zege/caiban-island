import { Agent } from '@earendil-works/pi-agent-core';
import type { AgentEvent, AgentMessage, AgentTool, StreamFn } from '@earendil-works/pi-agent-core';
import { createModels } from '@earendil-works/pi-ai';
import { deepseekProvider } from '@earendil-works/pi-ai/providers/deepseek';
import type { Api, Model } from '@earendil-works/pi-ai';
import type { AgentMessageDto, DeepSeekModel } from '../shared/agentContracts';

export type PiAdapterEvent =
  | { type: 'text_delta'; delta: string }
  | { type: 'assistant_message'; text: string; inputTokens: number; outputTokens: number }
  | { type: 'tool_start'; toolCallId: string; toolName: string }
  | { type: 'tool_end'; toolCallId: string; toolName: string; isError: boolean; draftId?: string; memoryProposalId?: string };

export interface PiRunOptions {
  sessionId: string;
  input: string;
  history: AgentMessageDto[];
  model: DeepSeekModel;
  apiKey: string;
  systemPrompt: string;
  tools: AgentTool[];
  signal: AbortSignal;
  onEvent: (event: PiAdapterEvent) => void | Promise<void>;
}

export type PiRunResult = 'completed' | 'cancelled' | 'limit_reached';

export interface PiAgentRunner {
  run(options: PiRunOptions): Promise<PiRunResult>;
}

export interface PiModelRuntime {
  model: Model<Api>;
  streamFn: StreamFn;
}

export type PiRuntimeFactory = (model: DeepSeekModel, apiKey: string) => PiModelRuntime;

function defaultRuntime(modelId: DeepSeekModel): PiModelRuntime {
  const models = createModels();
  models.setProvider(deepseekProvider());
  const model = models.getModel('deepseek', modelId);
  if (!model) throw new Error('Pi 0.81.1 未找到模型：' + modelId);
  return { model, streamFn: models.streamSimple.bind(models) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function visibleDeltaFromPiEvent(event: AgentEvent): string | null {
  if (event.type !== 'message_update') return null;
  return event.assistantMessageEvent.type === 'text_delta' ? event.assistantMessageEvent.delta : null;
}

function visibleAssistantText(message: AgentMessage): string {
  if (message.role !== 'assistant') return '';
  return message.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim();
}

function historyToPi(messages: AgentMessageDto[]): AgentMessage[] {
  return messages.flatMap((message): AgentMessage[] => {
    if (message.role === 'user') return [{ role: 'user', content: message.content, timestamp: Date.parse(message.createdAt) }];
    if (message.role === 'assistant') {
      return [{
        role: 'assistant', content: [{ type: 'text', text: message.content }], api: 'openai-completions', provider: 'deepseek',
        model: 'history', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: 'stop', timestamp: Date.parse(message.createdAt)
      }];
    }
    return [];
  });
}

export class PiAgentAdapter implements PiAgentRunner {
  constructor(private readonly runtimeFactory: PiRuntimeFactory = defaultRuntime) {}

  async run(options: PiRunOptions): Promise<PiRunResult> {
    const runtime = this.runtimeFactory(options.model, options.apiKey);

    let turnCount = 0;
    let limitReached = false;
    let providerError: string | null = null;
    const agent = new Agent({
      initialState: {
        systemPrompt: options.systemPrompt,
        model: runtime.model,
        thinkingLevel: 'off',
        tools: options.tools,
        messages: historyToPi(options.history)
      },
      streamFn: (activeModel, context, streamOptions) => runtime.streamFn(activeModel, context, {
        ...streamOptions,
        apiKey: options.apiKey,
        signal: streamOptions?.signal,
        timeoutMs: 60000,
        maxRetries: 1,
        maxRetryDelayMs: 60000
      }),
      getApiKey: () => options.apiKey,
      sessionId: options.sessionId,
      toolExecution: 'sequential',
      maxRetryDelayMs: 60000
    });

    const unsubscribe = agent.subscribe(async (event) => {
      if (event.type === 'turn_start') {
        turnCount += 1;
        if (turnCount > 12) {
          limitReached = true;
          agent.abort();
        }
        return;
      }
      const delta = visibleDeltaFromPiEvent(event);
      if (delta !== null) {
        await options.onEvent({ type: 'text_delta', delta });
        return;
      }
      if (event.type === 'message_end' && event.message.role === 'assistant') {
        const text = visibleAssistantText(event.message);
        if (text) {
          await options.onEvent({
            type: 'assistant_message', text,
            inputTokens: event.message.usage.input + event.message.usage.cacheRead,
            outputTokens: Math.max(0, event.message.usage.output - (event.message.usage.reasoning ?? 0))
          });
        }
        if (event.message.stopReason === 'error') providerError = event.message.errorMessage ?? '模型调用失败';
        return;
      }
      if (event.type === 'tool_execution_start') {
        await options.onEvent({ type: 'tool_start', toolCallId: event.toolCallId, toolName: event.toolName });
        return;
      }
      if (event.type === 'tool_execution_end') {
        const raw: unknown = event.result;
        const details = isRecord(raw) && isRecord(raw.details) ? raw.details : null;
        const draftId = details && typeof details.draftId === 'string' ? details.draftId : undefined;
        const memoryProposalId = details && typeof details.memoryProposalId === 'string' ? details.memoryProposalId : undefined;
        await options.onEvent({ type: 'tool_end', toolCallId: event.toolCallId, toolName: event.toolName, isError: event.isError, draftId, memoryProposalId });
      }
    });

    const abort = () => agent.abort();
    options.signal.addEventListener('abort', abort, { once: true });
    try {
      if (options.signal.aborted) return 'cancelled';
      await agent.prompt(options.input);
      if (limitReached) return 'limit_reached';
      if (options.signal.aborted) return 'cancelled';
      if (providerError) throw new Error(providerError);
      if (agent.state.errorMessage) throw new Error(agent.state.errorMessage);
      return 'completed';
    } finally {
      options.signal.removeEventListener('abort', abort);
      unsubscribe();
      agent.clearAllQueues();
    }
  }
}
