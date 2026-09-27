import picomatch from 'picomatch';

/** Activation block of a skill (raw, as written in the frontmatter). */
export interface SkillActivation {
  /** Gate: at least one of these tech ids (`src/context/stack/techs.ts`) applies to the chunk. */
  stack?: string[];
  /** Gate: at least one chunk language (ids from `src/util/language.ts`). */
  languages?: string[];
  /** Signal: picomatch globs on repository-relative paths. */
  files?: string[];
  /** Signal: JavaScript regular expressions (multiline) on the chunk's code. */
  content?: string[];
  /** Gate: tech id → version range (`framework.nextjs: ">=13"`); passes when the version is unknown. */
  versions?: Record<string, string>;
}

/** Matchers compiled once per skill. */
export interface CompiledActivation {
  files?: (file: string) => boolean;
  content: RegExp[];
}

const cache = new WeakMap<object, CompiledActivation>();

/**
 * Compiles globs and regexes of an activation block. Throws on an invalid regex so the loader can
 * skip the skill with a warning. Globs without a slash also match basenames (`*.tf` → `infra/main.tf`).
 */
export function compileActivation(activation: SkillActivation): CompiledActivation {
  const content = (activation.content ?? []).map((source) => {
    try {
      return new RegExp(source, 'm');
    } catch (err) {
      throw new Error(`invalid content regex /${source}/: ${(err as Error).message}`);
    }
  });
  const files = activation.files?.length ? compileGlobs(activation.files) : undefined;
  return { files, content };
}

/**
 * Compiles path globs for repository-relative paths. Globs without a slash match the file name at any
 * depth (`*.tf` matches `infra/main.tf`); globs with a slash match the whole path (for example a
 * migrations-folder glob). picomatch's `basename` option cannot be used for both: it compares every
 * glob with the file name only, so directory globs would never match.
 */
export function compileGlobs(globs: readonly string[]): (file: string) => boolean {
  const nameGlobs = globs.filter((g) => !g.includes('/'));
  const pathGlobs = globs.filter((g) => g.includes('/'));
  const byName = nameGlobs.length ? picomatch(nameGlobs, { dot: true, basename: true }) : undefined;
  const byPath = pathGlobs.length ? picomatch(pathGlobs, { dot: true }) : undefined;
  return (file) => (byName?.(file) ?? false) || (byPath?.(file) ?? false);
}

/**
 * Compiled matchers of `skill`, compiled on first use and cached for the lifetime of its activation
 * object (shared by derived views of the skill, e.g. its essential-depth copy).
 */
export function compiledActivation(skill: { activation: SkillActivation }): CompiledActivation {
  return compiledFor(skill.activation, skill.activation);
}

/** Compiled matchers of `activation`, cached under `key` (a skill or a group object). */
export function compiledFor(key: object, activation: SkillActivation): CompiledActivation {
  let compiled = cache.get(key);
  if (!compiled) {
    compiled = compileActivation(activation);
    cache.set(key, compiled);
  }
  return compiled;
}

/** Seeds the cache with matchers the loader already compiled while validating (key: activation or group). */
export function primeActivation(key: object, compiled: CompiledActivation): void {
  cache.set(key, compiled);
}

/**
 * Heuristic ReDoS guard for regexes from untrusted sources (project skills): true when a quantified
 * group itself contains an unbounded quantifier, e.g. `(a+)+`, `(\w*\s?)*`, `(?:x{2,})+`. Such patterns
 * can backtrack exponentially on crafted input and block the event loop (and Ctrl+C) indefinitely.
 */
export function hasNestedQuantifier(pattern: string): boolean {
  const stack: boolean[] = [];
  let inner = false; // current group contains an unbounded quantifier
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '\\') {
      i++;
      continue;
    }
    if (c === '[') {
      i++;
      if (pattern[i] === '^') i++;
      if (pattern[i] === ']') i++;
      while (i < pattern.length && pattern[i] !== ']') {
        if (pattern[i] === '\\') i++;
        i++;
      }
      continue;
    }
    if (c === '(') {
      stack.push(inner);
      inner = false;
      continue;
    }
    if (c === ')') {
      const had = inner;
      inner = stack.pop() ?? false;
      if (had && unboundedQuantifierAt(pattern, i + 1)) return true;
      if (had) inner = true;
      continue;
    }
    if (unboundedQuantifierAt(pattern, i)) inner = true;
  }
  return false;
}

function unboundedQuantifierAt(pattern: string, i: number): boolean {
  const c = pattern[i];
  if (c === '*' || c === '+') return true;
  if (c !== '{') return false;
  const m = /^\{(\d+)(,(\d*))?\}/.exec(pattern.slice(i));
  if (!m) return false;
  if (m[2] === undefined) return false; // {n}: fixed count
  return m[3] === '' || Number(m[3]) > 1;
}
