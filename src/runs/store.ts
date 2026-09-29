import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { RunRecord } from '../types';

export interface RunSummary {
  id: string;
  command: RunRecord['command'];
  status: RunRecord['status'];
  createdAt: string;
  target: string;
  findings: number;
  bySeverity: Record<string, number>;
  providers: string;
}

/**
 * Run ids and artifact names become path segments: one plain segment only (no separators, no `.`/`..`,
 * no control characters). Run directories can come from the reviewed checkout (a committed
 * `.code-reviewer/runs/…`), so this is checked wherever a path is built.
 */
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function isValidRunId(id: unknown): id is string {
  return typeof id === 'string' && SEGMENT.test(id);
}

function assertSegment(value: string, what: string): string {
  if (!isValidRunId(value)) throw new Error(`Invalid ${what} ${JSON.stringify(value)}`);
  return value;
}

/** Persists runs as `<dir>/<runId>/run.json` (+ per-chunk artifacts and exported reports). */
export class RunStore {
  constructor(readonly dir: string) {}

  runDir(id: string): string {
    return path.join(this.dir, assertSegment(id, 'run id'));
  }

  async save(run: RunRecord): Promise<string> {
    const dir = this.runDir(run.id);
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, 'run.json');
    const tmp = `${file}.tmp`;
    await writeFile(tmp, JSON.stringify(run, null, 2));
    await rename(tmp, file);
    return dir;
  }

  /** The run's log (`run.log`: every message, debug included, and the main events). */
  async saveLog(runId: string, text: string): Promise<void> {
    if (!text) return;
    await writeFile(path.join(this.runDir(runId), 'run.log'), text);
  }

  /** Raw per-chunk data (prompt, reply text, submission) for debugging. */
  async saveArtifact(runId: string, name: string, data: unknown): Promise<void> {
    const dir = path.join(this.runDir(runId), 'chunks');
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, `${assertSegment(name, 'artifact name')}.json`),
      JSON.stringify(data, null, 2),
    );
  }

  /** Run directories (real directories with a run.json and a valid id as name), newest first. */
  async ids(): Promise<string[]> {
    if (!existsSync(this.dir)) return [];
    const entries = await readdir(this.dir, { withFileTypes: true });
    return entries
      .filter(
        (e) => e.isDirectory() && isValidRunId(e.name) && existsSync(path.join(this.dir, e.name, 'run.json')),
      )
      .map((e) => e.name)
      .sort()
      .reverse();
  }

  /** Accepts a full id, a unique prefix, or `latest`. */
  async resolveId(idOrPrefix: string): Promise<string> {
    const ids = await this.ids();
    if (idOrPrefix === 'latest' || idOrPrefix === 'last') {
      if (!ids[0]) throw new Error(`No runs found in ${this.dir}`);
      return ids[0];
    }
    if (ids.includes(idOrPrefix)) return idOrPrefix;
    const matches = ids.filter((id) => id.startsWith(idOrPrefix) || id.endsWith(idOrPrefix));
    if (matches.length === 1) return matches[0]!;
    if (matches.length > 1)
      throw new Error(`Ambiguous run id "${idOrPrefix}": ${matches.slice(0, 5).join(', ')}`);
    throw new Error(`Run "${idOrPrefix}" not found in ${this.dir}`);
  }

  /**
   * Loads a run. Its `id` must equal its directory name: callers build paths from it (`runs export`
   * writes reports into `runDir(run.id)`), and a run.json planted in the checkout could name any path.
   */
  async load(idOrPrefix: string): Promise<RunRecord> {
    const id = await this.resolveId(idOrPrefix);
    const file = path.join(this.runDir(id), 'run.json');
    const run = JSON.parse(await readFile(file, 'utf8')) as RunRecord | null;
    if (!run || typeof run !== 'object' || run.id !== id) {
      throw new Error(`${file}: its "id" does not match the run directory name "${id}"`);
    }
    return run;
  }

  async list(limit = 50): Promise<RunSummary[]> {
    const out: RunSummary[] = [];
    for (const id of (await this.ids()).slice(0, limit)) {
      try {
        out.push(summarize(await this.load(id)));
      } catch {
        // unreadable run: skip
      }
    }
    return out;
  }

  /** The most recent runs, newest first; unreadable ones are skipped. */
  async recent(limit = 50): Promise<RunRecord[]> {
    const out: RunRecord[] = [];
    for (const id of (await this.ids()).slice(0, limit)) {
      try {
        out.push(await this.load(id));
      } catch {
        // unreadable run: skip
      }
    }
    return out;
  }

  async remove(idOrPrefix: string): Promise<string> {
    const id = await this.resolveId(idOrPrefix);
    await rm(this.runDir(id), { recursive: true, force: true });
    return id;
  }
}

export function describeTarget(run: RunRecord): string {
  return run.target.kind === 'diff'
    ? `${run.target.base}..${run.target.head}`
    : run.target.paths.join(' ') || '.';
}

export function summarize(run: RunRecord): RunSummary {
  const bySeverity: Record<string, number> = {};
  for (const f of run.findings) bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1;
  const providers = [
    ...new Set(
      Object.values(run.routing).map((r) => (r ? `${r.provider}${r.model ? `:${r.model}` : ''}` : '')),
    ),
  ]
    .filter(Boolean)
    .join(', ');
  return {
    id: run.id,
    command: run.command,
    status: run.status,
    createdAt: run.createdAt,
    target: describeTarget(run),
    findings: run.findings.length,
    bySeverity,
    providers,
  };
}
