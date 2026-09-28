import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface Pkg {
  version: string;
  files: string[];
  repository: { url: string };
}

describe('package metadata', () => {
  it('ships the tested dependency tree (npm-shrinkwrap.json), which npm installs from the registry as is', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as Pkg;
    const shrinkwrap = JSON.parse(readFileSync('npm-shrinkwrap.json', 'utf8')) as {
      version: string;
      packages: Record<string, { version?: string }>;
    };
    expect(pkg.files).toContain('npm-shrinkwrap.json');
    expect(shrinkwrap.version).toBe(pkg.version);
    expect(shrinkwrap.packages['']?.version).toBe(pkg.version);
    // npm ignores package-lock.json next to a shrinkwrap: a second lockfile would only drift
    expect(existsSync('package-lock.json')).toBe(false);
  });

  it('points repository.url at the exact GitHub repository (npm provenance compares it case-sensitively)', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as Pkg;
    expect(pkg.repository.url).toBe('git+https://github.com/Antonio112009/code-reviewer.git');
  });
});
