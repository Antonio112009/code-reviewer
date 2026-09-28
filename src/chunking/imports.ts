import path from 'node:path';
import { init as initModuleLexer, parse as parseModule } from 'es-module-lexer';
import pLimit from 'p-limit';
import { parse as parseToml } from 'smol-toml';

/**
 * Import extraction and resolution for the chunking graph.
 *
 * Repository code is never executed and repository configs are never loaded as code: specifiers are
 * found with a WebAssembly lexer (JS/TS) or regular expressions (everything else), and resolved purely
 * by path against the list of files in the reviewed revision. Config files (`tsconfig.json`, `go.mod`,
 * `Cargo.toml`, `composer.json`, `pubspec.yaml`, `package.json`) are parsed as data only.
 */

const posix = path.posix;

/** Reads a file of the reviewed revision (repo-relative path); undefined when missing or unreadable. */
export type ReadFile = (file: string) => Promise<string | undefined>;

/** How a specifier is resolved. */
export type ImportScheme =
  | 'js'
  | 'python'
  | 'go'
  | 'jvm'
  | 'csharp'
  | 'php'
  | 'php-file'
  | 'ruby-relative'
  | 'ruby'
  | 'rust-mod'
  | 'rust-use'
  | 'c'
  | 'dart';

/** One import found in a source file. */
export interface ImportSpec {
  scheme: ImportScheme;
  /** Specifier as written, normalised per scheme (dotted module, FQN, `crate::a::b`, `App\Models\User`, …). */
  specifier: string;
  /** Python `from x import a, b`: imported names (each may be a submodule). */
  names?: string[];
  /** JVM wildcard / C# namespace import: resolves to the classes of that package the file mentions. */
  wildcard?: boolean;
  /** C/C++ `#include <…>` (as opposed to `"…"`). */
  system?: boolean;
}

/** Source families with an import extractor. Swift has none (imports are whole modules). */
export type SourceKind =
  | 'js'
  | 'jsx'
  | 'python'
  | 'go'
  | 'jvm'
  | 'csharp'
  | 'php'
  | 'ruby'
  | 'rust'
  | 'c'
  | 'dart';

const KIND_BY_EXT: Record<string, SourceKind> = {
  '.js': 'js',
  '.mjs': 'js',
  '.cjs': 'js',
  '.ts': 'js',
  '.mts': 'js',
  '.cts': 'js',
  '.jsx': 'jsx',
  '.tsx': 'jsx',
  '.vue': 'jsx',
  '.svelte': 'jsx',
  '.astro': 'jsx',
  '.py': 'python',
  '.pyi': 'python',
  '.go': 'go',
  '.java': 'jvm',
  '.kt': 'jvm',
  '.kts': 'jvm',
  '.scala': 'jvm',
  '.groovy': 'jvm',
  '.cs': 'csharp',
  '.php': 'php',
  '.rb': 'ruby',
  '.rake': 'ruby',
  '.rs': 'rust',
  '.c': 'c',
  '.h': 'c',
  '.cc': 'c',
  '.cpp': 'c',
  '.cxx': 'c',
  '.hpp': 'c',
  '.hh': 'c',
  '.hxx': 'c',
  '.m': 'c',
  '.mm': 'c',
  '.dart': 'dart',
};

/** Extensions of the files the import scanner (and `expand`) understands, with the dot. */
export const SOURCE_EXTENSIONS: readonly string[] = Object.keys(KIND_BY_EXT);

/** Extractor family of a file, by extension. */
export function sourceKind(file: string): SourceKind | undefined {
  return KIND_BY_EXT[posix.extname(file).toLowerCase()];
}

/**
 * Files bigger than this (minified bundles, generated code) are not scanned. Every pattern below is
 * anchored and bounded, so scanning stays linear even on adversarial input.
 */
const MAX_SCAN_BYTES = 2 * 1024 * 1024;
/** Upper bound of resolved targets per file (a barrel file can import hundreds of modules). */
const MAX_TARGETS_PER_FILE = 200;
/** Upper bound of files one package-level import (Go package, JVM wildcard) expands to. */
const MAX_PACKAGE_FILES = 50;
const MAX_CONFIG_BYTES = 1024 * 1024;
/** tsconfig files read per root config (its `extends` chain and `references`). */
const TS_CONFIG_BUDGET = 32;

// ---------------------------------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------------------------------

let lexerReady = false;
let lexerInit: Promise<void> | undefined;

/**
 * Compiles the ES module lexer (WebAssembly) once. Extraction falls back to regular expressions until it
 * is ready or when it cannot be loaded. Returns whether the lexer is available.
 */
export async function initImportLexer(): Promise<boolean> {
  lexerInit ??= initModuleLexer().then(
    () => {
      lexerReady = true;
    },
    () => {
      lexerReady = false;
    },
  );
  await lexerInit;
  return lexerReady;
}

/**
 * Extracts import specifiers from one source file without executing it. Unknown languages yield `[]`.
 * Call {@link initImportLexer} first to use the (faster, exact) lexer for `.js/.mjs/.cjs/.ts/.mts/.cts`.
 */
export function extractImports(file: string, content: string): ImportSpec[] {
  const kind = sourceKind(file);
  if (!kind || content.length > MAX_SCAN_BYTES) return [];
  switch (kind) {
    case 'js':
    case 'jsx':
      return jsImports(content, kind === 'js').map((specifier) => ({ scheme: 'js', specifier }));
    case 'python':
      return pythonImports(content);
    case 'go':
      return goImports(content).map((specifier) => ({ scheme: 'go', specifier }));
    case 'jvm':
      return jvmImports(content);
    case 'csharp':
      return csharpImports(content);
    case 'php':
      return phpImports(content);
    case 'ruby':
      return rubyImports(content);
    case 'rust':
      return rustImports(content);
    case 'c':
      return cImports(content);
    case 'dart':
      return dartImports(content).map((specifier) => ({ scheme: 'dart', specifier }));
  }
}

function matches(re: RegExp, text: string, group = 1): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(re)) {
    const v = m[group];
    if (v) out.push(v);
  }
  return out;
}

/**
 * Statements that begin with a match of `start` (global, line-anchored) and end at the next `terminator`,
 * at most `maxLen` characters later. Linear on any input: the scan resumes after each statement and one
 * terminator lookup serves every start before it.
 */
function statements(
  content: string,
  start: RegExp,
  terminator: string,
  maxLen: number,
): Array<{ match: RegExpExecArray; body: string }> {
  const re = new RegExp(start.source, start.flags);
  const out: Array<{ match: RegExpExecArray; body: string }> = [];
  let termAt = -1;
  for (let m = re.exec(content); m; m = re.exec(content)) {
    const from = re.lastIndex;
    if (termAt < from) {
      termAt = content.indexOf(terminator, from);
      if (termAt < 0) break;
    }
    if (termAt - from <= maxLen) {
      out.push({ match: m, body: content.slice(from, termAt) });
      re.lastIndex = termAt + terminator.length;
    } else if (m[0].length === 0) re.lastIndex = from + 1;
  }
  return out;
}

