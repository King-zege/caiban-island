// 采办岛 STDIO MCP 桥接：Qoder 以 STDIO 方式启动本脚本，
// 本脚本把 stdio JSON-RPC 转发到正在运行的采办岛 GUI 的 SSE 端点。
// 说明：Windows GUI 子系统程序没有可用 stdio 管道，因此用 Node 脚本做桥接（本机已装 Node）。
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const log = (m) => console.error('[caiban-stdio] ' + m);

function readConfig() {
  try {
    const dbPath = path.join(os.homedir(), 'AppData', 'Roaming', 'caiban-island', 'island.db');
    if (!existsSync(dbPath)) return null;
    const db = new DatabaseSync(dbPath, { readOnly: true });
    const get = (k) => {
      const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(k);
      return r ? r.value : null;
    };
    const token = get('mcp_token');
    const port = Number(get('mcp_port'));
    db.close();
    if (!token || !port) return null;
    return { url: 'http://127.0.0.1:' + port + '/sse?token=' + token };
  } catch (e) {
    log('readConfig error: ' + String(e));
    return null;
  }
}

// Client.connect() 会自动 start 传输；不可达时快速失败
async function tryConnectClient(url) {
  const transport = new SSEClientTransport(new URL(url));
  const client = new Client({ name: 'caiban-stdio-bridge', version: '0.1.0' });
  await client.connect(transport);
  return { client, transport };
}

const DEV_EXE = 'C:\\Users\\93774\\Desktop\\ds_workspace\\node_modules\\electron\\dist\\electron.exe';
const DEV_CWD = 'C:\\Users\\93774\\Desktop\\ds_workspace';

let cfg = readConfig();
let connected = cfg ? await tryConnectClient(cfg.url).catch(() => null) : null;
if (!connected) {
  log('GUI 未运行，正在启动采办岛…');
  const exe = process.env.CAIBAN_EXE ?? DEV_EXE;
  const cwd = process.env.CAIBAN_CWD ?? DEV_CWD;
  const child = spawn(exe, exe.includes('electron.exe') ? ['.'] : [], { cwd, detached: true, stdio: 'ignore' });
  child.unref();
  for (let i = 0; i < 60 && !connected; i++) {
    await new Promise((r) => setTimeout(r, 500));
    cfg = readConfig();
    if (cfg) connected = await tryConnectClient(cfg.url).catch(() => null);
  }
}
if (!cfg || !connected) {
  log('无法连接到采办岛，请先启动采办岛');
  process.exit(1);
}

const { client } = connected;
const server = new Server({ name: 'caiban-island-stdio', version: '0.1.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => client.listTools());
server.setRequestHandler(CallToolRequestSchema, async (req) =>
  client.callTool({ name: req.params.name, arguments: req.params.arguments })
);
const stdio = new StdioServerTransport();
await server.connect(stdio);
log('stdio 转发就绪');
