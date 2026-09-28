import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('package metadata', () => {
  it('points repository.url at the exact GitHub repository (npm provenance compares it case-sensitively)', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { repository: { url: string } };
    expect(pkg.repository.url).toBe('git+https://github.com/Antonio112009/code-reviewer.git');
  });
});
