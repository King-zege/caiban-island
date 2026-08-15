import { randomBytes, randomUUID } from 'node:crypto';
import http from 'node:http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { AppService } from './appService';
import type { SettingsService } from './settingsService';
import type { DraftNodeProposal } from '../shared/draftContracts';
const NODE_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: '节点标题' },
    description: { type: 'string', description: '节点说明' },
    startUtc: { type: ['string', 'null'], description: '开始时间 ISO8601 UTC' },
    endUtc: { type: ['string', 'null'], description: '截止时间 ISO8601 UTC' }
  },
  required: ['title'],
  additionalProperties: false
};

function textResult(obj: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(obj) }] };
}

export function createMcpServer(appSvc: AppService): Server {
  const server = new Server(
    { name: 'caiban-island', version: '0.1.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'list_active_tasks',
        description: '列出采办岛全部活跃任务（含紧急度、截止时间、进度与下一节点）',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false }
      },
      {
        name: 'get_task_detail',
        description: '获取任务完整详情（节点、链接、备注）',
        inputSchema: {
          type: 'object',
          properties: { taskId: { type: 'string' } },
          required: ['taskId'],
          additionalProperties: false
        }
      },
      {
        name: 'propose_task_draft',
        description: '提交一个任务拆分草稿（名称、说明、截止时间、紧急度、节点列表），草稿需用户在采办岛内审核确认后才生效',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: '任务名称，1-200 字符' },
            description: { type: 'string', description: '任务说明' },
            deadlineUtc: { type: ['string', 'null'], description: '截止时间 ISO8601 UTC，可空' },
            urgency: { type: 'string', enum: ['critical', 'high', 'normal', 'low'], description: '紧急度' },
            nodes: { type: 'array', items: NODE_SCHEMA, description: '时间轴节点' }
          },
          required: ['name', 'nodes'],
          additionalProperties: false
        }
      },
      {
        name: 'propose_node_draft',
        description: '为已有任务提交节点拆分草稿，草稿需用户审核确认后才生效',
        inputSchema: {
          type: 'object',
          properties: {
            taskId: { type: 'string' },
            nodes: { type: 'array', items: NODE_SCHEMA }
          },
          required: ['taskId', 'nodes'],
          additionalProperties: false
        }
      }
    ]
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params.name;
    const args = (req.params.arguments ?? {}) as Record<string, unknown>;
    try {
      if (name === 'list_active_tasks') {
        const cards = appSvc.tasks.listActive();
        return textResult(
          cards.map((c) => ({
            id: c.task.id,
            name: c.task.name,
            deadline: c.task.deadlineUtc,
            urgency: c.task.urgency,
            kind: c.task.kind,
            done: c.progress.done,
            total: c.progress.total,
            nextNode: c.progress.nextTitle,
            overdue: c.overdue
          }))
        );
      }
      if (name === 'get_task_detail') {
        const detail = appSvc.tasks.getTaskDetail(String(args.taskId));
        return textResult(detail);
      }
      if (name === 'propose_task_draft') {
        const nodes = (args.nodes as DraftNodeProposal[]).map((n) => ({
          title: String(n.title ?? ''),
          description: String(n.description ?? ''),
          startUtc: n.startUtc === undefined || n.startUtc === null ? null : String(n.startUtc),
          endUtc: n.endUtc === undefined || n.endUtc === null ? null : String(n.endUtc)
        }));
        const draft = appSvc.drafts.create('mcp', {
          type: 'task',
          taskInput: {
            name: String(args.name ?? ''),
            description: String(args.description ?? ''),
            kind: 'task',
            urgency: (args.urgency as 'critical' | 'high' | 'normal' | 'low') ?? 'normal',
            deadlineUtc: args.deadlineUtc === undefined || args.deadlineUtc === null ? null : String(args.deadlineUtc),
            tzId: Intl.DateTimeFormat().resolvedOptions().timeZone
          },
          nodes,
          warnings: []
        });
        return textResult({ draftId: draft.id, status: 'pending', nodeCount: nodes.length, message: '草稿已进入采办岛审核面板' });
      }
      if (name === 'propose_node_draft') {
        const nodes = (args.nodes as DraftNodeProposal[]).map((n) => ({
          title: String(n.title ?? ''),
          description: String(n.description ?? ''),
          startUtc: n.startUtc === undefined || n.startUtc === null ? null : String(n.startUtc),
          endUtc: n.endUtc === undefined || n.endUtc === null ? null : String(n.endUtc)
        }));
        const draft = appSvc.drafts.create('mcp', {
          type: 'nodes',
          taskId: String(args.taskId),
          nodes,
          warnings: []
        });
        return textResult({ draftId: draft.id, status: 'pending', nodeCount: nodes.length, message: '草稿已进入采办岛审核面板' });
      }
      return textResult({ error: '未知工具：' + name });
    } catch (e) {
      return {
        content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }],
        isError: true
      };
    }
  });

  return server;
}

