import { createHash, randomBytes } from 'node:crypto';

/** Sortable, human-readable run id: 20260927-130412-a1b2 */
export function newRunId(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${stamp}-${randomBytes(2).toString('hex')}`;
}

export function shortHash(input: string, length = 8): string {
  return createHash('sha1').update(input).digest('hex').slice(0, length);
}
