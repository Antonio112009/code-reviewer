import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { RequestPermissionRequest } from '@agentclientprotocol/sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decidePermission, isOwnTool } from '../src/providers/acp/permissions';
import { validateFindings } from '../src/review/validate';
import { collectFileUnits } from '../src/sources/files-source';
import { READ_TOOLS } from '../src/tools/definitions';
import type { Finding } from '../src/types';
import { resolveInside } from '../src/util/paths';

function permission(toolCall: RequestPermissionRequest['toolCall']): RequestPermissionRequest {
  return {
    sessionId: 's',
    toolCall,
    options: [
      { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
      { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
    ],
  };
}

describe('ACP permission policy', () => {
  it('rejects edits even when the title mentions code-reviewer (e.g. a snapshot path)', () => {
    const d = decidePermission(
      permission({ toolCallId: '1', kind: 'edit', title: 'Edit /tmp/code-reviewer-Ab12/tree/src/x.ts' }),
    );
    expect(d.allowed).toBe(false);
    expect(d.response).toEqual({ outcome: { outcome: 'selected', optionId: 'reject' } });
  });

  it('allows our MCP tools by exact name and safe kinds', () => {
    expect(
      decidePermission(permission({ toolCallId: '1', title: 'mcp__code-reviewer__submit_findings' })).allowed,
    ).toBe(true);
    expect(
      decidePermission(permission({ toolCallId: '1', kind: 'read', title: 'Read src/a.ts' })).allowed,
    ).toBe(true);
    expect(
      decidePermission(permission({ toolCallId: '1', kind: 'other', title: 'Run code-reviewer.sh' })).allowed,
    ).toBe(false);
  });

  it('never approves dangerous kinds, whatever the name', () => {
    for (const kind of ['execute', 'delete', 'move', 'fetch', 'switch_mode'] as const) {
      const d = decidePermission(permission({ toolCallId: '1', kind, name: 'mcp__code-reviewer__grep' }));
      expect(d.allowed, kind).toBe(false);
    }
  });

  it('recognises tool identifiers strictly', () => {
    expect(isOwnTool('code-reviewer/grep')).toBe(true);
    expect(isOwnTool('grep')).toBe(true);
    expect(isOwnTool('mcp__code-reviewer__rm_rf')).toBe(false);
    expect(isOwnTool('cat ~/.code-reviewer/config.yaml')).toBe(false);
  });
});

describe('path confinement', () => {
  let root: string;
  let outside: string;

  beforeAll(() => {
    root = mkdtempSync(path.join(tmpdir(), 'cr-root-'));
    outside = mkdtempSync(path.join(tmpdir(), 'cr-outside-'));
    writeFileSync(path.join(outside, 'secret.txt'), 'TOKEN=abc\n');
    mkdirSync(path.join(root, 'src'));
    writeFileSync(path.join(root, 'src', 'a.ts'), 'export const a = 1;\nexport const b = 2;\n');
    symlinkSync(path.join(outside, 'secret.txt'), path.join(root, 'src', 'notes.md'));
    symlinkSync(outside, path.join(root, 'linked-dir'));
  });
  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  it('resolveInside refuses traversal and symlink escapes', () => {
    expect(resolveInside(root, 'src/a.ts')).toBe(path.join(root, 'src/a.ts'));
    expect(resolveInside(root, 'src/new-file.ts')).toBe(path.join(root, 'src/new-file.ts'));
    expect(() => resolveInside(root, '../etc/hosts')).toThrow(/escapes/);
    expect(() => resolveInside(root, 'src/../../x')).toThrow(/escapes/);
    expect(() => resolveInside(root, 'src/notes.md')).toThrow(/symlink/);
    expect(() => resolveInside(root, 'linked-dir/secret.txt')).toThrow(/symlink/);
  });

  it('read_file cannot follow a symlink out of the root', async () => {
    const readFile = READ_TOOLS.find((t) => t.name === 'read_file')!;
    await expect(readFile.execute({ path: 'src/notes.md' }, { root, git: false })).rejects.toThrow(/symlink/);
  });

  it('files mode skips symlinks instead of reading their targets', async () => {
    const { units, skipped } = await collectFileUnits({ root, cwd: root, paths: ['.'], exclude: [] });
    expect(units.map((u) => u.path)).toEqual(['src/a.ts']);
    expect(skipped).toEqual(expect.arrayContaining([{ path: 'src/notes.md', reason: 'symlink' }]));
    expect(JSON.stringify(units)).not.toContain('TOKEN');
  });

  it('validateFindings drops directories, traversal and symlinks without crashing', () => {
    const f = (file: string): Finding => ({
      id: file,
      file,
      startLine: 1,
      endLine: 1,
      severity: 'info',
      category: 'bug',
      title: 'x',
      description: 'a finding about something',
      confidence: 0.9,
      skills: [],
      source: { chunkIds: ['c001'], provider: 'mock' },
    });
    const { kept, dropped } = validateFindings(
      [f('.'), f('src'), f('src/../../etc/hosts'), f('src/notes.md'), f('./src/a.ts')],
      { root, units: [], mode: 'files' },
    );
    expect(kept.map((k) => k.file)).toEqual(['src/a.ts']);
    expect(dropped.map((d) => d.droppedReason)).toEqual(Array(4).fill('unknown-file'));
  });
});