const JS_STATIC_RE =
  /(?:^|[\n;])[ \t]*(?:import|export)\b(?=(\s*))\1(?:[\w$*{},\s]{0,2000}?\bfrom[ \t]*)?(['"])([^'"\n]+)\2/g;
const JS_DYNAMIC_RE = /\bimport\s*\(\s*(['"])([^'"\n]+)\1\s*[,)]/g;
const JS_REQUIRE_RE = /\brequire\s*\(\s*(['"])([^'"\n]+)\1\s*\)/g;
/** Test mocks name the module under test: `vi.mock('./db')`, `jest.requireActual('../api')`. */
const JS_MOCK_RE =
  /\b(?:jest|vi)\.(?:mock|doMock|unmock|requireActual|importActual)\s*\(\s*(['"])([^'"\n]+)\1/g;

function jsImports(content: string, lexable: boolean): string[] {
  const out: string[] = [];
  let lexed = false;
  if (lexable && lexerReady) {
    try {
      const [imports] = parseModule(content);
      for (const imp of imports) {
        if (imp.type === 'import-meta') continue;
        if (imp.type === 'dynamic' && imp.glob) continue;
        if (imp.specifier) out.push(imp.specifier);
      }
      lexed = true;
    } catch {
      // JSX in a .js file, syntax the lexer does not know, … → regex fallback
    }
  }
  if (!lexed) out.push(...matches(JS_STATIC_RE, content, 3), ...matches(JS_DYNAMIC_RE, content, 2));
  out.push(...matches(JS_REQUIRE_RE, content, 2), ...matches(JS_MOCK_RE, content, 2));
  return [...new Set(out)];
}

/** Longest import clause parsed (a longer one is not a real import, and splitting it would cost time). */
const MAX_IMPORT_BODY = 4_000;

/**
 * `a  as b` → `a`. Whitespace is collapsed first (linear) — a `\s+as\s+` split backtracks quadratically
 * over long whitespace runs in untrusted files.
 */
function beforeAlias(item: string): string {
  return item.replace(/\s+/g, ' ').trim().split(' as ')[0]!.trim();
}

/** `A\B as C, D` → `A\B,D` (aliases and whitespace removed, linear in the input). */
function withoutAliases(body: string): string {
  return body
    .replace(/\s+/g, ' ')
    .replace(/ as \w+/g, '')
    .replace(/ /g, '');
}

const PY_FROM_RE = /^[ \t]*from[ \t]+(\.*[A-Za-z_][\w.]*|\.+)[ \t]+import[ \t]*/gm;
const PY_IMPORT_RE = /^[ \t]*import[ \t]+([^\n#;]+)/gm;

function pythonImports(content: string): ImportSpec[] {
  const out: ImportSpec[] = [];
  const re = new RegExp(PY_FROM_RE.source, PY_FROM_RE.flags);
  let closeAt = -1;
  for (let m = re.exec(content); m; m = re.exec(content)) {
    const from = re.lastIndex;
    let body: string;
    if (content[from] === '(') {
      if (closeAt < from) closeAt = content.indexOf(')', from);
      if (closeAt < 0) break;
      if (closeAt - from > 4_000) continue;
      body = content.slice(from + 1, closeAt);
      re.lastIndex = closeAt;
    } else {
      const eol = content.indexOf('\n', from);
      body = content.slice(from, eol < 0 ? content.length : eol).split(/[#;]/)[0]!;
    }
    if (body.length > MAX_IMPORT_BODY) continue;
    const names = body
      .replace(/\\/g, ' ')
      .split(',')
      .map(beforeAlias)
      .filter((n) => /^[A-Za-z_]\w*$/.test(n));
    out.push({ scheme: 'python', specifier: m[1]!, names });
  }
  for (const m of content.matchAll(PY_IMPORT_RE)) {
    if ((m[1] ?? '').length > MAX_IMPORT_BODY) continue;
    for (const item of (m[1] ?? '').split(',')) {
      const mod = beforeAlias(item);
      if (/^[A-Za-z_][\w.]*$/.test(mod)) out.push({ scheme: 'python', specifier: mod });
    }
  }
  return out;
}

const GO_BLOCK_RE = /^[ \t]*import[ \t]*\(/gm;
const GO_SINGLE_RE = /^[ \t]*import[ \t]+(?:[\w.]+[ \t]+)?"([^"\n]+)"/gm;
const GO_BLOCK_ITEM_RE = /^[ \t]*(?:[\w.]+[ \t]+)?"([^"\n]+)"/gm;

function goImports(content: string): string[] {
  const out = matches(GO_SINGLE_RE, content);
  for (const { body } of statements(content, GO_BLOCK_RE, ')', 20_000))
    out.push(...matches(GO_BLOCK_ITEM_RE, body));
  return out;
}

const JVM_IMPORT_RE = /^[ \t]*import[ \t]+(static[ \t]+)?([\w.]*\w(?:\.\{[^}\n]*\}|\.\*)?)/gm;

function jvmImports(content: string): ImportSpec[] {
  const out: ImportSpec[] = [];
  for (const m of content.matchAll(JVM_IMPORT_RE)) {
    const raw = m[2]!;
    const brace = raw.indexOf('.{');
    if (brace >= 0) {
      // Scala: import a.b.{C, D => E, _}
      const prefix = raw.slice(0, brace);
      for (const item of raw.slice(brace + 2, -1).split(',')) {
        const name = item.split('=>')[0]!.trim();
        if (name === '_') out.push({ scheme: 'jvm', specifier: prefix, wildcard: true });
        else if (/^\w+$/.test(name)) out.push({ scheme: 'jvm', specifier: `${prefix}.${name}` });
      }
    } else if (raw.endsWith('.*') || raw.endsWith('._')) {
      out.push({ scheme: 'jvm', specifier: raw.slice(0, -2), wildcard: true });
    } else out.push({ scheme: 'jvm', specifier: raw });
  }
  return out;
}

const CS_USING_RE =
  /^[ \t]*(?:global[ \t]+)?using[ \t]+(static[ \t]+)?(?:\w+[ \t]*=[ \t]*)?([\w.]+)[ \t]*;/gm;

function csharpImports(content: string): ImportSpec[] {
  return [...content.matchAll(CS_USING_RE)].map((m) =>
    m[1]
      ? { scheme: 'csharp' as const, specifier: m[2]! }
      : { scheme: 'csharp' as const, specifier: m[2]!, wildcard: true },
  );
}

const PHP_USE_RE = /^[ \t]*use[ \t]+(function[ \t]+|const[ \t]+)?/gm;
const PHP_INCLUDE_RE =
  /\b(?:require|include)(?:_once)?[ \t]*(?:\([ \t]*)?(__DIR__[ \t]*\.[ \t]*)?(['"])([^'"\n]+)\2/g;

function phpImports(content: string): ImportSpec[] {
  const out: ImportSpec[] = [];
  for (const { match, body } of statements(content, PHP_USE_RE, ';', 2_000)) {
    if (match[1]) continue; // functions / constants cannot be mapped to files
    for (const name of expandGroups(withoutAliases(body), '\\')) {
      const fqcn = name.replace(/^\\+/, '');
      if (fqcn.includes('\\') && /^[\w\\]+$/.test(fqcn)) out.push({ scheme: 'php', specifier: fqcn });
    }
  }
  for (const m of content.matchAll(PHP_INCLUDE_RE)) {
    out.push({ scheme: 'php-file', specifier: m[3]!.replace(/^\/+/, m[1] ? './' : '') });
  }
  return out;
}

const RUBY_RELATIVE_RE = /^[ \t]*require_relative[ \t(]+(['"])([^'"\n]+)\1/gm;
const RUBY_REQUIRE_RE = /^[ \t]*require[ \t(]+(['"])([^'"\n]+)\1/gm;

function rubyImports(content: string): ImportSpec[] {
  return [
    ...matches(RUBY_RELATIVE_RE, content, 2).map((specifier) => ({
      scheme: 'ruby-relative' as const,
      specifier,
    })),
    ...matches(RUBY_REQUIRE_RE, content, 2).map((specifier) => ({ scheme: 'ruby' as const, specifier })),
  ];
}

const RUST_MOD_RE = /^[ \t]*(?:pub(?:\([^)\n]*\))?[ \t]+)?mod[ \t]+(\w+)[ \t]*;/gm;
const RUST_USE_RE = /^[ \t]*(?:pub(?:\([^)\n]*\))?[ \t]+)?use[ \t]+/gm;

function rustImports(content: string): ImportSpec[] {
  const out: ImportSpec[] = matches(RUST_MOD_RE, content).map((specifier) => ({
    scheme: 'rust-mod',
    specifier,
  }));
  for (const { body } of statements(content, RUST_USE_RE, ';', 4_000)) {
    const flat = withoutAliases(body);
    for (const p of expandGroups(flat, '::')) {
      out.push({ scheme: 'rust-use', specifier: p.replace(/^::/, '') });
    }
  }
  return out;
}

const C_INCLUDE_RE = /^[ \t]*#[ \t]*(?:include|import)[ \t]*([<"])([^>"\n]+)[>"]/gm;

function cImports(content: string): ImportSpec[] {
  return [...content.matchAll(C_INCLUDE_RE)].map((m) => ({
    scheme: 'c' as const,
    specifier: m[2]!.trim(),
    system: m[1] === '<',
  }));
}

const DART_RE = /^[ \t]*(?:import|export|part(?:[ \t]+of)?)[ \t]+(['"])([^'"\n]+)\1/gm;

function dartImports(content: string): string[] {
  return matches(DART_RE, content, 2);
}

/**
 * Expands grouped imports: `a::{b, c::{d, e}, self}` → `a::b`, `a::c::d`, `a::c::e`, `a`
 * (Rust `::`, PHP `\`). Input must be whitespace-free. Bounded to 64 results.
 */
export function expandGroups(tree: string, sep: string): string[] {
  const out: string[] = [];
  const walk = (t: string, depth: number) => {
    if (out.length >= 64 || depth > 8) return;
    const brace = t.indexOf('{');
    if (brace < 0) {
      if (t) out.push(t);
      return;
    }
    const prefix = t.slice(0, brace);
    const close = t.lastIndexOf('}');
    if (close < brace) return;
    const inner = t.slice(brace + 1, close);
    let level = 0;
    let start = 0;
    const items: string[] = [];
    for (let i = 0; i <= inner.length; i++) {
      const ch = inner[i];
      if (ch === '{') level++;
      else if (ch === '}') level--;
      else if ((ch === ',' || ch === undefined) && level === 0) {
        items.push(inner.slice(start, i));
        start = i + 1;
      }
    }
    for (const item of items) {
      if (!item) continue;
      if (item === 'self') out.push(prefix.endsWith(sep) ? prefix.slice(0, -sep.length) : prefix);
      else walk(prefix + item, depth + 1);
    }
  };
  walk(tree, 0);
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Config parsing (data only)
// ---------------------------------------------------------------------------------------------------

/**
 * Parses JSON with comments and trailing commas (tsconfig/jsconfig style) as plain data.
 * Returns undefined when the text is not valid JSONC.
 */
export function parseJsonc(text: string): unknown {
  let out = '';
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i]!;
    if (ch === '"') {
      let j = i + 1;
      while (j < n && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (ch === '/' && text[i + 1] === '/') {
      while (i < n && text[i] !== '\n') i++;
    } else if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end < 0 ? n : end + 2;
      out += ' ';
    } else if (ch === ',') {
      let j = i + 1;
      while (j < n && /\s/.test(text[j]!)) j++;
      // a comment between the comma and the bracket still makes it trailing
      if (text[j] === '/' && (text[j + 1] === '/' || text[j + 1] === '*')) {
        const rest = parseJsoncRestIsClosing(text, j);
        if (!rest) out += ch;
      } else if (text[j] !== '}' && text[j] !== ']') out += ch;
      i++;
    } else {
      out += ch;
      i++;
    }
  }
  try {
    return JSON.parse(out);
  } catch {
    return undefined;
  }
}

/** True when only comments and whitespace separate position `i` from a closing bracket. */
function parseJsoncRestIsClosing(text: string, i: number): boolean {
  const n = text.length;
  while (i < n) {
    const ch = text[i]!;
    if (/\s/.test(ch)) i++;
    else if (ch === '/' && text[i + 1] === '/') {
      while (i < n && text[i] !== '\n') i++;
    } else if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end < 0 ? n : end + 2;
    } else return ch === '}' || ch === ']';
  }
  return false;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// ---------------------------------------------------------------------------------------------------
// Paths and repository index
// ---------------------------------------------------------------------------------------------------

/** Directory of a repo-relative path ('.' for the root). */
export function dirOf(file: string): string {
  return posix.dirname(file);
}

function child(dir: string, name: string): string {
  return dir === '.' || dir === '' ? name : `${dir}/${name}`;
}

/** Joins `rel` onto `dir` and normalises; undefined when the result is absolute or leaves the root. */
export function joinInside(dir: string, rel: string): string | undefined {
  if (!rel || rel.startsWith('/') || /^[A-Za-z]:[\\/]/.test(rel) || rel.includes('\0')) return undefined;
  const joined = posix.normalize(child(dir, rel)).replace(/\/+$/, '');
  if (joined === '..' || joined.startsWith('../') || joined.startsWith('/')) return undefined;
  return joined || '.';
}

function stemOf(file: string): string {
  const base = posix.basename(file);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
}

function isUnder(file: string, dir: string): boolean {
  return dir === '.' || file.startsWith(`${dir}/`);
}

function commonPrefixLength(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a.charCodeAt(i) === b.charCodeAt(i)) i++;
  return i;
}

/** Picks the candidate closest to `importer` (longest shared path prefix, then shortest, then lexicographic). */
function nearest(importer: string, candidates: string[]): string | undefined {
  let best: string | undefined;
  let bestScore = -1;
  for (const c of candidates) {
    const score = commonPrefixLength(importer, c);
    if (
      best === undefined ||
      score > bestScore ||
      (score === bestScore && (c.length < best.length || (c.length === best.length && c < best)))
    ) {
      best = c;
      bestScore = score;
    }
  }
  return best;
}

/** Lookup structures over every file of the revision; the expensive ones are built on first use. */
class RepoIndex {
  readonly set: Set<string>;
  private dirMap?: Map<string, string[]>;
  private baseMap?: Map<string, string[]>;
  private dirNameMap?: Map<string, string[]>;
  private pyMap?: Map<string, Array<{ file: string; mod: string }>>;

  constructor(files: Iterable<string>) {
    this.set = new Set(files);
  }

  has(file: string): boolean {
    return this.set.has(file);
  }

  /** Files directly inside `dir`. */
  filesIn(dir: string): string[] {
    if (!this.dirMap) {
      this.dirMap = new Map();
      for (const f of this.set) push(this.dirMap, dirOf(f), f);
    }
    return this.dirMap.get(dir) ?? [];
  }

  /** Files with this basename anywhere in the repository. */
  byBasename(name: string): string[] {
    if (!this.baseMap) {
      this.baseMap = new Map();
      for (const f of this.set) push(this.baseMap, posix.basename(f), f);
    }
    return this.baseMap.get(name) ?? [];
  }

  /** Directories (containing at least one file) whose path ends with `suffix` (segment-aligned). */
  dirsEndingWith(suffix: string): string[] {
    if (!this.dirNameMap) {
      this.filesIn('.');
      this.dirNameMap = new Map();
      for (const d of this.dirMap!.keys()) push(this.dirNameMap, posix.basename(d), d);
    }
    const last = posix.basename(suffix);
    return (this.dirNameMap.get(last) ?? []).filter((d) => d === suffix || d.endsWith(`/${suffix}`));
  }

  /** Python modules by last dotted segment: `a/b/c.py` and `a/b/c/__init__.py` → key `c`, module `a/b/c`. */
  pythonModules(last: string): Array<{ file: string; mod: string }> {
    if (!this.pyMap) {
      this.pyMap = new Map();
      for (const f of this.set) {
        if (!f.endsWith('.py') && !f.endsWith('.pyi')) continue;
        const noExt = f.slice(0, f.lastIndexOf('.'));
        const mod = noExt.endsWith('/__init__') ? noExt.slice(0, -'/__init__'.length) : noExt;
        if (mod === '__init__') continue;
        push(this.pyMap, posix.basename(mod), { file: f, mod });
      }
    }
    return this.pyMap.get(last) ?? [];
  }
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

// ---------------------------------------------------------------------------------------------------
// Project configs
// ---------------------------------------------------------------------------------------------------

interface TsPathRule {
  prefix: string;
  suffix: string;
  wildcard: boolean;
  targets: string[];
}

interface TsSettings {
  /** Repo-relative directory of `compilerOptions.baseUrl`. */
  baseUrl?: string;
  /** Directory `paths` are relative to when there is no baseUrl (the config that declared them). */
  pathsBase?: string;
  rules?: TsPathRule[];
  /** Directory of the leaf config (for `${configDir}`). */
  configDir: string;
}

interface WorkspacePackage {
  name: string;
  dir: string;
  /** Candidate entry files, relative to `dir`, most specific first. */
  entries: string[];
  /** `exports` subpaths (`.`, `./utils`, `./*`) → targets relative to `dir`. */
  exports: Map<string, string[]>;
}

interface GoModule {
  dir: string;
  module: string;
}

interface RustCrate {
  dir: string;
  /** Crate name as used in paths (`-` → `_`); undefined when Cargo.toml could not be read. */
  name?: string;
}

interface Psr4Rule {
  prefix: string;
  dirs: string[];
}

const TS_CONFIG_NAMES = ['tsconfig.json', 'jsconfig.json'];
const JS_EXTS = [
  '.ts',
  '.tsx',
  '.d.ts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.mts',
  '.cts',
  '.vue',
  '.svelte',
  '.json',
];
const JS_EXT_SWAP: Record<string, string[]> = {
  '.js': ['.ts', '.tsx', '.d.ts'],
  '.jsx': ['.tsx'],
  '.mjs': ['.mts', '.d.mts'],
  '.cjs': ['.cts', '.d.cts'],
};
/** TypeScript 5.5 `${configDir}` template in `paths` / `baseUrl`. */
const CONFIG_DIR_RE = /^\$\{configDir\}\/*/;
const BUILD_DIR_RE = /^(?:\.\/)?(?:dist|build|lib|out|esm|cjs|es|types)\//;

/** Options of {@link resolveImports}. */
export interface ResolveImportsOptions {
  /** Files whose imports are extracted and resolved. */
  files: ReadonlyArray<{ path: string; content: string }>;
  /** Every file of the reviewed revision (repo-relative, posix). */
  allFiles: Iterable<string>;
  /** Reads config files of the revision; without it only path-based resolution is done. */
  readFile?: ReadFile;
  signal?: AbortSignal;
}

/**
 * Extracts and resolves the imports of every given file. Result: file → sorted, unique repo-relative
 * targets that exist in `allFiles` (external packages and unresolvable specifiers are dropped).
 */
export async function resolveImports(opts: ResolveImportsOptions): Promise<Map<string, string[]>> {
  await initImportLexer();
  const resolver = new ImportResolver(new RepoIndex(opts.allFiles), opts.readFile);
  const specs = new Map<string, ImportSpec[]>();
  for (const f of opts.files) specs.set(f.path, extractImports(f.path, f.content));
  await resolver.prepare(specs, opts.signal);
  const contents = new Map(opts.files.map((f) => [f.path, f.content]));
  const out = new Map<string, string[]>();
  for (const [file, list] of specs) {
    // Keep Ctrl+C responsive between files of a big change.
    opts.signal?.throwIfAborted();
    await new Promise((r) => setImmediate(r));
    const targets = resolver.resolveFile(file, uniqueSpecs(list), contents.get(file) ?? '');
    targets.delete(file);
    out.set(file, [...targets].sort().slice(0, MAX_TARGETS_PER_FILE));
  }
  return out;
}

/** Each (scheme, specifier, kind of import) once: resolving the same specifier again cannot add targets. */
function uniqueSpecs(specs: ImportSpec[]): ImportSpec[] {
  const seen = new Set<string>();
  return specs.filter((s) => {
    const key = JSON.stringify(s);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

class ImportResolver {
  private readonly reads = new Map<string, Promise<string | undefined>>();
  private readonly limit = pLimit(8);
  private readonly tsConfigs = new Map<string, Promise<TsSettings>>();
  private readonly tsLoaded = new Map<string, TsSettings>();
  private readonly nearestTsCache = new Map<string, string | undefined>();
  private workspace: WorkspacePackage[] = [];
  private goModules: GoModule[] = [];
  private crates: RustCrate[] = [];
  private psr4: Psr4Rule[] = [];
  private pubspecs = new Map<string, string>();
  private readonly identifiers = new Map<string, Set<string>>();

  constructor(
    private readonly idx: RepoIndex,
    private readonly readFile?: ReadFile,
  ) {}

  private read(file: string): Promise<string | undefined> {
    if (!this.readFile || !this.idx.has(file)) return Promise.resolve(undefined);
    let p = this.reads.get(file);
    if (!p) {
      const reader = this.readFile;
      p = this.limit(async () => {
        try {
          const text = await reader(file);
          return text !== undefined && text.length <= MAX_CONFIG_BYTES ? text : undefined;
        } catch {
          return undefined;
        }
      });
      this.reads.set(file, p);
    }
    return p;
  }

  /** Loads the project configs the extracted imports need. */
  async prepare(specs: Map<string, ImportSpec[]>, signal?: AbortSignal): Promise<void> {
    const schemes = new Set<ImportScheme>();
    const bareJs = new Set<string>();
    const jsImporters: string[] = [];
    for (const [file, list] of specs) {
      let js = false;
      for (const s of list) {
        schemes.add(s.scheme);
        if (s.scheme === 'js') {
          js = true;
          const name = bareName(s.specifier);
          if (name) bareJs.add(name);
        }
      }
      if (js) jsImporters.push(file);
    }
    const manifests = {
      go: [] as string[],
      cargo: [] as string[],
      composer: [] as string[],
      pubspec: [] as string[],
      pkg: [] as string[],
    };
    for (const f of this.idx.set) {
      const base = posix.basename(f);
      if (base === 'go.mod') manifests.go.push(f);
      else if (base === 'Cargo.toml') manifests.cargo.push(f);
      else if (base === 'composer.json') manifests.composer.push(f);
      else if (base === 'pubspec.yaml') manifests.pubspec.push(f);
      else if (base === 'package.json') manifests.pkg.push(f);
    }
    for (const list of Object.values(manifests)) list.sort();
    // Crate dirs are known without reading; names need Cargo.toml.
    this.crates = manifests.cargo.map((f) => ({ dir: dirOf(f) }));

    const tasks: Array<Promise<void>> = [];
    if (schemes.has('js')) {
      const configs = new Set<string>();
      for (const f of jsImporters) {
        const cfg = this.nearestTsConfig(dirOf(f));
        if (cfg) configs.add(cfg);
      }
      for (const cfg of [...configs].sort()) tasks.push(this.loadTsConfig(cfg, 0, new Set()).then(() => {}));
      if (bareJs.size > 0) tasks.push(this.loadWorkspace(manifests.pkg, bareJs));
    }
    if (schemes.has('go')) tasks.push(this.loadGoModules(manifests.go.slice(0, 100)));
    if (schemes.has('rust-use')) tasks.push(this.loadCrates(manifests.cargo.slice(0, 200)));
    if (schemes.has('php')) tasks.push(this.loadComposer(manifests.composer.slice(0, 50)));
    if (schemes.has('dart')) tasks.push(this.loadPubspecs(manifests.pubspec.slice(0, 50)));
    await Promise.all(tasks);
    signal?.throwIfAborted();
  }

  // --- tsconfig / jsconfig -------------------------------------------------------------------------

  private nearestTsConfig(dir: string): string | undefined {
    if (this.nearestTsCache.has(dir)) return this.nearestTsCache.get(dir);
    let found: string | undefined;
    for (const name of TS_CONFIG_NAMES) {
      const candidate = child(dir, name);
      if (this.idx.has(candidate)) {
        found = candidate;
        break;
      }
    }
    if (!found && dir !== '.') found = this.nearestTsConfig(dirOf(dir));
    this.nearestTsCache.set(dir, found);
    return found;
  }

  private loadTsConfig(file: string, depth: number, seen: Set<string>): Promise<TsSettings> {
    let p = this.tsConfigs.get(file);
    if (!p) {
      p = this.readTsConfig(file, depth, seen).then((s) => {
        this.tsLoaded.set(file, s);
        return s;
      });
      this.tsConfigs.set(file, p);
    }
    return p;
  }

  /**
   * Reads a tsconfig and what it extends / references. `seen` and `budget` are shared by the whole
   * traversal from one root: every config is expanded at most once and at most `TS_CONFIG_BUDGET` files
   * are read, so fan-out `extends` arrays in repository JSON cannot make the traversal exponential.
   */
  private async readTsConfig(
    file: string,
    depth: number,
    seen: Set<string>,
    budget = { left: TS_CONFIG_BUDGET },
  ): Promise<TsSettings> {
    const dir = dirOf(file);
    const settings: TsSettings = { configDir: dir };
    seen.add(file);
    if (budget.left-- <= 0) return settings;
    const json = parseJsonc((await this.read(file)) ?? '');
    if (!isRecord(json)) return settings;
    const parents = [
      ...new Set(
        typeof json.extends === 'string' ? [json.extends] : Array.isArray(json.extends) ? json.extends : [],
      ),
    ];
    for (const ext of parents) {
      if (typeof ext !== 'string' || !ext.startsWith('.') || depth >= 5) continue;
      let target = joinInside(dir, ext);
      if (target && !this.idx.has(target) && !target.endsWith('.json')) target = `${target}.json`;
      if (!target || !this.idx.has(target) || seen.has(target)) continue;
      const parent = await this.readTsConfig(target, depth + 1, seen, budget);
      if (parent.baseUrl !== undefined) settings.baseUrl = parent.baseUrl;
      if (parent.rules) {
        settings.rules = parent.rules;
        settings.pathsBase = parent.pathsBase;
      }
    }
    const co = isRecord(json.compilerOptions) ? json.compilerOptions : {};
    if (typeof co.baseUrl === 'string') {
      const base = joinInside(dir, co.baseUrl.replace(CONFIG_DIR_RE, './'));
      if (base) settings.baseUrl = base;
    }
    if (isRecord(co.paths)) {
      settings.rules = parsePathRules(co.paths);
      settings.pathsBase = dir;
    }
    // Solution-style configs (`files: []` + `references`) keep their paths in the referenced configs.
    if (!settings.rules && settings.baseUrl === undefined && depth === 0 && Array.isArray(json.references)) {
      for (const ref of json.references) {
        if (!isRecord(ref) || typeof ref.path !== 'string') continue;
        const p = joinInside(dir, ref.path);
        if (!p) continue;
        const cfg = p.endsWith('.json') ? p : child(p, 'tsconfig.json');
        if (!this.idx.has(cfg) || seen.has(cfg)) continue;
        const r = await this.readTsConfig(cfg, depth + 1, seen, budget);
        if (r.rules || r.baseUrl !== undefined) {
          settings.rules = r.rules;
          settings.pathsBase = r.pathsBase;
          settings.baseUrl = r.baseUrl;
          break;
        }
      }
    }
    return settings;
  }

  private tsSettingsFor(importer: string): TsSettings | undefined {
    const cfg = this.nearestTsConfig(dirOf(importer));
    return cfg ? this.tsLoaded.get(cfg) : undefined;
  }

  // --- manifests -----------------------------------------------------------------------------------

  private async loadWorkspace(pkgFiles: string[], bare: Set<string>): Promise<void> {
    let candidates = pkgFiles;
    if (pkgFiles.length > 64) {
      const lastSegments = new Set([...bare].map((n) => n.slice(n.lastIndexOf('/') + 1)));
      candidates = pkgFiles.filter((f) => lastSegments.has(posix.basename(dirOf(f))));
    }
    const loaded = await Promise.all(
      candidates.slice(0, 200).map(async (f) => {
        const json = parseJsonc((await this.read(f)) ?? '');
        if (!isRecord(json) || typeof json.name !== 'string' || !bare.has(json.name)) return undefined;
        return workspacePackage(json, dirOf(f));
      }),
    );
    this.workspace = loaded.filter((p): p is WorkspacePackage => p !== undefined);
  }

  private async loadGoModules(files: string[]): Promise<void> {
    const loaded = await Promise.all(
      files.map(async (f) => {
        const m = /^[ \t]*module[ \t]+"?([^\s"]+)"?/m.exec((await this.read(f)) ?? '');
        return m ? { dir: dirOf(f), module: m[1]! } : undefined;
      }),
    );
    this.goModules = loaded
      .filter((m): m is GoModule => m !== undefined)
      .sort((a, b) => b.module.length - a.module.length || a.module.localeCompare(b.module));
  }

  private async loadCrates(files: string[]): Promise<void> {
    this.crates = await Promise.all(
      files.map(async (f): Promise<RustCrate> => {
        const dir = dirOf(f);
        try {
          const toml = parseToml((await this.read(f)) ?? '');
          const pkg = isRecord(toml.package) ? toml.package : undefined;
          const lib = isRecord(toml.lib) ? toml.lib : undefined;
          const name = typeof lib?.name === 'string' ? lib.name : pkg?.name;
          return { dir, name: typeof name === 'string' ? name.replace(/-/g, '_') : undefined };
        } catch {
          return { dir };
        }
      }),
    );
  }

  private async loadComposer(files: string[]): Promise<void> {
    const rules: Psr4Rule[] = [];
    for (const f of files) {
      const json = parseJsonc((await this.read(f)) ?? '');
      if (!isRecord(json)) continue;
      for (const section of [json.autoload, json['autoload-dev']]) {
        if (!isRecord(section) || !isRecord(section['psr-4'])) continue;
        for (const [prefix, value] of Object.entries(section['psr-4'])) {
          if (rules.length >= MAX_PATH_RULES) break;
          const dirs = (typeof value === 'string' ? [value] : Array.isArray(value) ? value : [])
            .filter((d): d is string => typeof d === 'string')
            .slice(0, MAX_TARGETS_PER_RULE)
            .map((d) => (d === '' ? dirOf(f) : joinInside(dirOf(f), d)))
            .filter((d): d is string => d !== undefined);
          if (dirs.length) rules.push({ prefix: prefix.replace(/^\\+/, ''), dirs });
        }
      }
    }
    this.psr4 = rules.sort((a, b) => b.prefix.length - a.prefix.length || a.prefix.localeCompare(b.prefix));
  }

  private async loadPubspecs(files: string[]): Promise<void> {
    for (const f of files) {
      const m = /^name:[ \t]*['"]?([\w]+)/m.exec((await this.read(f)) ?? '');
      if (m && !this.pubspecs.has(m[1]!)) this.pubspecs.set(m[1]!, dirOf(f));
    }
  }

  // --- resolution ----------------------------------------------------------------------------------

  resolveFile(file: string, specs: ImportSpec[], content: string): Set<string> {
    const out = new Set<string>();
    const add = (t: string | undefined) => {
      if (t && this.idx.has(t)) out.add(t);
    };
    const kind = sourceKind(file);
    for (const spec of specs) {
      try {
        switch (spec.scheme) {
          case 'js':
            add(this.resolveJs(file, spec.specifier));
            break;
          case 'python':
            for (const t of this.resolvePython(file, spec)) add(t);
            break;
          case 'go':
            for (const t of this.resolveGo(spec.specifier)) add(t);
            break;
          case 'jvm':
            for (const t of this.resolveJvm(file, spec, content)) add(t);
            break;
          case 'csharp':
            for (const t of this.resolveCsharp(file, spec, content)) add(t);
            break;
          case 'php':
            add(this.resolvePhp(file, spec.specifier));
            break;
          case 'php-file':
            add(this.probeExact([joinInside(dirOf(file), spec.specifier), joinInside('.', spec.specifier)]));
            break;
          case 'ruby-relative':
            add(this.resolveRubyRelative(file, spec.specifier));
            break;
          case 'ruby':
            add(this.resolveRuby(file, spec.specifier));
            break;
          case 'rust-mod':
            add(this.resolveRustMod(file, spec.specifier));
            break;
          case 'rust-use':
            add(this.resolveRustUse(file, spec.specifier));
            break;
          case 'c':
            add(this.resolveC(file, spec));
            break;
          case 'dart':
            add(this.resolveDart(file, spec.specifier));
            break;
        }
      } catch {
        // a pathological specifier never breaks the graph
      }
    }
    // Same-package classes need no import (JVM, C#, PHP namespaces): link siblings the file mentions.
    if (kind === 'jvm' || kind === 'csharp' || kind === 'php') {
      for (const t of this.mentionedIn(file, content, this.idx.filesIn(dirOf(file)))) add(t);
    }
    return out;
  }

  private probeExact(candidates: Array<string | undefined>): string | undefined {
    return candidates.find((c): c is string => c !== undefined && this.idx.has(c));
  }

  /** JS/TS module probing: exact file, TS source for `.js` specifiers, extensions, then `index.*`. */
  private probeJs(base: string | undefined, directoryOnly = false): string | undefined {
    if (base === undefined) return undefined;
    const clean = base.replace(/[?#].*$/, '');
    if (!directoryOnly && clean !== '.') {
      if (this.idx.has(clean)) return clean;
      const ext = posix.extname(clean);
      const swaps = JS_EXT_SWAP[ext];
      if (swaps) {
        const stem = clean.slice(0, -ext.length);
        for (const s of swaps) if (this.idx.has(stem + s)) return stem + s;
      }
      for (const e of JS_EXTS) if (this.idx.has(clean + e)) return clean + e;
    }
    for (const e of JS_EXTS) {
      const index = child(clean, `index${e}`);
      if (this.idx.has(index)) return index;
    }
    return undefined;
  }

  private resolveJs(importer: string, spec: string): string | undefined {
    if (spec.startsWith('./') || spec.startsWith('../') || spec === '.' || spec === '..') {
      const directoryOnly = spec === '.' || spec === '..' || spec.endsWith('/');
      return this.probeJs(joinInside(dirOf(importer), spec), directoryOnly);
    }
    if (spec.startsWith('/') || /^[a-z][\w+.-]*:/i.test(spec)) return undefined; // absolute, node:, http:, …
    const ts = this.tsSettingsFor(importer);
    if (ts?.rules) {
      const base = ts.baseUrl ?? ts.pathsBase ?? ts.configDir;
      let best: { rule: TsPathRule; star: string } | undefined;
      for (const rule of ts.rules) {
        if (rule.wildcard) {
          if (
            spec.length >= rule.prefix.length + rule.suffix.length &&
            spec.startsWith(rule.prefix) &&
            spec.endsWith(rule.suffix) &&
            (!best || rule.prefix.length > best.rule.prefix.length)
          ) {
            best = { rule, star: spec.slice(rule.prefix.length, spec.length - rule.suffix.length) };
          }
        } else if (spec === rule.prefix) {
          best = { rule, star: '' };
          break;
        }
      }
      if (best) {
        for (const target of best.rule.targets) {
          const sub = target.replace('*', best.star);
          const resolved = CONFIG_DIR_RE.test(sub)
            ? joinInside(ts.configDir, sub.replace(CONFIG_DIR_RE, ''))
            : joinInside(base, sub);
          const hit = this.probeJs(resolved);
          if (hit) return hit;
        }
      }
    }
    if (ts?.baseUrl !== undefined) {
      const hit = this.probeJs(joinInside(ts.baseUrl, spec));
      if (hit) return hit;
    }
    const name = bareName(spec);
    const pkg = name ? this.workspace.find((p) => p.name === name) : undefined;
    return pkg ? this.resolveWorkspace(pkg, spec.slice(name!.length).replace(/^\//, '')) : undefined;
  }

  private resolveWorkspace(pkg: WorkspacePackage, subpath: string): string | undefined {
    const key = subpath ? `./${subpath}` : '.';
    const targets: string[] = [...(pkg.exports.get(key) ?? [])];
    for (const [pattern, list] of pkg.exports) {
      const star = pattern.indexOf('*');
      if (star < 0) continue;
      const pre = pattern.slice(0, star);
      const post = pattern.slice(star + 1);
      if (key.startsWith(pre) && key.endsWith(post) && key.length >= pre.length + post.length) {
        const m = key.slice(pre.length, key.length - post.length);
        targets.push(...list.map((t) => t.replace('*', m)));
      }
    }
    if (!subpath) targets.push(...pkg.entries);
    for (const t of targets) {
      const hit =
        this.probeJs(joinInside(pkg.dir, t)) ??
        (BUILD_DIR_RE.test(t)
          ? this.probeJs(joinInside(pkg.dir, t.replace(BUILD_DIR_RE, 'src/')))
          : undefined);
      if (hit) return hit;
    }
    return subpath
      ? (this.probeJs(joinInside(pkg.dir, subpath)) ?? this.probeJs(joinInside(pkg.dir, `src/${subpath}`)))
      : (this.probeJs(joinInside(pkg.dir, 'src/index')) ?? this.probeJs(joinInside(pkg.dir, 'index')));
  }

  private resolvePython(importer: string, spec: ImportSpec): string[] {
    const m = /^(\.*)(.*)$/.exec(spec.specifier)!;
    const dots = m[1]!.length;
    const mod = m[2]!;
    const names = spec.names ?? [];
    const out: string[] = [];
    if (dots > 0) {
      let base: string | undefined = dirOf(importer);
      for (let i = 1; i < dots && base !== undefined; i++) base = base === '.' ? undefined : dirOf(base);
      if (base === undefined) return [];
      const modPath = mod ? joinInside(base, mod.replace(/\./g, '/')) : base;
      if (!modPath) return [];
      const own = this.pythonFile(modPath);
      if (own) out.push(own);
      for (const n of names) {
        const sub = this.pythonFile(child(modPath, n));
        if (sub) out.push(sub);
      }
      return out;
    }
    const own = this.findPythonModule(importer, mod);
    if (own) out.push(own);
    for (const n of names) {
      const sub = this.findPythonModule(importer, `${mod}.${n}`);
      if (sub) out.push(sub);
    }
    return out;
  }

  private pythonFile(modPath: string): string | undefined {
    if (modPath === '.') return this.probeExact(['__init__.py']);
    return this.probeExact([
      `${modPath}.py`,
      `${modPath}/__init__.py`,
      `${modPath}.pyi`,
      `${modPath}/__init__.pyi`,
    ]);
  }

  /** Absolute module → file, trying source roots: repo root, the importer's own root, src/lib/python/app. */
  private findPythonModule(importer: string, dotted: string): string | undefined {
    const segs = dotted.split('.');
    const rel = segs.join('/');
    const candidates = this.idx
      .pythonModules(segs.at(-1)!)
      .filter((c) => c.mod === rel || c.mod.endsWith(`/${rel}`))
      .sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
    let best: { file: string; score: number } | undefined;
    for (const c of candidates) {
      const prefix = c.mod.slice(0, c.mod.length - rel.length).replace(/\/$/, '');
      let score = 0;
      if (prefix === '') score = 3;
      else if (isUnder(importer, prefix)) score = 2 + prefix.length / 10_000;
      else if (['src', 'lib', 'python', 'app', 'source'].includes(posix.basename(prefix))) score = 1;
      else if (candidates.length === 1 && segs.length > 1) score = 0.5;
      if (score > 0 && (!best || score > best.score)) best = { file: c.file, score };
    }
    return best?.file;
  }

  private goFilesIn(dir: string): string[] {
    return this.idx
      .filesIn(dir)
      .filter((f) => f.endsWith('.go') && !f.endsWith('_test.go'))
      .sort()
      .slice(0, MAX_PACKAGE_FILES);
  }

  private resolveGo(spec: string): string[] {
    for (const mod of this.goModules) {
      if (spec === mod.module || spec.startsWith(`${mod.module}/`)) {
        const dir = spec === mod.module ? mod.dir : joinInside(mod.dir, spec.slice(mod.module.length + 1));
        return dir ? this.goFilesIn(dir) : [];
      }
    }
    // Without go.mod data: match the trailing path of a domain-qualified import against repo dirs.
    if (this.goModules.length > 0 || !spec.split('/')[0]!.includes('.')) return [];
    const segs = spec.split('/');
    for (let k = Math.min(segs.length - 1, 4); k >= 2; k--) {
      const dirs = this.idx.dirsEndingWith(segs.slice(-k).join('/'));
      if (dirs.length === 1) return this.goFilesIn(dirs[0]!);
    }
    return [];
  }

  private identifiersOf(file: string, content: string): Set<string> {
    let ids = this.identifiers.get(file);
    if (!ids) {
      ids = new Set(content.match(/\b[A-Z][A-Za-z0-9_]*/g) ?? []);
      this.identifiers.set(file, ids);
    }
    return ids;
  }

  /** Files among `candidates` (same family as `file`) whose class name `file` mentions. */
  private mentionedIn(file: string, content: string, candidates: string[]): string[] {
    const kind = sourceKind(file);
    const ids = this.identifiersOf(file, content);
    return candidates
      .filter((c) => c !== file && sourceKind(c) === kind && ids.has(stemOf(c)) && stemOf(c).length > 2)
      .sort()
      .slice(0, MAX_PACKAGE_FILES);
  }

  /** Files whose path without extension ends with `rel` and whose extension belongs to `kind`. */
  private classFiles(rel: string, kind: SourceKind): string[] {
    const stem = posix.basename(rel);
    const out: string[] = [];
    for (const ext of Object.keys(KIND_BY_EXT)) {
      if (KIND_BY_EXT[ext] !== kind) continue;
      for (const f of this.idx.byBasename(stem + ext)) {
        const noExt = f.slice(0, -ext.length);
        if (noExt === rel || noExt.endsWith(`/${rel}`)) out.push(f);
      }
    }
    return out.sort();
  }

  private resolveJvm(importer: string, spec: ImportSpec, content: string): string[] {
    const segs = spec.specifier.split('.');
    if (spec.wildcard) {
      const dirs = this.idx.dirsEndingWith(segs.join('/')).sort();
      return this.mentionedIn(
        importer,
        content,
        dirs.flatMap((d) => this.idx.filesIn(d)),
      );
    }
    // a.b.C, a.b.C.Inner, a.b.C.staticMember → the longest prefix that names a file
    for (let k = segs.length; k >= Math.max(1, segs.length - 2); k--) {
      const files = this.classFiles(segs.slice(0, k).join('/'), 'jvm');
      if (files.length) return files.slice(0, 5);
    }
    return [];
  }

  private resolveCsharp(importer: string, spec: ImportSpec, content: string): string[] {
    const segs = spec.specifier.split('.');
    if (!spec.wildcard) {
      for (let k = segs.length; k >= Math.max(1, segs.length - 1); k--) {
        const files = this.classFiles(segs.slice(0, k).join('/'), 'csharp');
        if (files.length) return files.slice(0, 5);
      }
      return [];
    }
    // Namespaces usually mirror folders, often without the root namespace: try the longest suffix.
    for (let k = segs.length; k >= 1; k--) {
      const dirs = this.idx.dirsEndingWith(segs.slice(segs.length - k).join('/')).sort();
      if (dirs.length === 0) continue;
      return this.mentionedIn(
        importer,
        content,
        dirs.flatMap((d) => this.idx.filesIn(d)),
      );
    }
    return [];
  }

  private resolvePhp(importer: string, fqcn: string): string | undefined {
    for (const rule of this.psr4) {
      if (!fqcn.startsWith(rule.prefix)) continue;
      const rel = `${fqcn.slice(rule.prefix.length).replace(/\\/g, '/')}.php`;
      const hit = this.probeExact(rule.dirs.map((d) => joinInside(d, rel)));
      if (hit) return hit;
    }
    const segs = fqcn.split('\\');
    for (let k = Math.min(segs.length, 3); k >= 2; k--) {
      const files = this.classFiles(segs.slice(-k).join('/'), 'php');
      if (files.length) return nearest(importer, files);
    }
    return undefined;
  }

  private resolveRubyRelative(importer: string, spec: string): string | undefined {
    const base = joinInside(dirOf(importer), spec);
    return base ? this.probeExact([base.endsWith('.rb') ? base : `${base}.rb`, base]) : undefined;
  }

  private resolveRuby(importer: string, spec: string): string | undefined {
    if (spec.startsWith('.')) return this.resolveRubyRelative(importer, spec);
    const file = spec.endsWith('.rb') ? spec : `${spec}.rb`;
    const direct = this.probeExact([joinInside('lib', file), joinInside('.', file), joinInside('app', file)]);
    if (direct) return direct;
    const inLib = this.idx
      .byBasename(posix.basename(file))
      .filter((f) => f.endsWith(`/lib/${file}`))
      .sort();
    return inLib.length ? nearest(importer, inLib) : undefined;
  }

  private crateOf(file: string): { crate: RustCrate; src: string; segs?: string[] } | undefined {
    let crate: RustCrate | undefined;
    for (const c of this.crates) {
      if (isUnder(file, c.dir) && (!crate || c.dir.length > crate.dir.length)) crate = c;
    }
    if (!crate) return undefined;
    const src = child(crate.dir, 'src');
    if (!file.startsWith(`${src}/`)) return { crate, src };
    const segs = file
      .slice(src.length + 1)
      .replace(/\.rs$/, '')
      .split('/');
    if (segs.at(-1) === 'mod') segs.pop();
    else if (segs.length === 1 && (segs[0] === 'lib' || segs[0] === 'main')) segs.pop();
    return { crate, src, segs };
  }

  private rustModuleFile(src: string, segs: string[], minK: number): string | undefined {
    for (let k = segs.length; k >= Math.max(1, minK); k--) {
      const p = child(src, segs.slice(0, k).join('/'));
      const hit = this.probeExact([`${p}.rs`, `${p}/mod.rs`]);
      if (hit) return hit;
    }
    return minK <= 0 ? this.probeExact([child(src, 'lib.rs'), child(src, 'main.rs')]) : undefined;
  }

  private resolveRustMod(importer: string, name: string): string | undefined {
    const base = posix.basename(importer);
    const dir = ['mod.rs', 'lib.rs', 'main.rs'].includes(base)
      ? dirOf(importer)
      : child(dirOf(importer), stemOf(importer));
    return this.probeExact([child(dir, `${name}.rs`), child(dir, `${name}/mod.rs`)]);
  }

  private resolveRustUse(importer: string, spec: string): string | undefined {
    const segs = spec.split('::').filter((s) => s && s !== '*');
    const head = segs[0];
    if (!head) return undefined;
    const own = this.crateOf(importer);
    let src: string;
    let base: string[];
    let rest: string[];
    if (head === 'crate' || head === 'self' || head === 'super') {
      if (!own?.segs) return undefined;
      src = own.src;
      base = head === 'crate' ? [] : [...own.segs];
      let i = head === 'crate' ? 1 : 0;
      if (head === 'self') i = 1;
      while (segs[i] === 'super') {
        if (base.length === 0) return undefined;
        base.pop();
        i++;
      }
      rest = segs.slice(i).filter((s) => s !== 'self');
    } else {
      const crate = this.crates.find((c) => c.name === head);
      if (!crate) return undefined;
      src = child(crate.dir, 'src');
      base = [];
      rest = segs.slice(1).filter((s) => s !== 'self');
    }
    return this.rustModuleFile(src, [...base, ...rest], base.length);
  }

  private resolveC(importer: string, spec: ImportSpec): string | undefined {
    const rel = spec.specifier;
    if (!spec.system) {
      const direct = this.probeExact([joinInside(dirOf(importer), rel), joinInside('.', rel)]);
      if (direct) return direct;
    } else if (!rel.includes('/')) return undefined; // <stdio.h>: never a repository file
    const files = this.idx
      .byBasename(posix.basename(rel))
      .filter((f) => f === rel || f.endsWith(`/${rel}`))
      .sort();
    return files.length ? nearest(importer, files) : undefined;
  }

  private resolveDart(importer: string, spec: string): string | undefined {
    if (spec.startsWith('dart:')) return undefined;
    if (spec.startsWith('package:')) {
      const m = /^package:(\w+)\/(.+)$/.exec(spec);
      const dir = m ? this.pubspecs.get(m[1]!) : undefined;
      return dir !== undefined ? this.probeExact([joinInside(child(dir, 'lib'), m![2]!)]) : undefined;
    }
    return this.probeExact([joinInside(dirOf(importer), spec)]);
  }
}

/** Package name of a bare JS specifier (`@scope/pkg/sub` → `@scope/pkg`, `lodash/fp` → `lodash`). */
function bareName(spec: string): string | undefined {
  if (
    !spec ||
    spec.startsWith('.') ||
    spec.startsWith('/') ||
    spec.startsWith('#') ||
    /^[a-z][\w+.-]*:/i.test(spec)
  ) {
    return undefined;
  }
  const segs = spec.split('/');
  if (spec.startsWith('@')) return segs.length >= 2 ? `${segs[0]}/${segs[1]}` : undefined;
  return segs[0];
}

/**
 * Limits for resolution driven by repository config (`paths` targets × specifiers, PSR-4 dirs × `use`
 * statements): generous for real monorepos, bounded for crafted configs.
 */
const MAX_PATH_RULES = 2_000;
const MAX_TARGETS_PER_RULE = 16;

function parsePathRules(paths: Record<string, unknown>): TsPathRule[] {
  const rules: TsPathRule[] = [];
  for (const [pattern, value] of Object.entries(paths).slice(0, MAX_PATH_RULES)) {
    const targets = (Array.isArray(value) ? value : [])
      .filter((t): t is string => typeof t === 'string')
      .slice(0, MAX_TARGETS_PER_RULE);
    if (!targets.length) continue;
    const star = pattern.indexOf('*');
    rules.push(
      star < 0
        ? { prefix: pattern, suffix: '', wildcard: false, targets }
        : { prefix: pattern.slice(0, star), suffix: pattern.slice(star + 1), wildcard: true, targets },
    );
  }
  return rules;
}

/** First string found in a conditional `exports` value, preferring source/types/import. */
function exportTarget(value: unknown, depth = 0): string | undefined {
  if (typeof value === 'string') return value;
  if (depth > 4) return undefined;
  if (Array.isArray(value)) {
    for (const v of value) {
      const t = exportTarget(v, depth + 1);
      if (t) return t;
    }
    return undefined;
  }
  if (!isRecord(value)) return undefined;
  for (const key of ['source', 'types', 'import', 'module', 'default', 'require', 'node']) {
    const t = exportTarget(value[key], depth + 1);
    if (t) return t;
  }
  return undefined;
}

function workspacePackage(json: Record<string, unknown>, dir: string): WorkspacePackage {
  const entries: string[] = [];
  for (const field of ['source', 'types', 'typings', 'module', 'main']) {
    const v = json[field];
    if (typeof v === 'string') entries.push(v);
  }
  const exports = new Map<string, string[]>();
  const add = (key: string, value: unknown) => {
    const t = exportTarget(value);
    if (t) exports.set(key, [t]);
  };
  const ex = json.exports;
  if (typeof ex === 'string' || Array.isArray(ex)) add('.', ex);
  else if (isRecord(ex)) {
    const subpaths = Object.keys(ex).filter((k) => k.startsWith('.'));
    if (subpaths.length === 0) add('.', ex);
    for (const k of subpaths) add(k, ex[k]);
  }
  return { name: json.name as string, dir, entries, exports };
}
