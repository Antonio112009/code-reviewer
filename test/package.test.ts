import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface Pkg {
  version: string;
  files: string[];
  repository: { url: string };
}

describe('package metadata', () => {
  it('ships no shrinkwrap and pins its direct dependencies to the tested versions', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as Pkg & {
      dependencies: Record<string, string>;
      optionalDependencies: Record<string, string>;
    };
    const lock = JSON.parse(readFileSync('package-lock.json', 'utf8')) as {
      packages: Record<string, { version?: string }>;
    };
    // npm installs every platform's optional package listed in a dependency's shrinkwrap (os/cpu are
    // ignored there): with the bundled ast-grep, 0.5.1 installed 635 MB instead of 200 MB.
    expect(existsSync('npm-shrinkwrap.json')).toBe(false);
    expect(pkg.files).not.toContain('npm-shrinkwrap.json');
    for (const [name, version] of Object.entries({ ...pkg.dependencies, ...pkg.optionalDependencies })) {
      expect(version, name).toBe(lock.packages[`node_modules/${name}`]?.version);
    }
  });

  it('points repository.url at the exact GitHub repository (npm provenance compares it case-sensitively)', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as Pkg;
    expect(pkg.repository.url).toBe('git+https://github.com/Antonio112009/code-reviewer.git');
  });
});