export interface McpRuntime {
  url: string;
  port: number;
  close: () => void;
}

function checkToken(req: http.IncomingMessage, token: string): boolean {
  const u = new URL(req.url ?? '/', 'http://127.0.0.1');
  return u.searchParams.get('token') === token;
}

interface SessionEntry {
  transport: StreamableHTTPServerTransport | SSEServerTransport;
  server: Server;
}

// 启动双传输 MCP 服务：仅绑定 127.0.0.1，随机端口，token 鉴权
// /mcp → Streamable HTTP（Qoder CLI -t http）；/sse → 经典 SSE（Qoder 桌面 IDE SSE 模式）
// 注意：每个会话必须使用独立的 Server 实例（Server 只能连接一个传输，重复 connect 会返回
// 400 "Server already initialized"）。
export function startMcpServer(appSvc: AppService, settings: SettingsService): Promise<McpRuntime> {
  return new Promise((resolve, reject) => {
    let token = settings.get('mcp_token');
    if (!token) {
      token = randomBytes(24).toString('base64url');
      settings.set('mcp_token', token);
    }
    const sessions = new Map<string, SessionEntry>();
    const noSession = (res: http.ServerResponse) => {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('session not found');
    };

    const httpServer = http.createServer(async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const sid = url.searchParams.get('sessionId');
      // 仅"创建会话"的请求需要 token；带 sessionId 的请求以随机会话 ID 本身为凭据
      // （SDK 客户端从 endpoint 事件得到的新地址不会携带原 URL 的 token）
      if (!sid && !checkToken(req, token as string)) {
        res.writeHead(401, { 'Content-Type': 'text/plain' });
        res.end('unauthorized');
        return;
      }
      try {
        if (url.pathname === '/mcp') {
          if (req.method === 'POST' && !sid) {
            const sessionServer = createMcpServer(appSvc);
            const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() });
            const s = transport.sessionId ?? randomUUID();
            sessions.set(s, { transport, server: sessionServer });
            transport.onclose = () => {
              sessions.delete(s);
            };
            await sessionServer.connect(transport);
            await transport.handleRequest(req, res);
            return;
          }
          const entry = sid ? sessions.get(sid) : undefined;
          if (!entry || !(entry.transport instanceof StreamableHTTPServerTransport)) {
            noSession(res);
            return;
          }
          await entry.transport.handleRequest(req, res);
          return;
        }
        if (url.pathname === '/sse') {
          if (req.method === 'GET') {
            const sessionServer = createMcpServer(appSvc);
            const transport = new SSEServerTransport('/sse', res);
            const s = transport.sessionId;
            sessions.set(s, { transport, server: sessionServer });
            res.on('close', () => {
              sessions.delete(s);
            });
            await sessionServer.connect(transport);
            await transport.start();
            return;
          }
          if (req.method === 'POST') {
            const entry = sid ? sessions.get(sid) : undefined;
            if (!entry || !(entry.transport instanceof SSEServerTransport)) {
              noSession(res);
              return;
            }
            await entry.transport.handlePostMessage(req, res);
            return;
          }
          res.writeHead(405, { 'Content-Type': 'text/plain' });
          res.end('method not allowed');
          return;
        }
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('not found');
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('mcp error: ' + String(e));
      }
    });

    httpServer.on('error', reject);
    httpServer.listen(0, '127.0.0.1', () => {
      const addr = httpServer.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      settings.set('mcp_port', String(port));
      resolve({
        url: 'http://127.0.0.1:' + port + '/mcp?token=' + token,
        port,
        close: () => {
          for (const e of sessions.values()) void e.transport.close();
          httpServer.close();
        }
      });
    });
  });
}
