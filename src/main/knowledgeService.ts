import { createHash, randomUUID } from 'node:crypto';
import { watch, type FSWatcher } from 'node:fs';
import { mkdir, open, readFile, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import JSZip from 'jszip';
import type {
  KnowledgeExtractState,
  KnowledgeLocatorKind,
  KnowledgeMatch,
  KnowledgeScanSummary,
  KnowledgeSource,
  KnowledgeSourceExcerpt,
  KnowledgeWorkspaceStatus,
  WorkspaceProjectBindingRequest,
  WorkspaceTreeEntry
} from '../shared/knowledgeContracts';
import type { AgentPermissionService } from './agentPermissionService';

const AGENT_DIRECTORY = '采办岛 Agent';
const MAX_FILES = 10_000;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_CHUNK_CHARS = 1_000;
const CHUNK_OVERLAP = 100;
const INDEXED_EXTENSIONS = new Set(['.pdf', '.docx', '.xlsx', '.pptx', '.md', '.txt', '.csv']);
const METADATA_EXTENSIONS = new Set(['.doc', '.xls', '.ppt', '.zip', '.rar', '.7z', '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.tif', '.tiff']);

interface SourceRow {
  id: string; directory_id: string; relative_path: string; file_name: string; extension: string;
  size: number; modified_at_utc: string; fingerprint: string; extract_state: KnowledgeExtractState;
  skip_reason: string | null; project_candidate: string | null; updated_at: string; chunk_count?: number;
}

interface ScanRow {
  id: string; directory_id: string; status: KnowledgeScanSummary['status']; total_files: number;
  indexed_files: number; metadata_only_files: number; skipped_files: number; failed_files: number;
  removed_files: number; started_at: string; completed_at: string | null; error_category: string | null;
}

interface ExtractedPart { locator: string; locatorKind: KnowledgeLocatorKind; text: string }
interface KnowledgeChunk extends ExtractedPart { text: string }

export class KnowledgeServiceError extends Error {}

function sourceFromRow(row: SourceRow): KnowledgeSource {
  return {
    id: row.id, directoryId: row.directory_id, relativePath: row.relative_path,
    fileName: row.file_name, extension: row.extension, size: row.size,
    modifiedAtUtc: row.modified_at_utc, fingerprint: row.fingerprint,
    extractState: row.extract_state, skipReason: row.skip_reason,
    projectCandidate: row.project_candidate, chunkCount: row.chunk_count ?? 0,
    updatedAtUtc: row.updated_at
  };
}

function scanFromRow(row: ScanRow): KnowledgeScanSummary {
  return {
    id: row.id, directoryId: row.directory_id, status: row.status,
    totalFiles: row.total_files, indexedFiles: row.indexed_files,
    metadataOnlyFiles: row.metadata_only_files, skippedFiles: row.skipped_files,
    failedFiles: row.failed_files, removedFiles: row.removed_files,
    startedAtUtc: row.started_at, completedAtUtc: row.completed_at,
    errorCategory: row.error_category
  };
}

function normalizeRelative(relativePath: string): string {
  const normalized = path.normalize(relativePath).replaceAll('\\', '/');
  if (!normalized || normalized === '.' || path.isAbsolute(normalized) || normalized === '..' || normalized.startsWith('../') || normalized.includes('\0')) {
    throw new KnowledgeServiceError('知识来源必须使用工作目录内的相对路径');
  }
  return normalized;
}

function inside(root: string, candidate: string): boolean {
  const base = path.resolve(root).toLowerCase();
  const target = path.resolve(candidate).toLowerCase();
  return target === base || target.startsWith(base + path.sep);
}

function decodeXml(text: string): string {
  return text.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function compactText(text: string): string {
  return text.replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

function chunksFor(parts: ExtractedPart[]): KnowledgeChunk[] {
  const chunks: KnowledgeChunk[] = [];
  for (const part of parts) {
    const text = compactText(part.text);
    if (!text) continue;
    for (let offset = 0; offset < text.length;) {
      const end = Math.min(offset + MAX_CHUNK_CHARS, text.length);
      chunks.push({ ...part, text: text.slice(offset, end) });
      if (end === text.length) break;
      offset = Math.max(offset + 1, end - CHUNK_OVERLAP);
    }
  }
  return chunks;
}

function safetyScan(input: string): { text: string; flags: KnowledgeMatch['safetyFlags'] } {
  const flags = new Set<KnowledgeMatch['safetyFlags'][number]>();
  let text = input;
  const injection = /(ignore\s+(all\s+)?previous|system\s+prompt|developer\s+message|忽略(?:以上|之前|前面)|系统提示词|请执行以下指令)/i;
  if (injection.test(text)) flags.add('prompt_injection');
  const credential = /\b(?:Bearer\s+[A-Za-z0-9._~+/=-]{12,}|sk-[A-Za-z0-9_-]{12,}|(?:api[_ -]?key|token|password)\s*[:=]\s*[^\s,;]{8,})/gi;
  if (credential.test(text)) {
    flags.add('credential');
    text = text.replace(credential, '[敏感凭据已隐藏]');
  }
  const sensitivePath = /(?:[A-Za-z]:\\(?:[^\s<>:"|?*]+\\)*[^\s<>:"|?*]*|\\\\[^\s\\]+\\[^\s]+)/g;
  if (sensitivePath.test(text)) {
    flags.add('sensitive_path');
    text = text.replace(sensitivePath, '[本地路径已隐藏]');
  }
  return { text, flags: [...flags] };
}

function ftsQuery(input: string): string | null {
  const tokens = input.trim().split(/\s+/).map((token) => token.replace(/["*:^(){}\[\]]/g, '')).filter(Boolean).slice(0, 8);
  return tokens.length ? tokens.map((token) => `"${token}"`).join(' AND ') : null;
}

async function extractDocx(buffer: Buffer): Promise<ExtractedPart[]> {
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file('word/document.xml')?.async('string');
  if (!xml) return [];
  return [...xml.matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g)].map((match, index) => ({
    locator: `段落 ${index + 1}`, locatorKind: 'paragraph' as const,
    text: decodeXml([...match[1].matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)].map((item) => item[1]).join(''))
  })).filter((part) => part.text.trim());
}

async function extractPptx(buffer: Buffer): Promise<ExtractedPart[]> {
  const zip = await JSZip.loadAsync(buffer);
  const names = Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((a, b) => Number(a.match(/\d+/)?.[0]) - Number(b.match(/\d+/)?.[0]));
  const parts: ExtractedPart[] = [];
  for (let index = 0; index < names.length; index += 1) {
    const xml = await zip.file(names[index])?.async('string') ?? '';
    parts.push({ locator: `幻灯片 ${index + 1}`, locatorKind: 'slide', text: decodeXml([...xml.matchAll(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g)].map((item) => item[1]).join('\n')) });
  }
  return parts.filter((part) => part.text.trim());
}

async function extractXlsx(buffer: Buffer): Promise<ExtractedPart[]> {
  const zip = await JSZip.loadAsync(buffer);
  const sharedXml = await zip.file('xl/sharedStrings.xml')?.async('string') ?? '';
  const shared = [...sharedXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((item) => decodeXml([...item[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((value) => value[1]).join('')));
  const names = Object.keys(zip.files).filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name))
    .sort((a, b) => Number(a.match(/\d+/)?.[0]) - Number(b.match(/\d+/)?.[0]));
  const parts: ExtractedPart[] = [];
  for (let index = 0; index < names.length; index += 1) {
    const xml = await zip.file(names[index])?.async('string') ?? '';
    const values = [...xml.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)].map((cell) => {
      const value = cell[2].match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1] ?? cell[2].match(/<t\b[^>]*>([\s\S]*?)<\/t>/)?.[1] ?? '';
      return /\bt=["']s["']/.test(cell[1]) ? (shared[Number(value)] ?? '') : decodeXml(value);
    }).filter(Boolean);
    parts.push({ locator: `工作表 ${index + 1}`, locatorKind: 'sheet', text: values.join('\n') });
  }
  return parts.filter((part) => part.text.trim());
}

async function extractPdf(buffer: Buffer, signal?: AbortSignal): Promise<ExtractedPart[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: new Uint8Array(buffer), useWorkerFetch: false, useSystemFonts: true });
  const abort = () => task.destroy();
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const document = await task.promise;
    const parts: ExtractedPart[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      if (signal?.aborted) throw new KnowledgeServiceError('扫描已取消');
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items.map((item) => 'str' in item ? item.str : '').join(' ');
      parts.push({ locator: `第 ${pageNumber} 页`, locatorKind: 'page', text });
    }
    return parts.filter((part) => part.text.trim());
  } finally {
    signal?.removeEventListener('abort', abort);
    await task.destroy().catch(() => undefined);
  }
}

async function extractFile(filePath: string, extension: string, signal?: AbortSignal): Promise<KnowledgeChunk[]> {
  const buffer = await readFile(filePath, { signal });
  let parts: ExtractedPart[];
  if (extension === '.docx') parts = await extractDocx(buffer);
  else if (extension === '.pptx') parts = await extractPptx(buffer);
  else if (extension === '.xlsx') parts = await extractXlsx(buffer);
  else if (extension === '.pdf') parts = await extractPdf(buffer, signal);
  else {
    const lines = buffer.toString('utf8').replace(/^\uFEFF/, '').split(/\r?\n/);
    parts = lines.map((text, index) => ({ locator: `第 ${index + 1} 行`, locatorKind: 'line' as const, text }));
  }
  return chunksFor(parts);
}

export class KnowledgeService {
  private watcher: FSWatcher | null = null;
  private watchTimer: NodeJS.Timeout | null = null;
  private activeScan: { controller: AbortController; promise: Promise<KnowledgeScanSummary> } | null = null;

  constructor(private readonly db: DatabaseSync, private readonly permissions: AgentPermissionService) {}

  status(): KnowledgeWorkspaceStatus {
    const primary = this.permissions.snapshot().authorizedDirectories.find((entry) => entry.isPrimaryWorkspace);
    const last = primary ? this.db.prepare('SELECT * FROM knowledge_scans WHERE directory_id=? ORDER BY started_at DESC LIMIT 1').get(primary.id) as unknown as ScanRow | undefined : undefined;
    const counts = primary ? this.db.prepare(`SELECT COUNT(*) AS total,
      SUM(CASE WHEN extract_state='indexed' THEN 1 ELSE 0 END) AS indexed,
      SUM(CASE WHEN extract_state='failed' THEN 1 ELSE 0 END) AS failed
      FROM knowledge_sources WHERE directory_id=?`).get(primary.id) as unknown as { total: number; indexed: number | null; failed: number | null } : null;
    return {
      primaryDirectoryId: primary?.id ?? null, primaryDirectoryLabel: primary?.label ?? null,
      hasPrimaryDirectory: Boolean(primary), lastScan: last ? scanFromRow(last) : null,
      sourceCount: counts?.total ?? 0, indexedSourceCount: counts?.indexed ?? 0, failedSourceCount: counts?.failed ?? 0
    };
  }

  async initialize(): Promise<void> {
    if (!this.primary()) return;
    await this.ensureAgentDirectory();
    await this.refreshWorkspaceIndex().catch(() => undefined);
    this.startWatching();
  }

  async setPrimaryDirectory(directoryId: string): Promise<KnowledgeWorkspaceStatus> {
    this.stopWatching();
    this.permissions.setPrimaryDirectory(directoryId);
    await this.ensureAgentDirectory();
    await this.refreshWorkspaceIndex();
    this.startWatching();
    return this.status();
  }

  async ensureAgentDirectory(): Promise<void> {
    const { root } = await this.primaryRoot();
    const agentRoot = path.join(root, AGENT_DIRECTORY);
    for (const child of ['', '今日清单', '项目摘要', '复用模板', '生成物']) await mkdir(path.join(agentRoot, child), { recursive: true });
    try {
      const handle = await open(path.join(agentRoot, '工作区地图.md'), 'wx');
      await handle.writeFile('# 采办岛工作区地图\n\n此目录由采办岛维护，知识索引保存在应用本地数据库中。\n', 'utf8');
      await handle.close();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }

  async refreshWorkspaceIndex(signal?: AbortSignal): Promise<KnowledgeScanSummary> {
    if (this.activeScan) return this.activeScan.promise;
    const controller = new AbortController();
    const forwardAbort = () => controller.abort();
    if (signal?.aborted) controller.abort();
    else signal?.addEventListener('abort', forwardAbort, { once: true });
    const promise = this.scan(controller.signal).finally(() => {
      signal?.removeEventListener('abort', forwardAbort);
      this.activeScan = null;
    });
    this.activeScan = { controller, promise };
    return promise;
  }

  cancelScan(): boolean {
    if (!this.activeScan) return false;
    this.activeScan.controller.abort();
    return true;
  }

  async getWorkspaceTree(maxDepth = 2): Promise<WorkspaceTreeEntry[]> {
    const { root } = await this.primaryRoot();
    let remaining = 500;
    const walk = async (absolute: string, relative: string, depth: number): Promise<WorkspaceTreeEntry[]> => {
      const entries = await readdir(absolute, { withFileTypes: true });
      const result: WorkspaceTreeEntry[] = [];
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))) {
        if (remaining-- <= 0) break;
        if (entry.name === AGENT_DIRECTORY || entry.isSymbolicLink()) continue;
        const rel = normalizeRelative(relative ? path.join(relative, entry.name) : entry.name);
        const absoluteChild = path.join(absolute, entry.name);
        if (entry.isDirectory()) {
          result.push({ relativePath: rel, name: entry.name, kind: 'directory', size: 0, indexedState: null,
            children: depth < Math.min(4, Math.max(0, maxDepth)) ? await walk(absoluteChild, rel, depth + 1) : undefined });
        } else if (entry.isFile()) {
          const info = await stat(absoluteChild);
          const row = this.db.prepare('SELECT extract_state FROM knowledge_sources WHERE directory_id=? AND relative_path=?').get(this.primary().id, rel) as unknown as { extract_state: KnowledgeExtractState } | undefined;
          result.push({ relativePath: rel, name: entry.name, kind: 'file', size: info.size, indexedState: row?.extract_state ?? null });
        }
      }
      return result;
    };
    return walk(root, '', 0);
  }

  searchWorkspace(query: string, limit = 8): KnowledgeMatch[] {
    const primary = this.primary();
    const capped = Math.min(8, Math.max(1, Math.trunc(limit)));
    const fts = ftsQuery(query);
    if (!fts) return [];
    type MatchRow = { source_id: string; relative_path: string; file_name: string; locator: string; locator_kind: KnowledgeLocatorKind; text: string; score: number };
    let rows: MatchRow[] = [];
    try {
      rows = this.db.prepare(`SELECT c.source_id, s.relative_path, s.file_name, c.locator, c.locator_kind, c.text,
        bm25(knowledge_chunks_fts) AS score FROM knowledge_chunks_fts
        JOIN knowledge_chunks c ON c.rowid=knowledge_chunks_fts.rowid
        JOIN knowledge_sources s ON s.id=c.source_id
        WHERE knowledge_chunks_fts MATCH ? AND s.directory_id=? ORDER BY score LIMIT ?`).all(fts, primary.id, capped) as unknown as MatchRow[];
    } catch {
      rows = [];
    }
    if (!rows.length) {
      const like = `%${query.trim().replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
      rows = this.db.prepare(`SELECT c.source_id, s.relative_path, s.file_name, c.locator, c.locator_kind, c.text, 0 AS score
        FROM knowledge_chunks c JOIN knowledge_sources s ON s.id=c.source_id
        WHERE s.directory_id=? AND c.text LIKE ? ESCAPE '\\' ORDER BY s.relative_path, c.ordinal LIMIT ?`).all(primary.id, like, capped) as unknown as MatchRow[];
    }
    return rows.map((row) => {
      const safe = safetyScan(row.text.slice(0, 1_200));
      return { sourceId: row.source_id, relativePath: row.relative_path, fileName: row.file_name,
        locator: row.locator, locatorKind: row.locator_kind, excerpt: safe.text, score: row.score, safetyFlags: safe.flags };
    });
  }

  getSourceExcerpt(sourceId: string, locator?: string): KnowledgeSourceExcerpt {
    const primary = this.primary();
    const sourceRow = this.db.prepare(`SELECT s.*, COUNT(c.id) AS chunk_count FROM knowledge_sources s
      LEFT JOIN knowledge_chunks c ON c.source_id=s.id WHERE s.id=? AND s.directory_id=? GROUP BY s.id`).get(sourceId, primary.id) as unknown as SourceRow | undefined;
    if (!sourceRow) throw new KnowledgeServiceError('知识来源不存在或不属于当前工作目录');
    const rows = locator
      ? this.db.prepare('SELECT locator, text FROM knowledge_chunks WHERE source_id=? AND locator=? ORDER BY ordinal LIMIT 3').all(sourceId, locator) as unknown as Array<{ locator: string; text: string }>
      : this.db.prepare('SELECT locator, text FROM knowledge_chunks WHERE source_id=? ORDER BY ordinal LIMIT 3').all(sourceId) as unknown as Array<{ locator: string; text: string }>;
    const safe = safetyScan(rows.map((row) => row.text).join('\n').slice(0, 3_000));
    return { source: sourceFromRow(sourceRow), locator: rows[0]?.locator ?? locator ?? '文件', text: safe.text, safetyFlags: safe.flags };
  }

  bindProject(request: WorkspaceProjectBindingRequest): { id: string; taskId: string; relativeRoot: string } {
    const primary = this.primary();
    if (request.directoryId !== primary.id) throw new KnowledgeServiceError('只能绑定当前主工作目录');
    const relativeRoot = normalizeRelative(request.relativeRoot);
    const task = this.db.prepare("SELECT id FROM tasks WHERE id=? AND kind='procurement'").get(request.taskId);
    if (!task) throw new KnowledgeServiceError('采购项目不存在');
    const candidateCount = this.db.prepare('SELECT COUNT(*) AS count FROM knowledge_sources WHERE directory_id=? AND (relative_path=? OR relative_path LIKE ?)').get(primary.id, relativeRoot, `${relativeRoot}/%`) as unknown as { count: number };
    if (candidateCount.count === 0) throw new KnowledgeServiceError('工作目录中不存在该项目路径');
    const id = randomUUID();
    this.db.prepare(`INSERT INTO workspace_project_bindings(id,directory_id,relative_root,task_id,created_at) VALUES(?,?,?,?,?)
      ON CONFLICT(directory_id,relative_root) DO UPDATE SET task_id=excluded.task_id, created_at=excluded.created_at`).run(id, primary.id, relativeRoot, request.taskId, new Date().toISOString());
    const row = this.db.prepare('SELECT id FROM workspace_project_bindings WHERE directory_id=? AND relative_root=?').get(primary.id, relativeRoot) as unknown as { id: string };
    return { id: row.id, taskId: request.taskId, relativeRoot };
  }

  startWatching(): void {
    this.stopWatching();
    const primary = this.permissions.snapshot().authorizedDirectories.find((entry) => entry.isPrimaryWorkspace);
    if (!primary) return;
    try {
      this.watcher = watch(primary.path, { recursive: true }, (_event, name) => {
        if (!name || name.toString().split(/[\\/]/).includes(AGENT_DIRECTORY)) return;
        if (this.watchTimer) clearTimeout(this.watchTimer);
        this.watchTimer = setTimeout(() => { this.watchTimer = null; void this.refreshWorkspaceIndex().catch(() => undefined); }, 1_500);
      });
    } catch { this.watcher = null; }
  }

  stopWatching(): void {
    if (this.watchTimer) clearTimeout(this.watchTimer);
    this.watchTimer = null;
    this.watcher?.close();
    this.watcher = null;
  }

  dispose(): void { this.cancelScan(); this.stopWatching(); }

  private primary() {
    const directory = this.permissions.snapshot().authorizedDirectories.find((entry) => entry.isPrimaryWorkspace);
    if (!directory) throw new KnowledgeServiceError('尚未设置主工作目录');
    return directory;
  }

  private async primaryRoot(): Promise<{ id: string; root: string }> {
    const primary = this.primary();
    const root = await realpath(primary.path);
    if (!path.isAbsolute(root) || root.startsWith('\\\\') || root.startsWith('\\\\?\\') || root.startsWith('\\\\.\\')) throw new KnowledgeServiceError('主工作目录必须是本地绝对路径');
    return { id: primary.id, root };
  }

  private async scan(signal: AbortSignal): Promise<KnowledgeScanSummary> {
    const { id: directoryId, root } = await this.primaryRoot();
    const scanId = randomUUID();
    const startedAt = new Date().toISOString();
    this.db.prepare(`INSERT INTO knowledge_scans(id,directory_id,status,started_at) VALUES(?,?,'running',?)`).run(scanId, directoryId, startedAt);
    const counts = { total: 0, indexed: 0, metadata: 0, skipped: 0, failed: 0, removed: 0 };
    const seen = new Set<string>();
    try {
      const files = await this.collectFiles(root, signal);
      counts.total = files.length;
      for (let index = 0; index < files.length; index += 4) {
        if (signal.aborted) throw new KnowledgeServiceError('扫描已取消');
        await Promise.all(files.slice(index, index + 4).map(async ({ absolute, relative }) => {
          const outcome = await this.indexFile(directoryId, root, absolute, relative, signal);
          seen.add(relative.toLowerCase());
          if (outcome === 'indexed') counts.indexed += 1;
          else if (outcome === 'metadata_only') counts.metadata += 1;
          else if (outcome === 'skipped') counts.skipped += 1;
          else counts.failed += 1;
        }));
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      const existing = this.db.prepare('SELECT id, relative_path FROM knowledge_sources WHERE directory_id=?').all(directoryId) as unknown as Array<{ id: string; relative_path: string }>;
      const stale = existing.filter((row) => !seen.has(row.relative_path.toLowerCase()));
      const remove = this.db.prepare('DELETE FROM knowledge_sources WHERE id=?');
      for (const row of stale) remove.run(row.id);
      counts.removed = stale.length;
      this.finishScan(scanId, 'completed', counts, null);
    } catch (error) {
      const cancelled = signal.aborted || (error instanceof KnowledgeServiceError && error.message === '扫描已取消');
      this.finishScan(scanId, cancelled ? 'cancelled' : 'failed', counts, cancelled ? null : 'scan_failed');
      if (!cancelled) throw error;
    }
    const row = this.db.prepare('SELECT * FROM knowledge_scans WHERE id=?').get(scanId) as unknown as ScanRow;
    return scanFromRow(row);
  }

  private finishScan(id: string, status: KnowledgeScanSummary['status'], counts: { total: number; indexed: number; metadata: number; skipped: number; failed: number; removed: number }, error: string | null): void {
    this.db.prepare(`UPDATE knowledge_scans SET status=?,total_files=?,indexed_files=?,metadata_only_files=?,skipped_files=?,failed_files=?,removed_files=?,completed_at=?,error_category=? WHERE id=?`)
      .run(status, counts.total, counts.indexed, counts.metadata, counts.skipped, counts.failed, counts.removed, new Date().toISOString(), error, id);
  }

  private async collectFiles(root: string, signal: AbortSignal): Promise<Array<{ absolute: string; relative: string }>> {
    const files: Array<{ absolute: string; relative: string }> = [];
    const visit = async (directory: string): Promise<void> => {
      if (signal.aborted) throw new KnowledgeServiceError('扫描已取消');
      const entries = await readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        if (files.length >= MAX_FILES) return;
        if (entry.name === AGENT_DIRECTORY || entry.isSymbolicLink()) continue;
        const absolute = path.join(directory, entry.name);
        const canonical = await realpath(absolute).catch(() => null);
        if (!canonical || !inside(root, canonical)) continue;
        if (entry.isDirectory()) await visit(canonical);
        else if (entry.isFile()) files.push({ absolute: canonical, relative: normalizeRelative(path.relative(root, canonical)) });
      }
    };
    await visit(root);
    return files.sort((a, b) => a.relative.localeCompare(b.relative, 'zh-CN'));
  }

  private async indexFile(directoryId: string, root: string, absolute: string, relative: string, signal: AbortSignal): Promise<KnowledgeExtractState> {
    const info = await stat(absolute);
    const extension = path.extname(relative).toLowerCase();
    let state: KnowledgeExtractState = 'skipped';
    let reason: string | null = '不支持的文件类型';
    if (info.size > MAX_FILE_BYTES) reason = '文件超过 20MB 索引上限';
    else if (INDEXED_EXTENSIONS.has(extension)) { state = 'indexed'; reason = null; }
    else if (METADATA_EXTENSIONS.has(extension)) { state = 'metadata_only'; reason = '正文不可提取'; }
    const existing = this.db.prepare('SELECT * FROM knowledge_sources WHERE directory_id=? AND relative_path=?').get(directoryId, relative) as unknown as SourceRow | undefined;
    const modified = info.mtime.toISOString();
    if (existing && existing.size === info.size && existing.modified_at_utc === modified && existing.extract_state !== 'failed') return existing.extract_state;
    let chunks: KnowledgeChunk[] = [];
    let fingerprint = createHash('sha256').update(`${relative}\0${info.size}\0${modified}`).digest('hex');
    if (state === 'indexed') {
      try {
        const content = await readFile(absolute, { signal });
        fingerprint = createHash('sha256').update(content).digest('hex');
        chunks = await extractFile(absolute, extension, signal);
        if (!chunks.length) { state = 'metadata_only'; reason = extension === '.pdf' ? 'PDF 无可提取文本，第一版不提供 OCR' : '正文为空或不可提取'; }
      } catch (error) {
        if (signal.aborted) throw new KnowledgeServiceError('扫描已取消');
        state = 'failed'; reason = error instanceof Error ? error.name : 'extract_failed';
      }
    }
    const sourceId = existing?.id ?? randomUUID();
    const projectCandidate = relative.includes('/') ? relative.split('/')[0] : null;
    this.db.exec('BEGIN');
    try {
      this.db.prepare(`INSERT INTO knowledge_sources(id,directory_id,relative_path,file_name,extension,size,modified_at_utc,fingerprint,extract_state,skip_reason,project_candidate,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(directory_id,relative_path) DO UPDATE SET file_name=excluded.file_name,extension=excluded.extension,size=excluded.size,
        modified_at_utc=excluded.modified_at_utc,fingerprint=excluded.fingerprint,extract_state=excluded.extract_state,skip_reason=excluded.skip_reason,project_candidate=excluded.project_candidate,updated_at=excluded.updated_at`)
        .run(sourceId, directoryId, relative, path.basename(relative), extension, info.size, modified, fingerprint, state, reason, projectCandidate, new Date().toISOString());
      this.db.prepare('DELETE FROM knowledge_chunks WHERE source_id=?').run(sourceId);
      const insert = this.db.prepare('INSERT INTO knowledge_chunks(id,source_id,ordinal,locator,locator_kind,text,content_hash) VALUES(?,?,?,?,?,?,?)');
      chunks.forEach((chunk, ordinal) => insert.run(randomUUID(), sourceId, ordinal, chunk.locator, chunk.locatorKind, chunk.text, createHash('sha256').update(chunk.text).digest('hex')));
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    void root;
    return state;
  }
}
