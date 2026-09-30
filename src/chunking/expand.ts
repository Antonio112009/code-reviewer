import path from 'node:path';
import type { GitRepo } from '../git/repo';
import type { Chunk, ChunkPart, ExpandLevel, ImpactEntry, ReviewUnit } from '../types';
import { SOURCE_EXTENSIONS, sourceKind } from './imports';
import { clipLine } from './render';
import { estimateTokens } from './tokens';

/**
 * Related unchanged code for each chunk ("expand"): where the changed declarations are used, what the new
 * code calls, and — at `deep` — who calls those users. The review sees how the change is used without having
 * to search for it. Everything here reads the reviewed revision only; names are identifiers taken from the
 * code and searched as fixed strings, and every regex is bounded (the code under review is untrusted).
 */
/** A declaration the change touched. */
export interface ChangedSymbol {
  name: string;
  file: string;
  /** `removed`: no longer declared; `signature`: its declaration line changed; `body`: code inside it changed. */
  kind: 'removed' | 'signature' | 'body';
  /** File-local (a C/C++ `static` function): other files cannot use it. */
  local?: boolean;
}

/** One line of the reviewed revision that mentions a searched name. */
export interface Match {
  path: string;
  line: number;
  text: string;
}

/** Read access to the reviewed revision. */
export interface ExpandSource {
  /** Lines of source files that contain any of `names` as a whole word (at most a few per file). */
  search(names: string[]): Promise<Match[]>;
  read(path: string): Promise<string | undefined>;
}

export interface ExpandOptions {
  level: Exclude<ExpandLevel, 'off'>;
  /** Most tokens of related code per chunk. */
  maxTokens(chunk: Chunk): number;
  /** Files of the change: reviewed anyway, never added as related code. */
  changed: ReadonlySet<string>;
  signal?: AbortSignal;
}

export interface ExpandStats {
  symbols: number;
  /** Names used in too many files to say anything specific (`get`, `id`, …). */
  tooCommon: string[];
  files: number;
  tokens: number;
  /** Impact map lines added (all chunks). */
  impact: number;
}

/** Longest line the declaration patterns look at. */
const MAX_LINE = 400;
/** How far up an enclosing declaration is searched for. */
const MAX_ENCLOSING_SCAN = 300;
/** Names shorter than this are too generic to search for. */
const MIN_NAME = 3;
/** A name found in more files than this is left out as too common. */
const MAX_FILES_PER_NAME = 20;
const MAX_SITES_PER_FILE = 3;
const LIMITS = {
  map: { symbols: 8, callees: 6, sites: 0, hops: 1 },
  refs: { symbols: 8, callees: 6, sites: 12, hops: 1 },
  deep: { symbols: 12, callees: 8, sites: 20, hops: 2 },
} as const;
/** Lines shown before and after a usage (the enclosing declaration's line is shown when close). */
const BEFORE = 4;
const AFTER = 3;
const DEFINITION_LINES = 16;
const MAX_PART_TOKENS = 900;
/** Places listed per name in the impact map; most tokens the map may take. */
const MAP_SITES = 6;
const MAP_MAX_TOKENS = 800;

/** Words that open control flow or expressions, never a declaration's name. */
const NOT_NAMES = new Set(
  'if for while switch catch return else do sizeof typeof new await yield function super this throw case when match elif with try delete assert print lambda and or not in is foreach using lock unless until loop defer go select struct class enum interface type const let var val fn func def public private protected static'.split(
    ' ',
  ),
);

/** Words a statement starts with: a line starting with one is a call or an expression, not a declaration. */
const STATEMENT =
  '(?!(?:return|await|throw|yield|new|else|case|echo|print|delete|typeof|not|and|or|go|defer)\\b)';
const MODIFIERS =
  '(?:(?:public|private|protected|internal|static|final|abstract|override|virtual|async|export|default|synchronized|inline|constexpr|extern|unsafe|pub|open|suspend|readonly|native|sealed|partial)\\s+){0,6}';
