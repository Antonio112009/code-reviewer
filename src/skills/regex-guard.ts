import { Worker } from 'node:worker_threads';

/**
 * Regexes of project skills come from the reviewed repository and run on every chunk. A static check
 * (nested quantifiers) misses overlapping alternations and chained quantifiers, and a backtracking regex
 * blocks the event loop — Ctrl+C included. So each pattern is also run against adversarial inputs in a
 * worker thread with a hard time limit; a pattern that times out (or throws) is refused.
 */

const PER_PATTERN_MS = 100;

/** Inputs that make common backtracking shapes blow up (runs, near-misses, nesting, long lines). */
const ADVERSARIAL_SOURCE = `[
  'a'.repeat(3000) + '!',
  ' '.repeat(3000) + 'x',
  '0'.repeat(3000) + 'x',
  'ab'.repeat(1500) + '!',
  'a '.repeat(1500) + '!',
  'a.'.repeat(1500) + '!',
  '('.repeat(1500) + ')'.repeat(1499),
  '<a '.repeat(1000),
  '"'.repeat(1500) + 'x',
  'aA0_-'.repeat(600) + '\\n',
  '\\t\\t\\n'.repeat(1000) + 'x',
]`;

const WORKER_CODE = `
const { parentPort, workerData } = require('node:worker_threads');
const inputs = ${ADVERSARIAL_SOURCE};
for (const source of workerData.patterns) {
  try {
    const re = new RegExp(source, 'm');
    for (const input of inputs) re.test(input);
    parentPort.postMessage({ source, ok: true });
  } catch (err) {
    parentPort.postMessage({ source, ok: false, reason: 'invalid regex' });
  }
}
`;

/**
 * Patterns among `patterns` that are unsafe to run on untrusted text (with the reason). Each pattern gets
 * `PER_PATTERN_MS` in a worker; a worker stuck on a pattern is terminated and the rest are retried.
 */
export async function unsafeRegexes(patterns: readonly string[]): Promise<Map<string, string>> {
  const unsafe = new Map<string, string>();
  let pending = [...new Set(patterns)];
  while (pending.length) {
    const done = new Set<string>();
    await new Promise<void>((resolve) => {
      const worker = new Worker(WORKER_CODE, { eval: true, workerData: { patterns: pending } });
      let timer: NodeJS.Timeout | undefined;
      let first = true;
      const arm = () => {
        clearTimeout(timer);
        // the first pattern's budget also covers the worker start-up
        const budget = first ? PER_PATTERN_MS + 1_000 : PER_PATTERN_MS;
        first = false;
        timer = setTimeout(() => {
          // stuck on the next unfinished pattern
          const stuck = pending.find((p) => !done.has(p));
          if (stuck !== undefined) {
            unsafe.set(stuck, `backtracks for more than ${PER_PATTERN_MS} ms on adversarial input (ReDoS)`);
            done.add(stuck);
          }
          void worker.terminate().then(() => resolve());
        }, budget);
      };
      arm();
      worker.on('message', (m: { source: string; ok: boolean; reason?: string }) => {
        done.add(m.source);
        if (!m.ok) unsafe.set(m.source, m.reason ?? 'invalid');
        arm();
      });
      worker.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
      worker.once('error', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    const next = pending.filter((p) => !done.has(p));
    if (next.length === pending.length) {
      // the worker could not run at all: refuse the rest rather than risk it
      for (const p of next) unsafe.set(p, 'could not be vetted');
      break;
    }
    pending = next;
  }
  return unsafe;
}

/** Most text an untrusted regex runs on, and the longest line it sees (longer lines are skipped). */
const MAX_UNTRUSTED_TEXT = 200_000;
const MAX_UNTRUSTED_LINE = 1_000;

/** `text` bounded for untrusted regexes: long lines dropped, total length capped. */
export function boundForUntrusted(text: string): string {
  if (text.length <= MAX_UNTRUSTED_LINE && !text.includes('\n')) return text;
  const out: string[] = [];
  let size = 0;
  for (const line of text.split('\n')) {
    if (line.length > MAX_UNTRUSTED_LINE) continue;
    size += line.length + 1;
    if (size > MAX_UNTRUSTED_TEXT) break;
    out.push(line);
  }
  return out.join('\n');
}
