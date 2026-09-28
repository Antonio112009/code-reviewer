import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  computeFingerprint,
  FINGERPRINT_RE,
  fallbackFingerprint,
  fingerprintFindings,
  reviewRootReader,
  uniqueFingerprints,
} from '../src/review/fingerprint';
import type { Finding } from '../src/types';

function finding(over: Partial<Finding> = {}): Finding {
  return {
    id: 'f1',
    file: 'src/users.ts',
    startLine: 3,
    endLine: 4,
    severity: 'major',
    category: 'security',
    title: 'SQL built from request body',
    description: 'The name is concatenated into the query.',
    confidence: 0.9,
    skills: [],
    source: { chunkIds: ['c001'], provider: 'mock' },
    ...over,
  };
}

const BASE = [
  'import { db } from "./db";',
  'export function find(name: string) {',
  "  const sql = 'SELECT * FROM users WHERE name = ' + name;",
  '  return db.query(sql);',
  '}',
];

describe('finding fingerprints', () => {
  it('survive inserted lines above and re-indentation', () => {
    const before = computeFingerprint(finding(), BASE);
    const shifted = ['// a new header', '// more', ...BASE];
    const moved = computeFingerprint(finding({ startLine: 5, endLine: 6 }), shifted);
    expect(moved).toBe(before);
    const reindented = BASE.map((l) => l.replace(/^ {2}/, '\t\t'));
    expect(computeFingerprint(finding(), reindented)).toBe(before);
    expect(before).toMatch(FINGERPRINT_RE);
    // the wording of the model does not matter when the code is readable
    expect(computeFingerprint(finding({ title: 'Injection via name' }), BASE)).toBe(before);
  });

  it('change with the code, the file, the category or the static rule', () => {
    const before = computeFingerprint(finding(), BASE);
    const edited = BASE.map((l) => l.replace('name = ', 'email = '));
    expect(computeFingerprint(finding(), edited)).not.toBe(before);
    expect(computeFingerprint(finding({ file: 'src/other.ts' }), BASE)).not.toBe(before);
    expect(computeFingerprint(finding({ category: 'bug' }), BASE)).not.toBe(before);
    const staticHit = finding({ origin: 'static', tool: { analyzer: 'patterns', ruleId: 'sql-concat' } });
    expect(computeFingerprint(staticHit, BASE)).not.toBe(before);
    // a model finding that merely claims a hint keeps its identity
    expect(computeFingerprint(finding({ tool: { analyzer: 'patterns', ruleId: 'sql-concat' } }), BASE)).toBe(
      before,
    );
  });

  it('fall back to file + title when the code cannot be read', () => {
    const f = finding();
    expect(computeFingerprint(f, undefined)).toBe(fallbackFingerprint(f));
    expect(computeFingerprint(f, ['', '', '   ', '\t'])).toBe(fallbackFingerprint(f)); // blank lines only
    expect(fallbackFingerprint(finding({ title: 'Other' }))).not.toBe(fallbackFingerprint(f));
    expect(fallbackFingerprint(finding({ title: '  sql BUILT from request   body ' }))).toBe(
      fallbackFingerprint(f),
    );
  });

  it('are unique within a run, and malformed ones are replaced', () => {
    const a = finding({ id: 'a', severity: 'critical', fingerprint: 'a'.repeat(32) });
    const b = finding({ id: 'b', title: 'Another defect on the same code', fingerprint: 'a'.repeat(32) });
    const c = finding({ id: 'c', fingerprint: '<!-- x -->' });
    const out = uniqueFingerprints([b, a, c]);
    expect(out.find((f) => f.id === 'a')!.fingerprint).toBe('a'.repeat(32)); // the worst keeps the plain hash
    expect(out.find((f) => f.id === 'b')!.fingerprint).not.toBe('a'.repeat(32));
    expect(out.find((f) => f.id === 'c')!.fingerprint).toBe(fallbackFingerprint(c));
    expect(new Set(out.map((f) => f.fingerprint)).size).toBe(3);
    // the same input gives the same result in any order
    expect(
      uniqueFingerprints([a, c, b])
        .map((f) => f.fingerprint)
        .sort(),
    ).toEqual(out.map((f) => f.fingerprint).sort());
  });

  describe('reading the review root', () => {
    let root: string;
    let outside: string;
    beforeAll(() => {
      root = mkdtempSync(path.join(tmpdir(), 'cr-fp-'));
      outside = mkdtempSync(path.join(tmpdir(), 'cr-fp-out-'));
      mkdirSync(path.join(root, 'src'));
      writeFileSync(path.join(root, 'src/users.ts'), `${BASE.join('\n')}\n`);
      writeFileSync(path.join(outside, 'secret.ts'), `${BASE.join('\n')}\n`);
      symlinkSync(path.join(outside, 'secret.ts'), path.join(root, 'src/link.ts'));
    });
    afterAll(() => {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    });

    it('hashes the reported lines of files inside the root only', () => {
      const [inside, link, dotdot] = fingerprintFindings(
        [finding(), finding({ id: 'l', file: 'src/link.ts' }), finding({ id: 'e', file: '../x/secret.ts' })],
        reviewRootReader(root),
      );
      expect(inside!.fingerprint).toBe(computeFingerprint(finding(), BASE));
      // a symlink out of the root and a `..` path are never read: title fallback
      expect(link!.fingerprint).toBe(fallbackFingerprint(finding({ file: 'src/link.ts' })));
      expect(dotdot!.fingerprint).toBe(fallbackFingerprint(finding({ file: '../x/secret.ts' })));
    });
  });
});
