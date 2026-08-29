import { access, lstat, mkdir, readFile, realpath, rename, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AgentPermissionService } from './agentPermissionService';

const MAX_TEXT_BYTES = 256 * 1024;

export class AuthorizedFileError extends Error {}

function inside(root: string, candidate: string): boolean {
  const normalizedRoot = path.resolve(root).toLowerCase();
  const normalizedCandidate = path.resolve(candidate).toLowerCase();
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(normalizedRoot + path.sep);
}

function validateRelative(input: string): string {
  if (!input.trim() || path.isAbsolute(input) || input.startsWith('\\\\') || input.includes('\0')) {
    throw new AuthorizedFileError('文件路径必须是授权目录内的相对路径');
  }
  const normalized = path.normalize(input);
  if (normalized === '..' || normalized.startsWith('..' + path.sep)) throw new AuthorizedFileError('文件路径越过了授权目录');
  return normalized;
}

export class AuthorizedFileService {
  constructor(private readonly permissions: AgentPermissionService) {}

  async list(directoryId: string, relativePath = '.', signal?: AbortSignal): Promise<Array<{ name: string; kind: 'file' | 'directory'; size: number }>> {
    const target = await this.resolveTarget(directoryId, relativePath, true);
    const entries = await readdir(target, { withFileTypes: true });
    if (signal?.aborted) throw new AuthorizedFileError('操作已取消');
    return Promise.all(entries.slice(0, 500).map(async (entry) => {
      const stats = await lstat(path.join(target, entry.name));
      return { name: entry.name, kind: entry.isDirectory() ? 'directory' as const : 'file' as const, size: entry.isFile() ? stats.size : 0 };
    }));
  }

  async read(directoryId: string, relativePath: string, signal?: AbortSignal): Promise<string> {
    const target = await this.resolveTarget(directoryId, relativePath, true);
    const stats = await lstat(target);
    if (!stats.isFile()) throw new AuthorizedFileError('只能读取文件');
    if (stats.size > MAX_TEXT_BYTES) throw new AuthorizedFileError('文件超过 256KB 读取上限');
    return readFile(target, { encoding: 'utf8', signal });
  }

  async write(directoryId: string, relativePath: string, content: string, signal?: AbortSignal): Promise<void> {
    if (Buffer.byteLength(content, 'utf8') > MAX_TEXT_BYTES) throw new AuthorizedFileError('文件超过 256KB 写入上限');
    const target = await this.resolveTarget(directoryId, relativePath, false);
    await mkdir(path.dirname(target), { recursive: true });
    await this.assertCanonicalParent(directoryId, target);
    await writeFile(target, content, { encoding: 'utf8', signal });
  }

  async move(directoryId: string, from: string, to: string): Promise<void> {
    const source = await this.resolveTarget(directoryId, from, true);
    const target = await this.resolveTarget(directoryId, to, false);
    await mkdir(path.dirname(target), { recursive: true });
    await this.assertCanonicalParent(directoryId, target);
    try { await access(target); throw new AuthorizedFileError('目标已存在'); } catch (error) {
      if (error instanceof AuthorizedFileError) throw error;
    }
    await rename(source, target);
  }

  async delete(directoryId: string, relativePath: string): Promise<void> {
    const target = await this.resolveTarget(directoryId, relativePath, true);
    const stats = await lstat(target);
    if (!stats.isFile()) throw new AuthorizedFileError('只允许删除文件，目录需先清空并由用户处理');
    await rm(target);
  }

  private root(directoryId: string): string {
    const directory = this.permissions.snapshot().authorizedDirectories.find((entry) => entry.id === directoryId);
    if (!directory) throw new AuthorizedFileError('目录未授权或授权已撤销');
    return directory.path;
  }

  private async resolveTarget(directoryId: string, relativePath: string, mustExist: boolean): Promise<string> {
    const root = await realpath(this.root(directoryId));
    const candidate = path.resolve(root, validateRelative(relativePath));
    if (!inside(root, candidate)) throw new AuthorizedFileError('文件路径越过了授权目录');
    if (mustExist) {
      const canonical = await realpath(candidate);
      if (!inside(root, canonical)) throw new AuthorizedFileError('符号链接或目录联接越过了授权目录');
      return canonical;
    }
    await this.assertCanonicalParent(directoryId, candidate);
    return candidate;
  }

  private async assertCanonicalParent(directoryId: string, candidate: string): Promise<void> {
    const root = await realpath(this.root(directoryId));
    let parent = path.dirname(candidate);
    while (inside(root, parent)) {
      try {
        const canonical = await realpath(parent);
        if (!inside(root, canonical)) throw new AuthorizedFileError('符号链接或目录联接越过了授权目录');
        return;
      } catch (error) {
        if (error instanceof AuthorizedFileError) throw error;
        if (parent === root) break;
        parent = path.dirname(parent);
      }
    }
    throw new AuthorizedFileError('目标不在授权目录内');
  }
}
