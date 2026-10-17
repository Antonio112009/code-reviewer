#!/usr/bin/env node
// Builds website/data/skills.json, the skills catalog the website browses, from skills/**.
// Run before serving or deploying the site: `node scripts/build-website-data.mjs`.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const skillsDir = join(root, 'skills');
const out = join(root, 'website', 'data', 'skills.json');

const toId = (path) => relative(skillsDir, path).split(sep).join('/');

const groups = new Map();
const skills = [];

function walk(dir) {
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  const groupFile = entries.find((e) => e.name === '_group.yaml');
  if (groupFile) {
    const meta = parse(readFileSync(join(dir, groupFile.name), 'utf8')) ?? {};
    groups.set(toId(dir), {
      path: toId(dir),
      name: meta.name ?? toId(dir),
      description: meta.description ?? '',
      tier: meta.tier,
      versions: meta.detect?.versions,
    });
  }
  for (const e of entries) {
    const path = join(dir, e.name);
    if (e.isDirectory()) walk(path);
    else if (e.name.endsWith('.md')) readSkill(path);
  }
}

function readSkill(path) {
  const text = readFileSync(path, 'utf8');
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!match) return;
  const meta = parse(match[1]) ?? {};
  const id = toId(path).replace(/\.md$/, '');
  const activation = meta.activation ?? {};
  skills.push({
    id,
    name: meta.name ?? id,
    description: meta.description ?? '',
    tier: meta.tier,
    alwaysOn: meta.alwaysOn === true || undefined,
    tags: meta.tags?.length ? meta.tags : undefined,
    activation: {
      content: activation.content,
      files: activation.files,
      languages: activation.languages,
      versions: activation.versions,
    },
    checks: Array.isArray(meta.checks) ? meta.checks.length : undefined,
    sources: meta.sources,
    body: match[2].trim(),
  });
}

walk(skillsDir);

// The tier is inherited from the nearest group and defaults to essential (src/skills/loader.ts).
for (const skill of skills) {
  if (skill.tier) continue;
  const parts = skill.id.split('/');
  for (let i = parts.length - 1; i > 0 && !skill.tier; i--)
    skill.tier = groups.get(parts.slice(0, i).join('/'))?.tier;
  skill.tier ??= 'essential';
}

const catalog = {
  generated: new Date().toISOString().slice(0, 10),
  count: skills.length,
  groups: [...groups.values()].map(({ tier, ...g }) => g),
  skills,
};
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(catalog)}\n`);
console.error(`website/data/skills.json: ${skills.length} skills in ${groups.size} groups`);
