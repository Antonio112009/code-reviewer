import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import YAML from 'yaml';

/** Agent skills of this repository: `.agents/skills` (Codex, GitHub Copilot) and `.claude/skills` (Claude Code). */
const COPIES = ['.agents/skills/release/SKILL.md', '.claude/skills/release/SKILL.md'];

describe('agent skills', () => {
  it('keeps the release skill identical for every agent', () => {
    const [first, ...rest] = COPIES.map((f) => readFileSync(f, 'utf8'));
    for (const [i, text] of rest.entries()) expect(text, COPIES[i + 1]).toBe(first);
  });

  it('has the Agent Skills frontmatter', () => {
    const text = readFileSync(COPIES[0]!, 'utf8');
    const meta = YAML.parse(/^---\n([\s\S]*?)\n---/.exec(text)![1]!) as { name: string; description: string };
    expect(meta.name).toBe('release');
    expect(meta.description.length).toBeGreaterThan(50);
    expect(meta.description.length).toBeLessThanOrEqual(1024);
  });
});
