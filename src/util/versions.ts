/**
 * Minimal version handling for technology versions (Next.js 15.1, Go 1.22, Python 3.12, .NET 8, …).
 * Versions are numeric dotted tuples; pre-release tags are ignored. Ranges use a small, well-known
 * syntax: comparators `>=`, `>`, `<=`, `<`, `=`, caret `^`, tilde `~`, wildcards `3.x` / `3.*`,
 * a bare version (`3.12` = every 3.12.x), space-separated AND and `||` OR.
 */

export type Version = number[];

/** "v15.1.0-rc.1" → [15, 1, 0]; undefined when no leading number. */
export function parseVersion(text: string): Version | undefined {
  const m = /^\s*v?(\d+(?:\.\d+)*)/.exec(text);
  if (!m) return undefined;
  return m[1]!.split('.').map((n) => Number.parseInt(n, 10));
}

export function compareVersions(a: Version, b: Version): number {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

export function formatVersion(v: Version): string {
  return v.join('.');
}

type Test = (v: Version) => boolean;

/** The version right after every version with prefix `v` (1.22 → 1.23, 3 → 4). */
function bumpLast(v: Version): Version {
  const out = [...v];
  out[out.length - 1] = (out[out.length - 1] ?? 0) + 1;
  return out;
}

function prefixRange(v: Version): Test {
  const upper = bumpLast(v);
  return (x) => compareVersions(x, v) >= 0 && compareVersions(x, upper) < 0;
}

function comparator(token: string): Test | undefined {
  const m = /^(>=|<=|>|<|=|\^|~)?\s*v?([\dxX*]+(?:\.[\dxX*]+)*)$/.exec(token.trim());
  if (!m) return undefined;
  const op = m[1] ?? '';
  const parts = m[2]!.split('.');
  const wild = parts.findIndex((p) => /^[xX*]$/.test(p));
  const nums = (wild === -1 ? parts : parts.slice(0, wild)).map((p) => Number.parseInt(p, 10));
  if (nums.some((n) => Number.isNaN(n))) return undefined;
  if (nums.length === 0) return () => true; // "*" / "x"
  const v: Version = nums;
  switch (op) {
    case '>=':
      return (x) => compareVersions(x, v) >= 0;
    // A partial version stands for all its releases: `>1.21` = above every 1.21.x, `<=1.21` includes 1.21.9.
    case '>':
      return wild === -1 && v.length >= 3
        ? (x) => compareVersions(x, v) > 0
        : (x) => compareVersions(x, bumpLast(v)) >= 0;
    case '<=':
      return wild === -1 && v.length >= 3
        ? (x) => compareVersions(x, v) <= 0
        : (x) => compareVersions(x, bumpLast(v)) < 0;
    case '<':
      return (x) => compareVersions(x, v) < 0;
    case '^': {
      // ^1.2.3 → <2; ^0.2.3 → <0.3; ^0.0.3 → <0.0.4
      const idx = v.findIndex((n) => n !== 0);
      const upper = idx === -1 ? bumpLast(v) : [...v.slice(0, idx), (v[idx] ?? 0) + 1];
      return (x) => compareVersions(x, v) >= 0 && compareVersions(x, upper) < 0;
    }
    case '~': {
      const upper = v.length >= 2 ? [v[0]!, v[1]! + 1] : [v[0]! + 1];
      return (x) => compareVersions(x, v) >= 0 && compareVersions(x, upper) < 0;
    }
    default:
      // "=1.2" and a bare "1.2" mean every 1.2.x; "3.x" means every 3.x
      return prefixRange(v);
  }
}

/** Compiles a range; throws on syntax errors (so skill files are validated at load time). */
export function compileRange(range: string): Test {
  const alternatives = range.split('||').map((alt) => {
    const tokens = alt
      .trim()
      // "> = 1" → ">=1" is not supported; but ">= 1.2" (space after the operator) is common
      .replace(/(>=|<=|>|<|=|\^|~)\s+/g, '$1')
      .split(/[\s,]+/)
      .filter(Boolean);
    if (tokens.length === 0) throw new Error(`empty version range "${range}"`);
    const tests = tokens.map((t) => {
      const test = comparator(t);
      if (!test) throw new Error(`invalid version range "${range}" (at "${t}")`);
      return test;
    });
    return (v: Version) => tests.every((t) => t(v));
  });
  return (v) => alternatives.some((t) => t(v));
}

/** True when `version` satisfies `range`. Unparseable versions never satisfy. */
export function satisfies(version: string, range: string): boolean {
  const v = parseVersion(version);
  return v !== undefined && compileRange(range)(v);
}

/**
 * Lowest version a dependency spec allows — what the project is at least on. Handles npm (`^15.1.0`,
 * `~5.0`, `>=18 <20`, `15.x`, `workspace:^1`, `npm:react@^18`), PEP 440 (`>=3.10,<4`, `==5.0.*`,
 * `~=3.11`, `!=3.9`), RubyGems (`~> 7.1`), Maven (`3.2.0`, `[3.1,4)`), Go (`v1.22.3`) and Composer
 * (`^11.0|^12.0`). Returns undefined for tags, URLs, paths and pure upper bounds (`latest`,
 * `github:x/y`, `file:../z`, `<4`).
 */
export function minVersionOfSpec(spec: string | undefined): string | undefined {
  if (!spec) return undefined;
  const s = spec
    .trim()
    .replace(/^workspace:/, '')
    .replace(/^npm:(?:@[^/@]+\/)?[^@]+@/, '');
  if (
    !s ||
    /^(?:latest|next|canary|beta|alpha|rc|catalog:|git\+|git:|github:|file:|link:|https?:|portal:|patch:)/i.test(
      s,
    )
  ) {
    return undefined;
  }
  let best: Version | undefined;
  for (const alt of s.split(/\s*\|\|?\s*/)) {
    let lower: Version | undefined;
    if (/^[[(]/.test(alt)) {
      // Maven range: the first bound is the lower one ("(,4)" has none)
      const m = /^[[(]\s*v?(\d+(?:\.\d+)*)/.exec(alt);
      lower = m ? parseVersion(m[1]!) : undefined;
    } else {
      for (const m of alt.matchAll(/(>=|<=|!=|===|==|~>|~=|>|<|=|\^|~)?\s*v?(\d+(?:\.\d+)*)/g)) {
        const op = m[1] ?? '';
        if (op === '<' || op === '<=' || op === '!=') continue; // not a lower bound
        const v = parseVersion(m[2]!);
        if (v && (!lower || compareVersions(v, lower) > 0)) lower = v;
      }
    }
    if (lower && (!best || compareVersions(lower, best) < 0)) best = lower;
  }
  return best ? formatVersion(best) : undefined;
}
