import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { RequestPermissionRequest } from '@agentclientprotocol/sdk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { decidePermission } from '../src/providers/acp/permissions';
import { reviewInstructions } from '../src/review/prompts';
import { READ_TOOLS, runTool } from '../src/tools/definitions';
import { dependencyRoots, resolveDependencyPath } from '../src/tools/dependencies';

let dir: string;
let repo: string;
let gomod: string;
let secret: string;
const env = () => ({ GOMODCACHE: gomod, CARGO_HOME: path.join(dir, 'no-cargo') });

beforeEach(() => {
  dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'cr-deps-')));
  repo = path.join(dir, 'repo');
  gomod = path.join(dir, 'gomod');
  mkdirSync(path.join(repo, 'node_modules', 'left-pad'), { recursive: true });
  writeFileSync(path.join(repo, 'node_modules', 'left-pad', 'index.js'), 'module.exports = pad;\n');
  mkdirSync(path.join(gomod, 'github.com', 'acme', 'lib@v1.2.0'), { recursive: true });
  writeFileSync(path.join(gomod, 'github.com', 'acme', 'lib@v1.2.0', 'lib.go'), 'package lib\n');
  mkdirSync(path.join(dir, 'home', '.ssh'), { recursive: true });
  secret = path.join(dir, 'home', '.ssh', 'id_rsa');
  writeFileSync(secret, 'PRIVATE KEY');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('dependency roots', () => {
  it('finds the Go module cache and the checkout node_modules and virtualenv', () => {
    mkdirSync(path.join(repo, '.venv', 'lib', 'python3.12', 'site-packages'), { recursive: true });
    expect(dependencyRoots(repo, env())).toEqual([
      { label: 'Go modules', dir: gomod },
      { label: 'node_modules', dir: path.join(repo, 'node_modules') },
      { label: 'Python packages', dir: path.join(repo, '.venv', 'lib', 'python3.12', 'site-packages') },
    ]);
  });

  it('refuses directories a reviewed branch could point elsewhere with a symlink', () => {
    rmSync(path.join(repo, 'node_modules'), { recursive: true });
    symlinkSync(path.join(dir, 'home'), path.join(repo, 'node_modules'));
    mkdirSync(path.join(dir, 'elsewhere', 'python3.12', 'site-packages'), { recursive: true });
    mkdirSync(path.join(repo, '.venv'));
    symlinkSync(path.join(dir, 'elsewhere'), path.join(repo, '.venv', 'lib'));
    expect(dependencyRoots(repo, env()).map((r) => r.label)).toEqual(['Go modules']);
  });

  it('accepts files only when their real path stays inside a root', () => {
    const roots = dependencyRoots(repo, env()).map((r) => r.dir);
    const inside = path.join(repo, 'node_modules', 'left-pad', 'index.js');
    expect(resolveDependencyPath(roots, inside)).toBe(inside);
    symlinkSync(secret, path.join(repo, 'node_modules', 'left-pad', 'key'));
    expect(resolveDependencyPath(roots, path.join(repo, 'node_modules', 'left-pad', 'key'))).toBeUndefined();
    expect(resolveDependencyPath(roots, secret)).toBeUndefined();
    expect(resolveDependencyPath(roots, path.join(repo, 'node_modules'))).toBeUndefined(); // not a file
    expect(resolveDependencyPath(roots, 'node_modules/left-pad/index.js')).toBeUndefined(); // relative
  });
});

describe('reading dependencies', () => {
  const readFile = READ_TOOLS.find((t) => t.name === 'read_file')!;

  it('read_file reads an installed dependency by absolute path, nothing else outside the root', async () => {
    const roots = dependencyRoots(repo, env()).map((r) => r.dir);
    const ctx = { root: path.join(repo, 'src'), git: false, dependencyRoots: roots };
    mkdirSync(ctx.root);
    const lib = path.join(gomod, 'github.com', 'acme', 'lib@v1.2.0', 'lib.go');
    expect((await runTool(readFile, { path: lib }, ctx)).text).toContain('1\tpackage lib');
    const denied = await runTool(readFile, { path: secret }, ctx);
    expect(denied.isError).toBe(true);
    expect(denied.text).not.toContain('PRIVATE KEY');
  });

  it('lets ACP agents read inside dependency roots only', () => {
    const roots = dependencyRoots(repo, env()).map((r) => r.dir);
    const root = path.join(repo, 'src');
    const req = (kind: 'read' | 'edit', p: string): RequestPermissionRequest => ({
      sessionId: 's',
      toolCall: { toolCallId: '1', kind, title: `Read ${p}`, locations: [{ path: p }] },
      options: [
        { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
        { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
      ],
    });
    const lib = path.join(gomod, 'github.com', 'acme', 'lib@v1.2.0', 'lib.go');
    expect(decidePermission(req('read', lib), root, roots).allowed).toBe(true);
    expect(decidePermission(req('read', lib), root).allowed).toBe(false); // no roots given
    expect(decidePermission(req('read', secret), root, roots).allowed).toBe(false);
    expect(decidePermission(req('edit', lib), root, roots).allowed).toBe(false);
  });

  it('tells the model where the dependencies are', () => {
    const text = reviewInstructions({
      mode: 'diff',
      skills: [],
      readTools: true,
      dependencies: [{ label: 'Go modules', dir: gomod }],
    });
    expect(text).toContain(`read with read_file by absolute path (read-only)`);
    expect(text).toContain(`Go modules: ${gomod}`);
    expect(reviewInstructions({ mode: 'diff', skills: [], readTools: true })).not.toContain('absolute path');
  });
});