const PARAMS = '\\([^;]{0,300}\\)\\s*(?:const\\s*)?(?:(?:->|:|throws)\\s*[^;{}=]{0,120})?';

/** Bounded patterns for declaration lines of common languages, most specific first; group 1 is the name. */
const DECLARATIONS: RegExp[] = [
  // a signature with a type or keyword before the name (`static int f(…)`, `public void f(…)`, `fn f(…)`)
  new RegExp(
    `^\\s*${STATEMENT}${MODIFIERS}(?:[A-Za-z_][\\w:<>,.*&[\\]?]{0,80}\\s+){1,2}[*&]{0,2}([A-Za-z_$][\\w$]*)\\s*${PARAMS}\\{?\\s*$`,
  ),
  // a bare method signature opening its body (`refresh(token) {`)
  new RegExp(`^\\s*${STATEMENT}${MODIFIERS}([A-Za-z_$][\\w$]*)\\s*${PARAMS}\\{\\s*$`),
  // `class MYLIB_API Name {`: an identifier between `class` and the name is an export macro
  /\b(?:class|struct)\s+(?:[A-Za-z_]\w*\s+(?=[A-Za-z_]\w*\s*(?:[:{;]|final\b|$)))?([A-Za-z_$][\w$]*)/,
  /\b(?:function|def|fn|func|fun|interface|trait|enum|record|protocol|module|object|type)\s+([A-Za-z_$][\w$]*)/,
  /\bfunc\s*\([^)]{0,200}\)\s*([A-Za-z_]\w*)\s*[([]/,
  /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]{0,200})?=\s*(?:async\s+)?(?:function\b|\(|[A-Za-z_$][\w$]*\s*=>)/,
];

/** The name a line declares (function, method, class, type), if it looks like a declaration. */
export function declaredName(line: string): string | undefined {
  if (line.length > MAX_LINE) return undefined;
  for (const re of DECLARATIONS) {
    const name = re.exec(line)?.[1];
    if (name && !NOT_NAMES.has(name)) return name;
  }
  return undefined;
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

/** The declaration enclosing 1-based `lineNo` of `lines`: the closest one above, not indented deeper. */
export function enclosingDeclaration(
  lines: readonly string[],
  lineNo: number,
): { name: string; line: number } | undefined {
  const at = lines[lineNo - 1];
  const indent = at?.trim() ? indentOf(at) : Number.POSITIVE_INFINITY;
  for (let i = lineNo - 1; i >= Math.max(0, lineNo - 1 - MAX_ENCLOSING_SCAN); i--) {
    const l = lines[i]!;
    if (!l.trim() || indentOf(l) > indent) continue;
    const name = declaredName(l);
    if (name) return { name, line: i + 1 };
  }
  return undefined;
}

const RANK: Record<ChangedSymbol['kind'], number> = { removed: 3, signature: 2, body: 1 };

/** Declarations a diff unit removes, re-declares or changes inside (strongest kind per name). */
export function changedSymbols(unit: ReviewUnit): ChangedSymbol[] {
  if (unit.status === 'added' || unit.status === 'deleted' || unit.status === 'file') return [];
  if (!sourceKind(unit.path)) return [];
  const lines = (unit.content ?? '').split('\n');
  const declared = new Set<string>();
  for (const l of lines) {
    const n = declaredName(l);
    if (n) declared.add(n);
  }
  const found = new Map<string, { kind: ChangedSymbol['kind']; local: boolean }>();
  const c = sourceKind(unit.path) === 'c';
  const note = (name: string, kind: ChangedSymbol['kind'], declaration: string) => {
    const had = found.get(name);
    if (name.length < MIN_NAME || (had && RANK[kind] <= RANK[had.kind])) return;
    found.set(name, { kind, local: c && /^\s*static\b/.test(declaration) });
  };
  for (const h of unit.hunks) {
    for (const l of h.lines) {
      if (l.type === 'ctx') continue;
      const n = declaredName(l.text);
      if (n && l.type === 'del') note(n, declared.has(n) ? 'signature' : 'removed', l.text);
    }
    // Code changed inside a declaration: the first changed line of each run tells which one.
    let inRun = false;
    let nextNew = h.newStart;
    for (const l of h.lines) {
      if (l.type === 'ctx') {
        inRun = false;
        nextNew = (l.newLine ?? nextNew) + 1;
        continue;
      }
      if (!inRun && lines.length > 1) {
        const at = l.type === 'add' ? (l.newLine ?? nextNew) : nextNew;
        const decl = enclosingDeclaration(lines, Math.min(Math.max(at, 1), lines.length));
        if (decl) note(decl.name, 'body', lines[decl.line - 1]!);
      }
      inRun = true;
      if (l.type === 'add') nextNew = (l.newLine ?? nextNew) + 1;
    }
  }
  return [...found]
    .map(([name, { kind, local }]) => ({ name, file: unit.path, kind, ...(local ? { local } : {}) }))
    .sort((a, b) => RANK[b.kind] - RANK[a.kind] || cmp(a.name, b.name));
}

const CALL = /([A-Za-z_$][\w$]*)\s*\(/g;

/** Names called on `lines` (functions and methods, in order of first appearance; keywords left out). */
export function callsIn(lines: readonly string[]): string[] {
  const out = new Set<string>();
  for (const line of lines) {
    if (line.length > MAX_LINE) continue;
    for (const m of line.matchAll(CALL)) {
      const n = m[1]!;
      if (n.length >= MIN_NAME && !NOT_NAMES.has(n)) out.add(n);
    }
  }
  return [...out];
}

/** Functions the added lines call (most called first), minus names the chunk's own files declare. */
export function calledNames(units: readonly ReviewUnit[]): string[] {
  const own = new Set<string>();
  for (const u of units)
    for (const l of (u.content ?? '').split('\n')) {
      const n = declaredName(l);
      if (n) own.add(n);
    }
  const counts = new Map<string, number>();
  for (const u of units) {
    if (!sourceKind(u.path)) continue;
    for (const h of u.hunks) {
      for (const l of h.lines) {
        if (l.type !== 'add' || l.text.length > MAX_LINE) continue;
        for (const m of l.text.matchAll(CALL)) {
          const n = m[1]!;
          if (n.length < MIN_NAME || NOT_NAMES.has(n) || own.has(n)) continue;
          counts.set(n, (counts.get(n) ?? 0) + 1);
        }
      }
    }
  }
  return [...counts].sort((a, b) => b[1] - a[1] || cmp(a[0], b[0])).map(([n]) => n);
}

/**
 * Names called on the changed lines (added and removed) of a source unit, minus names the file declares
 * itself: the functions whose call sites this change touches.
 */
export function changedCalls(unit: ReviewUnit): Set<string> {
  const out = new Set<string>();
  if (unit.status === 'deleted' || !sourceKind(unit.path)) return out;
  const own = new Set<string>();
  for (const l of (unit.content ?? '').split('\n')) {
    const n = declaredName(l);
    if (n) own.add(n);
  }
  for (const h of unit.hunks) {
    for (const l of h.lines) {
      if (l.type === 'ctx' || l.text.length > MAX_LINE) continue;
      for (const m of l.text.matchAll(CALL)) {
        const n = m[1]!;
        if (n.length >= MIN_NAME && !NOT_NAMES.has(n) && !own.has(n)) out.add(n);
      }
    }
  }
  return out;
}

/** Whether `text` contains `name` as a whole identifier. */
function mentions(text: string, name: string): boolean {
  let i = text.indexOf(name);
  while (i >= 0) {
    const before = i > 0 ? text[i - 1]! : ' ';
    const after = text[i + name.length] ?? ' ';
    if (!/[\w$]/.test(before) && !/[\w$]/.test(after)) return true;
    i = text.indexOf(name, i + 1);
  }
  return false;
}

/** File names too generic to tell a module by (`index.ts`, `utils.py`): its directory names it instead. */
const GENERIC_STEMS = new Set([
  'index',
  'main',
  'mod',
  '__init__',
  'init',
  'lib',
  'utils',
  'util',
  'types',
  'common',
]);

/**
 * Whether `text` (the content of `from`) can refer to code in `file`: the same directory (package), or it
 * names the file's module — an import, an `#include`, a Go package qualifier.
 */
export function refersTo(from: string, text: string, file: string): boolean {
  const dir = path.posix.dirname(file);
  if (path.posix.dirname(from) === dir) return true;
  const stem = path.posix.basename(file).replace(/\.[^.]+$/, '');
  // A Go package is its directory; elsewhere the file is the module, unless its name says nothing.
  const byDir = sourceKind(file) === 'go' || GENERIC_STEMS.has(stem) || stem.length < MIN_NAME;
  const name = byDir ? path.posix.basename(dir) : stem;
  return name.length >= MIN_NAME && name !== '.' && mentions(text, name);
}

/** A site to show: a line of an unchanged file and why it matters. */
interface Site {
  path: string;
  line: number;
  why: string;
  /** The searched name (first-hop sites). */
  name?: string;
  /** The file the site must refer to (usages), or that must refer to it (definitions). */
  target: string;
  /** Show from the declaration down (definitions) instead of around the line (usages). */
  definition?: boolean;
  rank: number;
}

/** Adds related unchanged code to every chunk (in place, as `related` parts). */
export async function expandChunks(
  chunks: Chunk[],
  units: readonly ReviewUnit[],
  source: ExpandSource,
  opts: ExpandOptions,
): Promise<ExpandStats> {
  const limits = LIMITS[opts.level];
  const byPath = new Map(units.map((u) => [u.path, u]));
  const files = new Map<string, Promise<string[] | undefined>>();
  const linesOf = (p: string) => {
    let f = files.get(p);
    if (!f) {
      f = source.read(p).then((t) => (t === undefined ? undefined : t.split('\n')));
      files.set(p, f);
    }
    return f;
  };
  const stats: ExpandStats = { symbols: 0, tooCommon: [], files: 0, tokens: 0, impact: 0 };
  const tooCommon = new Set<string>();
  const usable = (p: string) => !opts.changed.has(p) && sourceKind(p) !== undefined && !VENDORED.test(p);

  /** Searches the names; drops the ones found in too many files. */
  const find = async (names: string[]): Promise<Map<string, Match[]>> => {
    const out = new Map<string, Match[]>();
    const wanted = names.filter((n) => !tooCommon.has(n));
    if (!wanted.length) return out;
    const matches = await source.search(wanted);
    for (const n of wanted) {
      const hits = matches.filter((m) => mentions(m.text, n));
      if (new Set(hits.map((m) => m.path)).size > MAX_FILES_PER_NAME) {
        tooCommon.add(n);
        continue;
      }
      out.set(n, hits);
    }
    return out;
  };

  for (const chunk of chunks) {
    opts.signal?.throwIfAborted();
    const own = chunk.files.map((f) => byPath.get(f)).filter((u): u is ReviewUnit => u !== undefined);
    const symbols = own.flatMap(changedSymbols).slice(0, limits.symbols);
    if (symbols.length) chunk.declarations = symbols.map(({ name, file, kind }) => ({ name, file, kind }));
    const callees = calledNames(own)
      .filter((n) => !symbols.some((s) => s.name === n))
      .slice(0, limits.callees);
    if (!symbols.length && !callees.length) continue;
    stats.symbols += symbols.length;

    const sites: Site[] = [];
    const found = await find([...symbols.map((s) => s.name), ...callees]);
    for (const s of symbols) {
      if (s.local) continue;
      for (const m of found.get(s.name) ?? []) {
        if (!usable(m.path) || declaredName(m.text) === s.name) continue;
        const what = s.kind === 'removed' ? 'removed' : s.kind === 'signature' ? 'redeclared' : 'changed';
        sites.push({
          path: m.path,
          line: m.line,
          why: `uses \`${s.name}\` (${what} in ${s.file})`,
          name: s.name,
          target: s.file,
          rank: RANK[s.kind] * 10,
        });
      }
    }
    for (const n of callees) {
      const defs = (found.get(n) ?? []).filter((m) => usable(m.path) && declaredName(m.text) === n);
      if (!defs.length || defs.length > 2) continue; // not found, or too ambiguous to pick one
      for (const m of defs) {
        sites.push({
          path: m.path,
          line: m.line,
          why: `defines \`${n}\` (called by the change)`,
          name: n,
          target: m.path,
          definition: true,
          rank: 5,
        });
      }
    }

    const plausible = async (s: Site): Promise<boolean> => {
      if (s.definition) return own.some((u) => refersTo(u.path, u.content ?? '', s.path));
      const lines = await linesOf(s.path);
      return lines !== undefined && refersTo(s.path, lines.join('\n'), s.target);
    };

    const impact = await impactMap(symbols, callees, sites, chunk, plausible, linesOf, tooCommon);
    if (impact.length) {
      chunk.impact = impact;
      chunk.tokens += estimateTokens(renderImpact(impact));
      stats.impact += impact.length;
    }
    if (!limits.sites) continue;

    // deep: who calls the code that uses the change
    if (limits.hops > 1) {
      const callers = new Map<string, { via: string; file: string }>();
      for (const s of sites.filter((x) => !x.definition)) {
        const lines = await linesOf(s.path);
        const decl = lines && enclosingDeclaration(lines, s.line);
        if (decl && decl.name.length >= MIN_NAME && !callers.has(decl.name)) {
          callers.set(decl.name, { via: s.why.replace(/^uses /, ''), file: s.path });
        }
      }
      const second = await find([...callers.keys()].slice(0, limits.symbols));
      for (const [name, { via, file }] of callers) {
        for (const m of second.get(name) ?? []) {
          if (!usable(m.path) || declaredName(m.text) === name) continue;
          sites.push({
            path: m.path,
            line: m.line,
            why: `calls \`${name}\`, which uses ${via}`,
            target: file,
            rank: 1,
          });
        }
      }
    }
    if (!sites.length) continue;

    const picked = await pickSites(sites, chunk, limits.sites, plausible);
    const parts = await renderSites(picked, linesOf, byPath);
    let room = opts.maxTokens(chunk);
    const related: Array<{ path: string; why: string }> = [];
    for (const { part, why } of parts) {
      if (part.tokens > room) continue;
      chunk.parts.push(part);
      chunk.tokens += part.tokens;
      room -= part.tokens;
      related.push({ path: part.path, why });
      stats.tokens += part.tokens;
    }
    if (related.length) {
      chunk.related = related;
      stats.files += related.length;
    }
  }
  stats.tooCommon = [...tooCommon].sort(cmp);
  return stats;
}

/**
 * The impact map of a chunk: for each changed declaration, the unchanged places that plausibly use it
 * (nearest first, with the enclosing declaration), and for each function the new code calls, where it is
 * defined. Names too common to search are left out; a removed or redeclared name with no uses says so.
 */
async function impactMap(
  symbols: readonly ChangedSymbol[],
  callees: readonly string[],
  sites: readonly Site[],
  chunk: Chunk,
  plausible: (s: Site) => Promise<boolean>,
  linesOf: (p: string) => Promise<string[] | undefined>,
  tooCommon: ReadonlySet<string>,
): Promise<ImpactEntry[]> {
  const dirs = new Set(chunk.files.map((f) => path.posix.dirname(f)));
  const near = (p: string) => (dirs.has(path.posix.dirname(p)) ? 0 : 1);
  const order = (a: Site, b: Site) => near(a.path) - near(b.path) || cmp(a.path, b.path) || a.line - b.line;
  const entries: ImpactEntry[] = [];
  const languages = new Set(chunk.files.map(family));
  const place = async (s: Site) => {
    const lines = await linesOf(s.path);
    const decl = !s.definition && lines ? enclosingDeclaration(lines, s.line) : undefined;
    return { path: s.path, line: s.line, ...(decl ? { in: decl.name } : {}) };
  };
  const named = new Set<string>();
  for (const sym of symbols) {
    if (sym.local || tooCommon.has(sym.name) || named.has(sym.name)) continue;
    named.add(sym.name);
    const mine = sites.filter((s) => !s.definition && s.name === sym.name && s.target === sym.file);
    const files: string[] = [];
    const listed: ImpactEntry['sites'] = [];
    for (const s of [...mine].sort(order)) {
      if (IMPORT_LINE.test((await linesOf(s.path))?.[s.line - 1] ?? '') || !(await plausible(s))) continue;
      if (!files.includes(s.path)) files.push(s.path);
      if (listed.length < MAP_SITES) listed.push(await place(s));
    }
    if (!listed.length && sym.kind === 'body') continue;
    const shown = new Set(listed.map((s) => s.path));
    entries.push({
      name: sym.name,
      kind: sym.kind,
      file: sym.file,
      sites: listed,
      more: files.filter((f) => !shown.has(f)).length,
    });
  }
  for (const name of callees) {
    // A definition in another language is a namesake, not what the change calls.
    const defs = sites.filter((s) => s.definition && s.name === name && languages.has(family(s.path)));
    const listed: ImpactEntry['sites'] = [];
    for (const s of defs) if (await plausible(s)) listed.push(await place(s));
    if (listed.length) entries.push({ name, kind: 'callee', sites: listed, more: 0 });
  }
  // Within the budget: the strongest entries (removed, redeclared) come first already.
  let tokens = 0;
  const kept: ImpactEntry[] = [];
  for (const e of entries) {
    tokens += estimateTokens(impactLine(e));
    if (tokens > MAP_MAX_TOKENS) break;
    kept.push(e);
  }
  return kept;
}

/** Language family of a source file: TypeScript and TSX call each other, C and C++ too. */
function family(file: string): string {
  const kind = sourceKind(file);
  return kind === 'jsx' ? 'js' : (kind ?? '');
}

/** An import line tells nothing the map's file name does not. */
const IMPORT_LINE = /^\s*(?:import|from|#\s*include|require|use|using)\b/;

function impactLine(e: ImpactEntry): string {
  const at = e.sites.map((s) => `${s.path}:${s.line}${s.in ? ` (in \`${s.in}\`)` : ''}`).join(', ');
  const more = e.more ? ` and ${e.more} more file${e.more === 1 ? '' : 's'}` : '';
  if (e.kind === 'callee') return `- \`${e.name}\` — called by the change; defined at ${at}`;
  const what = { removed: 'removed from', signature: 'declaration changed in', body: 'body changed in' }[
    e.kind
  ];
  const uses = e.sites.length ? `used at ${at}${more}` : 'no uses found in unchanged code';
  return `- \`${e.name}\` — ${what} ${e.file}; ${uses}`;
}

/** The impact map as prompt lines. */
export function renderImpact(entries: readonly ImpactEntry[]): string {
  return entries.map(impactLine).join('\n');
}

/** Vendored, generated and build output: never worth a place in the prompt. */
const VENDORED =
  /(^|\/)(node_modules|vendor|third_party|3rdparty|dist|build|out|target|\.git|__generated__|generated)\//;

/** Best plausible sites first (stronger kind, same directory as the chunk), at most a few per file. */
async function pickSites(
  sites: Site[],
  chunk: Chunk,
  max: number,
  plausible: (s: Site) => Promise<boolean>,
): Promise<Site[]> {
  const dirs = new Set(chunk.files.map((f) => path.posix.dirname(f)));
  const near = (p: string) => (dirs.has(path.posix.dirname(p)) ? 1 : 0);
  const seen = new Set<string>();
  const perFile = new Map<string, number>();
  const out: Site[] = [];
  for (const s of [...sites].sort(
    (a, b) => b.rank - a.rank || near(b.path) - near(a.path) || cmp(a.path, b.path) || a.line - b.line,
  )) {
    const key = `${s.path}:${s.line}`;
    const n = perFile.get(s.path) ?? 0;
    if (seen.has(key) || n >= MAX_SITES_PER_FILE) continue;
    seen.add(key);
    if (!(await plausible(s))) continue;
    perFile.set(s.path, n + 1);
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

/** One `related` part per file: numbered windows around its sites, with why they are shown. */
async function renderSites(
  sites: Site[],
  linesOf: (p: string) => Promise<string[] | undefined>,
  byPath: ReadonlyMap<string, ReviewUnit>,
): Promise<Array<{ part: ChunkPart; why: string }>> {
  const byFile = new Map<string, Site[]>();
  for (const s of sites) byFile.set(s.path, [...(byFile.get(s.path) ?? []), s]);
  const out: Array<{ part: ChunkPart; why: string }> = [];
  for (const [file, list] of byFile) {
    const lines = await linesOf(file);
    if (!lines) continue;
    const windows: Array<[number, number]> = [];
    for (const s of [...list].sort((a, b) => a.line - b.line)) {
      let start: number;
      let end: number;
      if (s.definition) {
        start = s.line;
        end = s.line + DEFINITION_LINES - 1;
      } else {
        const decl = enclosingDeclaration(lines, s.line);
        start = decl && s.line - decl.line <= 12 ? decl.line : s.line - BEFORE;
        end = s.line + AFTER;
      }
      start = Math.max(1, start);
      end = Math.min(lines.length, end);
      const last = windows.at(-1);
      if (last && start <= last[1] + 1) last[1] = Math.max(last[1], end);
      else windows.push([start, end]);
    }
    const width = String(lines.length).length;
    const body: string[] = [];
    for (const [s, e] of windows) {
      if (s > 1 || body.length) body.push('…');
      for (let n = s; n <= e; n++)
        body.push(`${String(n).padStart(width)}   ${clipLine(lines[n - 1] ?? '')}`);
    }
    const why = [...new Set(list.map((s) => s.why))].join('; ');
    const language = byPath.get(file)?.language ?? languageOf(file);
    let text = `## Related: ${file} — ${why}\n\`\`\`${language}\n${body.join('\n')}\n\`\`\`\n`;
    let tokens = estimateTokens(text);
    if (tokens > MAX_PART_TOKENS) {
      const keep = Math.max(3, Math.floor((body.length * MAX_PART_TOKENS) / tokens));
      text = `## Related: ${file} — ${why}\n\`\`\`${language}\n${body.slice(0, keep).join('\n')}\n… (${body.length - keep} more lines not shown)\n\`\`\`\n`;
      tokens = estimateTokens(text);
    }
    out.push({ part: { path: file, language, status: 'modified', text, tokens, role: 'related' }, why });
  }
  return out;
}

function languageOf(file: string): string {
  return path.posix.extname(file).slice(1).toLowerCase() || 'text';
}

/** Git access for {@link expandChunks}: word search and reads at commit `sha`. */
export function revisionSource(repo: GitRepo, sha: string): ExpandSource {
  return {
    async search(names) {
      const args = [
        'grep',
        '-n',
        '-z',
        '-w',
        '-F',
        '-I',
        '--no-color',
        '--max-count',
        String(MAX_SITES_PER_FILE),
      ];
      for (const n of names) args.push('-e', n);
      args.push(sha, '--', ...SOURCE_EXTENSIONS.map((e) => `*${e}`));
      const { ok, stdout } = await repo.tryRun(args);
      if (!ok && !stdout) return [];
      const prefix = `${sha}:`;
      const out: Match[] = [];
      for (const rec of stdout.split('\n')) {
        const [where, line, ...rest] = rec.split('\0');
        if (!where || !line || !where.startsWith(prefix)) continue;
        const n = Number(line);
        if (!Number.isInteger(n)) continue;
        out.push({ path: where.slice(prefix.length), line: n, text: rest.join('\0') });
      }
      return out;
    },
    read: (p) => repo.show(sha, p),
  };
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
