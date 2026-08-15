import { appendFileSync } from 'node:fs';
import path from 'node:path';

export function dbg(msg: string): void {
  if (process.env.ISLAND_DEBUG === '1') {
    try {
      appendFileSync(path.join(process.cwd(), '.verify', 'island.log'), '[' + new Date().toISOString() + '] ' + msg + String.fromCharCode(10));
    } catch {
      // 日志失败不影响运行
    }
  }
}
