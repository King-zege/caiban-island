import { randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { parseAppCommand } from '../shared/appCommandContracts';
import type { LocalCommandConfig } from '../shared/agentContracts';
import type { AgentPermissionService } from './agentPermissionService';
import type { AppCommandService } from './appCommandService';
import type { LocalApiTokenVault } from './localApiTokenVault';

const MAX_BODY_BYTES = 128 * 1024;

function secureEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function respond(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

export interface LocalCommandRuntime {
  config(): LocalCommandConfig;
  close(): Promise<void>;
}

export async function startLocalCommandServer(
  commands: AppCommandService,
  permissions: AgentPermissionService,
  tokenVault: LocalApiTokenVault,
  cliScriptPath: string
): Promise<LocalCommandRuntime> {
  const server = createServer((request, response) => void handle(request, response));
  const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    if (request.method !== 'POST' || request.url !== '/commands') { respond(response, 404, { error: 'not_found' }); return; }
    const bearer = request.headers.authorization?.replace(/^Bearer\s+/i, '') ?? '';
    if (!bearer || !secureEqual(bearer, tokenVault.current())) { respond(response, 401, { error: 'unauthorized' }); return; }
    if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) {
      respond(response, 415, { error: 'unsupported_media_type' }); return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    try {
      for await (const chunk of request) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buffer.length;
        if (size > MAX_BODY_BYTES) throw new Error('请求体过大');
        chunks.push(buffer);
      }
      const command = parseAppCommand(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown);
      const preflight = await permissions.beforeToolCall('cli', randomUUID(), command.name, command.input);
      if (preflight?.block) { respond(response, 403, { error: 'blocked', message: preflight.reason }); return; }
      respond(response, 200, { ok: true, result: commands.execute(command) });
    } catch (error) {
      respond(response, 400, { error: 'invalid_request', message: error instanceof Error ? error.message : '请求无效' });
    }
  };
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  const port = (server.address() as AddressInfo).port;
  return {
    config: () => ({
      url: `http://127.0.0.1:${port}/commands`, token: tokenVault.current(),
      cliCommand: `node "${path.resolve(cliScriptPath)}" --url http://127.0.0.1:${port}/commands`
    }),
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  };
}
