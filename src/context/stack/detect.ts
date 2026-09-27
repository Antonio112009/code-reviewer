import picomatch from 'picomatch';
import YAML from 'yaml';
import type { PackageRoot, TechCategory, TechHit } from '../../types';
import { detectLanguage } from '../../util/language';
import { compareVersions, formatVersion, type Version } from '../../util/versions';
import { type Catalogs, type Dep, lines, type ManifestInfo, normalizeDep, parseManifest } from './manifests';
import { classify, normalizeRel } from './read';
import {
  type Eco,
  type FileKind,
  IMAGE_WEIGHT,
  PUBLIC_ENV_PREFIXES,
  RULES,
  SCHEME_WEIGHT,
  type Signal,
  TEXT_RULES,
  type TextRule,
  VERSION_DEPS,
  VERSION_IMAGES,
} from './rules';
import { isTechId, type TechId, techCategory, techName } from './techs';
import { depSpecVersion, imageTag, imageTagVersion, leadingVersion, substituteArgs } from './versions';

/** Techs at or above this score are active (skills gated on them turn on). */
export const ACTIVE_SCORE = 0.6;
/** Techs between this and `ACTIVE_SCORE` are reported as weak evidence only. */
export const WEAK_SCORE = 0.3;
/** Weight multiplier for evidence under examples/, docs/, samples/ … */
const DAMPEN = 0.3;
const DAMPEN_DIRS = new Set([
  'examples',
  'example',
  'samples',
  'sample',
  'demo',
  'demos',
  'docs',
  'doc',
  'documentation',
]);
const MAX_REASONS = 10;
const MAX_WORKSPACE_DIRS = 500;
/** Categories whose evidence found at the repository root applies to every package. */
const REPO_WIDE: ReadonlySet<TechCategory> = new Set(['infra', 'ci', 'cloud']);

/** Language ids (from `detectLanguage`) that have a `lang.*` tech. */
export const LANG_TECH: Readonly<Record<string, TechId>> = {
  typescript: 'lang.typescript',
  javascript: 'lang.javascript',
  python: 'lang.python',
  php: 'lang.php',
  java: 'lang.java',
  kotlin: 'lang.kotlin',
  csharp: 'lang.csharp',
  go: 'lang.go',
  rust: 'lang.rust',
  c: 'lang.c',
  cpp: 'lang.cpp',
  ruby: 'lang.ruby',
  swift: 'lang.swift',
  scala: 'lang.scala',
  dart: 'lang.dart',
  elixir: 'lang.elixir',
  shell: 'lang.shell',
  sql: 'lang.sql',
};

/**
 * Makes a repository-derived string (path, dependency name) safe to show: reasons may reach logs and
 * prompts, so only a conservative character set survives (no whitespace, quotes or control chars).
 */
export function clean(s: string, max = 120): string {
  const t = s.replace(/[^\w@/.:+\-[\]*]/g, '_');
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

// ---------------------------------------------------------------------------
// Rule index (built once)
// ---------------------------------------------------------------------------

interface Indexed<S extends Signal = Signal> {
  tech: TechId;
  /** Stable identity of the signal: repeated matches of one signal count once (max weight). */
  key: string;
  sig: S;
}
type Of<K extends Signal['k']> = Extract<Signal, { k: K }>;

interface RuleIndex {
  fileExact: Map<string, Indexed<Of<'file'>>[]>;
  fileRegex: Indexed<Of<'file'>>[];
  fileRegexUnion: RegExp;
  ext: Map<string, Indexed<Of<'ext'>>[]>;
  dirs: Indexed<Of<'dir'>>[];
  depExact: Map<string, Indexed<Of<'dep'>>[]>;
  depRegex: Map<Eco, Indexed<Of<'dep'>>[]>;
  images: Indexed<Of<'image'>>[];
  schemes: Map<string, Indexed<Of<'scheme'>>[]>;
  env: Array<{ prefix: string; item: Indexed<Of<'env'>> }>;
  textByKind: Map<FileKind, Array<{ rule: TextRule; key: string }>>;
  implies: Map<TechId, TechId[]>;
}

let cachedIndex: RuleIndex | undefined;

/** Exact-match key for a dependency (NuGet ids are case-insensitive). */
function depKey(eco: Eco, name: string): string {
  return `${eco}\0${eco === 'nuget' ? name.toLowerCase() : name}`;
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

export function ruleIndex(): RuleIndex {
  if (cachedIndex) return cachedIndex;
  const idx: RuleIndex = {
    fileExact: new Map(),
    fileRegex: [],
    fileRegexUnion: /$^/,
    ext: new Map(),
    dirs: [],
    depExact: new Map(),
    depRegex: new Map(),
    images: [],
    schemes: new Map(),
    env: [],
    textByKind: new Map(),
    implies: new Map(),
  };
  RULES.forEach((rule) => {
    if (rule.implies) idx.implies.set(rule.id, rule.implies);
    rule.signals.forEach((sig, si) => {
      const key = `${rule.id}#${si}`;
      const tech = rule.id;
      switch (sig.k) {
        case 'file':
          if (typeof sig.name === 'string') push(idx.fileExact, sig.name, { tech, key, sig });
          else idx.fileRegex.push({ tech, key, sig });
          break;
        case 'ext':
          push(idx.ext, sig.ext, { tech, key, sig });
          break;
        case 'dir':
          idx.dirs.push({ tech, key, sig });
          break;
        case 'dep':
          if (typeof sig.name === 'string')
            push(idx.depExact, depKey(sig.eco, normalizeDep(sig.eco, sig.name)), { tech, key, sig });
          else {
            // NuGet ids are case-insensitive.
            const name =
              sig.eco === 'nuget' && !sig.name.flags.includes('i')
                ? new RegExp(sig.name.source, `${sig.name.flags}i`)
                : sig.name;
            push(idx.depRegex, sig.eco, { tech, key, sig: { ...sig, name } });
          }
          break;
        case 'image':
          idx.images.push({ tech, key, sig });
          break;
        case 'scheme':
          for (const name of sig.names) push(idx.schemes, name, { tech, key, sig });
          break;
        case 'env':
          for (const prefix of sig.prefixes) idx.env.push({ prefix, item: { tech, key, sig } });
          break;
      }
    });
  });
  // One combined pre-check per file name; only valid when no pattern relies on flags.
  const patterns = idx.fileRegex.map((f) => f.sig.name as RegExp);
  idx.fileRegexUnion = patterns.every((re) => re.flags === '')
    ? new RegExp(patterns.map((re) => `(?:${re.source})`).join('|') || '$^')
    : /(?:)/;
  TEXT_RULES.forEach((rule, i) => {
    for (const kind of rule.kinds) push(idx.textByKind, kind, { rule, key: `text#${i}` });
  });
  cachedIndex = idx;
  return idx;
}

// ---------------------------------------------------------------------------
// Evidence collection
// ---------------------------------------------------------------------------

interface Evidence {
  w: number;
  reasons: string[];
}
type TechEvidence = Map<string, Evidence>;

class Collector {
  readonly byPkg = new Map<string, Map<TechId, TechEvidence>>();
  readonly global = new Map<TechId, TechEvidence>();

  add(pkg: string, tech: TechId, key: string, w: number, reason: string, global = false): void {
    if (w <= 0) return;
    let techs: Map<TechId, TechEvidence>;
    if (global) techs = this.global;
    else {
      let m = this.byPkg.get(pkg);
      if (!m) {
        m = new Map();
        this.byPkg.set(pkg, m);
      }
      techs = m;
    }
    let ev = techs.get(tech);
    if (!ev) {
      ev = new Map();
      techs.set(tech, ev);
    }
    const cur = ev.get(key);
    if (!cur) ev.set(key, { w, reasons: [reason] });
    else if (w > cur.w) {
      // The strongest occurrence explains the signal; keep one more example.
      cur.w = w;
      cur.reasons = [reason, ...cur.reasons.filter((r) => r !== reason)].slice(0, 2);
    } else if (cur.reasons.length < 2 && !cur.reasons.includes(reason)) cur.reasons.push(reason);
  }
}

// ---------------------------------------------------------------------------
// Versions
// ---------------------------------------------------------------------------

/** Rank of version evidence: declarations beat lockfile fallbacks; within a rank the lowest wins. */
const DECLARED = 0;
const FALLBACK = 1;

interface VersionEvidence {
  v: Version;
  rank: number;
  /** `next in apps/web/package.json` */
  source: string;
}

/** Per package root, the best version evidence of each tech. */
class VersionCollector {
  readonly byPkg = new Map<string, Map<TechId, VersionEvidence>>();

  add(pkg: string, tech: TechId, v: Version | undefined, rank: number, source: string): void {
    if (!v) return;
    let m = this.byPkg.get(pkg);
    if (!m) {
      m = new Map();
      this.byPkg.set(pkg, m);
    }
    const cur = m.get(tech);
    if (!cur || rank < cur.rank || (rank === cur.rank && compareVersions(v, cur.v) < 0))
      m.set(tech, { v, rank, source });
  }
}

interface VersionIndex {
  exact: Map<string, TechId[]>;
  regex: Map<Eco, Array<{ re: RegExp; techs: TechId[] }>>;
}

let cachedVersionIndex: VersionIndex | undefined;

function versionIndex(): VersionIndex {
  if (cachedVersionIndex) return cachedVersionIndex;
  const idx: VersionIndex = { exact: new Map(), regex: new Map() };
  for (const v of VERSION_DEPS) {
    if (typeof v.name === 'string') {
      const key = depKey(v.eco, normalizeDep(v.eco, v.name));
      idx.exact.set(key, [...new Set([...(idx.exact.get(key) ?? []), ...v.techs])]);
    } else {
      const re =
        v.eco === 'nuget' && !v.name.flags.includes('i')
          ? new RegExp(v.name.source, `${v.name.flags}i`)
          : v.name;
      push(idx.regex, v.eco, { re, techs: v.techs });
    }
  }
  cachedVersionIndex = idx;
  return idx;
}

/** Techs whose version `dep`'s declared version is (see `VERSION_DEPS`). */
function versionTechs(dep: Dep): TechId[] {
  const idx = versionIndex();
  const out = new Set(idx.exact.get(depKey(dep.eco, dep.name)) ?? []);
  for (const { re, techs } of idx.regex.get(dep.eco) ?? [])
    if (re.test(dep.name)) for (const t of techs) out.add(t);
  return [...out];
}

/** `catalog:` / `catalog:<name>` → the spec from the nearest workspace root at or above `dir` that defines catalogs. */
function resolveCatalog(
  catalogs: Map<string, Catalogs>,
  dir: string,
  name: string,
  spec: string,
): string | undefined {
  const m = /^catalog:\s*([\w.@/-]*)$/.exec(spec.trim());
  if (!m) return spec;
  const catalog = m[1] || 'default';
  for (let d = dir; ; d = dirname(d)) {
    const found = catalogs.get(d);
    if (found) return found.get(catalog)?.get(name);
    if (!d) return undefined;
  }
}

/**
 * `version`, `versions` and a provenance reason for one tech: the lowest version over all package roots
 * with evidence, and the per-package map when packages differ.
 */
function versionsOf(
  id: TechId,
  vc: VersionCollector,
): { version: string; versions?: Record<string, string>; reason: string } | undefined {
  let best: VersionEvidence | undefined;
  const per: Array<[string, VersionEvidence]> = [];
  for (const [pkg, m] of vc.byPkg) {
    const ev = m.get(id);
    if (!ev) continue;
    per.push([pkg, ev]);
    if (!best || compareVersions(ev.v, best.v) < 0) best = ev;
  }
  if (!best) return undefined;
  const lowest = best;
  const version = formatVersion(lowest.v);
  const reason = `version ${version} (${lowest.source})`;
  if (per.every(([, ev]) => compareVersions(ev.v, lowest.v) === 0)) return { version, reason };
  per.sort(([a], [b]) => (a === b ? 0 : a === '.' ? -1 : b === '.' ? 1 : a < b ? -1 : 1));
  return {
    version,
    versions: Object.fromEntries(per.map(([pkg, ev]) => [pkg, formatVersion(ev.v)])),
    reason,
  };
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

export interface AnalyzeInput {
  /** Repo-relative posix paths (skip-dirs already removed), sorted. */
  files: string[];
  /** Contents of the allow-listed files that were read. */
  contents: Map<string, string>;
  notes: string[];
}

export interface AnalyzeResult {
  techs: TechHit[];
  packages: PackageRoot[];
  languages: Array<{ id: string; files: number }>;
  /** Files left after `.gitattributes` vendored/generated filtering. */
  files: number;
}

function dirname(file: string): string {
  const i = file.lastIndexOf('/');
  return i < 0 ? '' : file.slice(0, i);
}

function basename(file: string): string {
  return file.slice(file.lastIndexOf('/') + 1);
}

function dampenFactor(file: string): number {
  let start = 0;
  for (;;) {
    const slash = file.indexOf('/', start);
    if (slash < 0) return 1;
    if (DAMPEN_DIRS.has(file.slice(start, slash).toLowerCase())) return DAMPEN;
    start = slash + 1;
  }
}

const MANIFEST_NAMES = new Set([
  'package.json',
  'deno.json',
  'deno.jsonc',
  'pnpm-workspace.yaml',
  'pyproject.toml',
  'setup.py',
  'setup.cfg',
  'Pipfile',
  'go.mod',
  'go.work',
  'Cargo.toml',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'settings.gradle',
  'settings.gradle.kts',
  'build.sbt',
  'composer.json',
  'Gemfile',
  'pubspec.yaml',
  'mix.exs',
  'Package.swift',
]);

/** Package-root directory declared by `file` when it is a manifest ('' = repository root). */
function manifestRoot(file: string): string | undefined {
  const base = basename(file);
  const dir = dirname(file);
  if (MANIFEST_NAMES.has(base) || /\.(?:cs|fs|vb)proj$/.test(base)) return dir;
  if (classify(file) === 'requirements') return basename(dir) === 'requirements' ? dirname(dir) : dir;
  return undefined;
}

/**
 * Repository-supplied glob patterns are compiled to regexes: keep them short and simple so a hostile
 * pattern cannot produce a pathological matcher.
 */
function safeGlob(pattern: string): boolean {
  if (pattern.length > 200 || pattern.includes('\0')) return false;
  let stars = 0;
  for (const ch of pattern) if (ch === '*') stars++;
  // No extglobs (`@(a|b)`) and no brace ranges (`{1..9999}`): both can blow up the compiled matcher.
  return stars <= 6 && !/[()|]/.test(pattern) && !/\{[^}]*\.\./.test(pattern);
}

/** Matcher for files marked `linguist-vendored` / `linguist-generated` in the root `.gitattributes`. */
function vendoredMatcher(text: string | undefined): ((file: string) => boolean) | undefined {
  if (!text) return undefined;
  const globs: string[] = [];
  for (const raw of lines(text)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const [pattern, ...attrs] = line.split(/\s+/);
    if (!pattern || pattern.startsWith('!') || !safeGlob(pattern)) continue;
    const on = attrs.some((a) => /^linguist-(?:vendored|generated)(?:=true|=set)?$/.test(a));
    if (!on) continue;
    const anchored = pattern.replace(/\/$/, '').includes('/');
    const p = pattern.replace(/^\//, '').replace(/\/$/, '');
    if (!p) continue;
    const base = anchored ? p : `**/${p}`;
    globs.push(base, `${base}/**`);
    if (globs.length >= 100) break;
  }
  if (globs.length === 0) return undefined;
  return picomatch(globs, { dot: true });
}

/**
 * Workspace member dirs (relative to the repo) that exist in the listing. Members normally carry a
 * manifest and are package roots already; this adds members that do not (e.g. Gradle subprojects
 * configured from the root build). Recursive `**` patterns are ignored: they would turn every nested
 * source directory into a package.
 */
function expandWorkspaces(baseDir: string, patterns: string[], allDirs: Set<string>): string[] {
  const out = new Set<string>();
  const positive: string[] = [];
  const negative: string[] = [];
  for (const raw of patterns.slice(0, 100)) {
    if (typeof raw !== 'string' || !safeGlob(raw)) continue;
    const neg = raw.startsWith('!');
    const body = neg ? raw.slice(1) : raw;
    if (body.includes('**')) continue;
    const rel = normalizeRel(baseDir ? `${baseDir}/${body}` : body);
    if (!rel) continue;
    (neg ? negative : positive).push(rel);
  }
  if (positive.length === 0) return [];
  const isNeg = negative.length ? picomatch(negative, { dot: true }) : () => false;
  for (const p of positive) {
    if (/[*?[{]/.test(p)) {
      const m = picomatch(p, { dot: true });
      for (const d of allDirs) {
        if (out.size >= MAX_WORKSPACE_DIRS) break;
        if (m(d) && !isNeg(d)) out.add(d);
      }
    } else if (allDirs.has(p) && !isNeg(p)) out.add(p);
  }
  return [...out];
}

/** Normalised container image path: registry, `library/`, tag and digest removed. */
export function normalizeImage(ref: string): string | undefined {
  let s = ref.trim().toLowerCase();
  if (!s || s.length > 256) return undefined;
  const at = s.indexOf('@');
  if (at >= 0) s = s.slice(0, at);
  const colon = s.indexOf(':', s.lastIndexOf('/') + 1);
  if (colon >= 0) s = s.slice(0, colon);
  const parts = s.split('/');
  if (parts.length > 1 && /[.:]|^localhost$/.test(parts[0]!)) parts.shift();
  if (parts[0] === 'library') parts.shift();
  const out = parts.join('/');
  return /^[a-z0-9][a-z0-9._/-]*$/.test(out) ? out : undefined;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Collects image references (`image:` keys, GitLab `services:` lists) from a parsed YAML tree. */
function collectImages(node: unknown, out: string[], budget: { n: number }, parentKey = '', depth = 0): void {
  if (budget.n++ > 20_000 || depth > 24 || out.length > 200) return;
  if (Array.isArray(node)) {
    for (const item of node) {
      if (parentKey === 'services') {
        if (typeof item === 'string') out.push(item);
        else if (isObj(item) && typeof item.name === 'string') out.push(item.name);
      }
      collectImages(item, out, budget, '', depth + 1);
    }
    return;
  }
  if (!isObj(node)) return;
  for (const [k, v] of Object.entries(node)) {
    if (k === 'image') {
      if (typeof v === 'string') out.push(v);
      else if (isObj(v)) {
        if (typeof v.name === 'string') out.push(v.name);
        if (typeof v.repository === 'string') out.push(v.repository);
      }
    }
    collectImages(v, out, budget, k, depth + 1);
  }
}

/** Flattens a YAML tree into `a.b.c=value` lines (Spring `application.yml` → properties form). */
function flattenYaml(node: unknown, prefix: string, out: string[], depth = 0): void {
  if (out.length >= 5_000 || depth > 24) return;
  if (Array.isArray(node)) {
    for (const item of node) flattenYaml(item, prefix, out, depth + 1);
  } else if (isObj(node)) {
    for (const [k, v] of Object.entries(node)) flattenYaml(v, prefix ? `${prefix}.${k}` : k, out, depth + 1);
  } else if (prefix) {
    out.push(`${prefix}=${String(node).slice(0, 500)}`);
  }
}

function yamlDocs(text: string): unknown[] {
  const docs = YAML.parseAllDocuments(text, { prettyErrors: false, uniqueKeys: false });
  if (!Array.isArray(docs)) return [];
  const out: unknown[] = [];
  for (const d of docs) {
    if (d.errors.length > 0) continue;
    try {
      out.push(d.toJS({ maxAliasCount: 100 }));
    } catch {
      // alias bomb or unsupported content: ignore this document
    }
  }
  return out;
}

/** Build scripts and tool configs, excluded from the language share of a package. */
const TOOLING_FILE = /\.gradle\.kts$|\.config\.[cm]?[jt]s$|^\.[\w.-]*rc\.[cm]?js$|^Dangerfile\.[jt]s$/;

/**
 * Weight of the language evidence of a package: a single file never activates a language on its own
 * (the file's own language is always added by `techsForFile`), a handful does, and so does a clear
 * majority of the package's code files.
 */
function languageWeight(files: number, share: number): number {
  if (files >= 10) return 0.9;
  if (files >= 3 || (files >= 2 && share >= 0.5)) return 0.75;
  return 0.45;
}

const SCHEME_RE = /\b([a-z][a-z0-9]*)(?:\+[a-z0-9]+)?:\/\//gi;
const ENV_LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;
const FROM_LINE = /^\s*FROM\s+(?:--platform=\S+\s+)?(\S+)/i;
const ARG_LINE = /^\s*ARG\s+(\S.*)$/i;

/** Runs every rule over the listing and the file contents and scores techs per package. */
export function analyze(input: AnalyzeInput): AnalyzeResult {
  const idx = ruleIndex();
  const col = new Collector();

  const vendored = vendoredMatcher(input.contents.get('.gitattributes'));
  const files = vendored ? input.files.filter((f) => !vendored(f)) : input.files;
  const kept = vendored ? new Set(files) : undefined;

  // ----- directories and package roots -----
  const allDirs = new Set<string>();
  for (const f of files) {
    for (let d = dirname(f); d && !allDirs.has(d); d = dirname(d)) allDirs.add(d);
  }
  const roots = new Map<string, Set<string>>(); // dir ('' = root) → manifests
  roots.set('', new Set());
  for (const f of files) {
    const root = manifestRoot(f);
    if (root === undefined) continue;
    let m = roots.get(root);
    if (!m) {
      m = new Set();
      roots.set(root, m);
    }
    m.add(f);
  }

  // Parse manifests first: workspace declarations can add package roots.
  const parsed: Array<{ file: string; kind: FileKind; info: ManifestInfo }> = [];
  const catalogs = new Map<string, Catalogs>(); // dir ('' = root) → pnpm / Bun catalogs
  const readFiles = [...input.contents.keys()].filter((f) => !kept || kept.has(f)).sort();
  for (const file of readFiles) {
    const kind = classify(file);
    if (!kind) continue;
    const info = parseManifest(kind, file, input.contents.get(file)!);
    if (!info) continue;
    if (info.invalid) input.notes.push(`could not parse ${clean(file)}`);
    parsed.push({ file, kind, info });
    if (info.catalogs) {
      const dir = dirname(file);
      const cur = catalogs.get(dir);
      if (!cur) catalogs.set(dir, info.catalogs);
      else
        for (const [name, entries] of info.catalogs) {
          const into = cur.get(name) ?? new Map<string, string>();
          for (const [dep, spec] of entries) if (!into.has(dep)) into.set(dep, spec);
          cur.set(name, into);
        }
    }
    if (info.workspaces.length > 0) {
      for (const d of expandWorkspaces(dirname(file), info.workspaces, allDirs))
        if (!roots.has(d)) roots.set(d, new Set());
    }
  }

  const pkgMemo = new Map<string, string>();
  const pkgOfDir = (dir: string): string => {
    const hit = pkgMemo.get(dir);
    if (hit !== undefined) return hit;
    let d = dir;
    while (d && !roots.has(d)) d = dirname(d);
    const pkg = d || '.';
    pkgMemo.set(dir, pkg);
    return pkg;
  };
  const isRepoWide = (pkg: string, tech: TechId) => pkg === '.' && REPO_WIDE.has(techCategory(tech));

  // ----- file names, extensions, languages -----
  const langCounts = new Map<string, number>();
  const pkgLang = new Map<string, Map<string, [number, number]>>(); // pkg → lang → [normal, dampened]
  const extSeen = new Map<string, number>(); // `${pkg}\0${key}` → count
  for (const file of files) {
    const base = basename(file);
    const dir = dirname(file);
    const pkg = pkgOfDir(dir);
    const damp = dampenFactor(file);
    const exact = idx.fileExact.get(base);
    if (exact) {
      for (const it of exact) {
        if (it.sig.dir && !it.sig.dir.test(dir)) continue;
        col.add(pkg, it.tech, it.key, it.sig.w * damp, `file ${clean(file)}`, isRepoWide(pkg, it.tech));
      }
    }
    if (idx.fileRegexUnion.test(base)) {
      for (const it of idx.fileRegex) {
        if (!(it.sig.name as RegExp).test(base) || (it.sig.dir && !it.sig.dir.test(dir))) continue;
        col.add(pkg, it.tech, it.key, it.sig.w * damp, `file ${clean(file)}`, isRepoWide(pkg, it.tech));
      }
    }
    const dot = base.lastIndexOf('.');
    if (dot > 0) {
      const ext = base.slice(dot).toLowerCase();
      const byExt = idx.ext.get(ext);
      if (byExt) {
        for (const it of byExt) {
          const seenKey = `${pkg}\0${it.key}\0${damp}`;
          const n = (extSeen.get(seenKey) ?? 0) + 1;
          extSeen.set(seenKey, n);
          if (n === 1)
            col.add(pkg, it.tech, it.key, it.sig.w * damp, `*${ext} files`, isRepoWide(pkg, it.tech));
        }
      }
    }
    const lang = detectLanguage(file);
    if (lang === 'text') continue;
    langCounts.set(lang, (langCounts.get(lang) ?? 0) + 1);
    // Build scripts and tool configs (`build.gradle.kts`, `vite.config.ts`, `.eslintrc.js`) say little
    // about the language the package is written in.
    if (!LANG_TECH[lang] || TOOLING_FILE.test(base)) continue;
    let m = pkgLang.get(pkg);
    if (!m) {
      m = new Map();
      pkgLang.set(pkg, m);
    }
    const c = m.get(lang) ?? [0, 0];
    c[damp < 1 ? 1 : 0]++;
    m.set(lang, c);
  }
  for (const [pkg, m] of pkgLang) {
    let total = 0;
    for (const [normal] of m.values()) total += normal;
    for (const [lang, [normal, damped]] of m) {
      const tech = LANG_TECH[lang]!;
      const name = techName(tech);
      if (normal > 0) {
        const reason = `${normal} ${name} file${normal === 1 ? '' : 's'}`;
        col.add(pkg, tech, `lang:${lang}`, languageWeight(normal, normal / total), reason);
      }
      if (damped > 0) {
        const w = languageWeight(damped, 0) * DAMPEN;
        col.add(pkg, tech, `lang:${lang}:damped`, w, `${damped} ${name} example/doc files`);
      }
    }
  }
  for (const dir of [...allDirs].sort()) {
    for (const it of idx.dirs) {
      if (!it.sig.re.test(dir)) continue;
      const pkg = pkgOfDir(dir);
      col.add(
        pkg,
        it.tech,
        it.key,
        it.sig.w * dampenFactor(`${dir}/`),
        `directory ${clean(dir)}`,
        isRepoWide(pkg, it.tech),
      );
    }
  }

  // ----- dependencies and declared versions -----
  // Version evidence under examples/, docs/, … is ignored: an old sample must not lower the project's version.
  const vc = new VersionCollector();
  for (const { file, info } of parsed) {
    const pkg = pkgOfDir(manifestRoot(file) ?? dirname(file));
    const damp = dampenFactor(file);
    for (const dep of info.deps) {
      const hits = [...(idx.depExact.get(depKey(dep.eco, dep.name)) ?? [])];
      for (const it of idx.depRegex.get(dep.eco) ?? [])
        if ((it.sig.name as RegExp).test(dep.name)) hits.push(it);
      // npm package names cannot contain ':': `engines:node`, `packageManager:bun` are package.json fields.
      const label =
        dep.eco === 'npm' && dep.name.includes(':') ? 'field' : dep.dev ? 'dev dependency' : 'dependency';
      for (const it of hits) {
        const w = dep.dev ? (it.sig.wDev ?? Math.min(it.sig.w, 0.5)) : it.sig.w;
        const reason = `${label} ${clean(dep.name, 80)} (${clean(file)})`;
        col.add(pkg, it.tech, it.key, w * damp, reason, isRepoWide(pkg, it.tech));
      }
      if (dep.spec === undefined || damp < 1) continue;
      const techs = versionTechs(dep);
      if (techs.length === 0) continue;
      const spec = dep.eco === 'npm' ? resolveCatalog(catalogs, dirname(file), dep.name, dep.spec) : dep.spec;
      const v = depSpecVersion(dep.name, spec);
      for (const t of techs) vc.add(pkg, t, v, DECLARED, `${clean(dep.name, 80)} in ${clean(file)}`);
    }
    if (damp < 1) continue;
    for (const dep of info.locked ?? []) {
      const v = leadingVersion(dep.spec);
      for (const t of versionTechs(dep))
        vc.add(pkg, t, v, FALLBACK, `${clean(dep.name, 80)} in ${clean(file)}`);
    }
    const base = basename(file);
    for (const d of info.versions ?? []) {
      const source = d.what === base ? clean(file) : `${d.what} in ${clean(file)}`;
      vc.add(pkg, d.tech, d.version, d.fallback ? FALLBACK : DECLARED, source);
    }
  }

  // ----- file contents -----
  const addImage = (
    pkg: string,
    file: string,
    ref: string,
    source: keyof typeof IMAGE_WEIGHT,
    damp: number,
  ) => {
    const img = normalizeImage(ref);
    if (!img) return;
    for (const it of idx.images) {
      if (!it.sig.re.test(img)) continue;
      col.add(
        pkg,
        it.tech,
        `${it.key}@${source}`,
        IMAGE_WEIGHT[source] * damp,
        `image ${clean(img, 80)} (${clean(file)})`,
        pkg === '.',
      );
    }
    // Runtime / server version from the tag (Helm chart dependencies carry chart versions, not tags).
    const tag = source === 'chart' || damp < 1 ? undefined : imageTag(ref);
    if (!tag) return;
    for (const vi of VERSION_IMAGES) {
      if (vi.re.test(img))
        vc.add(pkg, vi.tech, imageTagVersion(tag, vi), DECLARED, `image ${clean(img, 80)} in ${clean(file)}`);
    }
  };
  const scanSchemes = (pkg: string, file: string, text: string, w: number) => {
    for (const m of text.matchAll(SCHEME_RE)) {
      const scheme = m[1]!.toLowerCase();
      for (const it of idx.schemes.get(scheme) ?? []) {
        col.add(pkg, it.tech, `${it.key}@${w}`, w, `URL scheme ${scheme}:// (${clean(file)})`, pkg === '.');
      }
    }
  };
  const applyText = (pkg: string, file: string, kind: FileKind, textLines: string[], damp: number) => {
    const rules = idx.textByKind.get(kind);
    if (!rules) return;
    for (const line of textLines) {
      for (const { rule, key } of rules) {
        const m = rule.re.exec(line);
        if (!m) continue;
        let tech: TechId | undefined;
        let value = '';
        if (typeof rule.map === 'string') tech = rule.map;
        else {
          value = (m[1] ?? '').toLowerCase();
          tech = Object.hasOwn(rule.map, value) ? rule.map[value] : undefined;
        }
        if (!tech) continue;
        const reason = value ? `${rule.what} "${value}" (${clean(file)})` : `${rule.what} (${clean(file)})`;
        const global = pkg === '.' && (kind === 'env' || REPO_WIDE.has(techCategory(tech)));
        col.add(pkg, tech, `${key}:${tech}`, rule.w * damp, reason, global);
      }
    }
  };

  for (const file of readFiles) {
    const kind = classify(file);
    if (!kind) continue;
    const text = input.contents.get(file)!;
    const pkg = pkgOfDir(dirname(file));
    const damp = dampenFactor(file);
    const schemeW = SCHEME_WEIGHT[kind];
    try {
      switch (kind) {
        case 'env': {
          for (const line of lines(text)) {
            const m = ENV_LINE.exec(line);
            if (!m) continue;
            let key = m[1]!.toUpperCase();
            for (const p of PUBLIC_ENV_PREFIXES) if (key.startsWith(p)) key = key.slice(p.length);
            for (const { prefix, item } of idx.env) {
              if (!key.startsWith(prefix)) continue;
              col.add(
                pkg,
                item.tech,
                item.key,
                item.sig.w * damp,
                `env key ${prefix}* (${clean(file)})`,
                pkg === '.',
              );
            }
            // Only the URL scheme of the value is looked at; the value itself is never kept.
            if (schemeW) scanSchemes(pkg, file, m[2] ?? '', schemeW * damp);
          }
          applyText(pkg, file, kind, lines(text), damp);
          break;
        }
        case 'compose':
        case 'github-workflow':
        case 'ci':
        case 'k8s':
        case 'chart': {
          const refs: string[] = [];
          const budget = { n: 0 };
          for (const doc of yamlDocs(text)) {
            if (kind === 'chart') {
              const deps = isObj(doc) && Array.isArray(doc.dependencies) ? doc.dependencies : [];
              for (const d of deps) if (isObj(d) && typeof d.name === 'string') refs.push(d.name);
            } else collectImages(doc, refs, budget);
          }
          const source =
            kind === 'compose' ? 'compose' : kind === 'chart' ? 'chart' : kind === 'k8s' ? 'k8s' : 'ci';
          for (const ref of refs) addImage(pkg, file, ref, source, damp);
          const textLines = lines(text);
          if (schemeW) for (const line of textLines) scanSchemes(pkg, file, line, schemeW * damp);
          applyText(pkg, file, kind, textLines, damp);
          break;
        }
        case 'dockerfile': {
          // `ARG NODE_VERSION=22` before the first FROM can be used in FROM lines (`FROM node:${NODE_VERSION}`).
          const args = new Map<string, string>();
          let inStage = false;
          for (const line of lines(text)) {
            const arg = inStage ? null : ARG_LINE.exec(line);
            if (arg?.[1]) {
              for (const token of arg[1].trim().split(/\s+/).slice(0, 20)) {
                const eq = token.indexOf('=');
                if (eq > 0 && args.size < 100)
                  args.set(token.slice(0, eq), token.slice(eq + 1).replace(/^(['"])(.*)\1$/, '$2'));
              }
              continue;
            }
            const m = FROM_LINE.exec(line);
            if (!m?.[1]) continue;
            inStage = true;
            addImage(pkg, file, substituteArgs(m[1], args) ?? m[1], 'dockerfile', damp);
          }
          break;
        }
        case 'spring-config': {
          const textLines: string[] = [];
          if (/\.ya?ml$/.test(file)) for (const doc of yamlDocs(text)) flattenYaml(doc, '', textLines);
          else textLines.push(...lines(text));
          const bounded = textLines.map((l) => (l.length > 2_000 ? l.slice(0, 2_000) : l));
          if (schemeW) for (const line of bounded) scanSchemes(pkg, file, line, schemeW * damp);
          applyText(pkg, file, kind, bounded, damp);
          break;
        }
        default: {
          const textLines = lines(text);
          if (schemeW) for (const line of textLines) scanSchemes(pkg, file, line, schemeW * damp);
          applyText(pkg, file, kind, textLines, damp);
        }
      }
    } catch {
      input.notes.push(`could not parse ${clean(file)}`);
    }
  }

  return score(col, roots, langCounts, files.length, idx, vc);
}

function score(
  col: Collector,
  roots: Map<string, Set<string>>,
  langCounts: Map<string, number>,
  fileCount: number,
  idx: RuleIndex,
  vc: VersionCollector,
): AnalyzeResult {
  const pkgDirs = [...roots.keys()]
    .map((d) => d || '.')
    .sort((a, b) => (a === '.' ? -1 : b === '.' ? 1 : a < b ? -1 : 1));
  const agg = new Map<TechId, { score: number; reasons: Map<string, number>; packages: Set<string> }>();
  const packages: PackageRoot[] = [];

  for (const dir of pkgDirs) {
    const own = col.byPkg.get(dir) ?? new Map<TechId, TechEvidence>();
    const techIds = new Set<TechId>([...own.keys(), ...col.global.keys()]);
    const scores = new Map<TechId, { score: number; reasons: Array<[string, number]> }>();
    for (const tech of techIds) {
      const merged = new Map<string, Evidence>();
      for (const src of [own.get(tech), col.global.get(tech)]) {
        if (!src) continue;
        for (const [key, ev] of src) {
          const cur = merged.get(key);
          if (!cur || ev.w > cur.w) merged.set(key, ev);
        }
      }
      let miss = 1;
      const reasons: Array<[string, number]> = [];
      for (const ev of merged.values()) {
        miss *= 1 - Math.min(ev.w, 0.999);
        for (const r of ev.reasons) reasons.push([r, ev.w]);
      }
      scores.set(tech, { score: 1 - miss, reasons });
    }
    // Implications (Next.js → React, Supabase → PostgreSQL, …); a few passes resolve chains.
    for (let pass = 0; pass < 3; pass++) {
      let changed = false;
      for (const [tech, s] of [...scores]) {
        for (const implied of idx.implies.get(tech) ?? []) {
          const cur = scores.get(implied);
          if (cur && cur.score >= s.score) continue;
          const reason: [string, number] = [`implied by ${techName(tech)}`, s.score];
          scores.set(implied, { score: s.score, reasons: [...(cur?.reasons ?? []), reason] });
          changed = true;
        }
      }
      if (!changed) break;
    }

    const active: string[] = [];
    for (const [tech, s] of scores) {
      const rounded = Math.round(s.score * 1000) / 1000;
      if (rounded < WEAK_SCORE) continue;
      if (rounded >= ACTIVE_SCORE) active.push(tech);
      let a = agg.get(tech);
      if (!a) {
        a = { score: 0, reasons: new Map(), packages: new Set() };
        agg.set(tech, a);
      }
      a.score = Math.max(a.score, rounded);
      a.packages.add(dir);
      for (const [r, w] of s.reasons) a.reasons.set(r, Math.max(a.reasons.get(r) ?? 0, w));
    }
    packages.push({
      dir,
      manifests: [...(roots.get(dir === '.' ? '' : dir) ?? [])].sort(),
      techs: active.sort(),
    });
  }

  const techs: TechHit[] = [...agg.entries()]
    .filter(([id]) => isTechId(id))
    .map(([id, a]) => {
      const ver = versionsOf(id, vc);
      const reasons = [...a.reasons.entries()]
        .sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1))
        .map(([r]) => r);
      const hit: TechHit = {
        id,
        name: techName(id),
        category: techCategory(id),
        score: a.score,
        // The version's provenance is always kept (last), within the reasons cap.
        reasons: ver ? [...reasons.slice(0, MAX_REASONS - 1), ver.reason] : reasons.slice(0, MAX_REASONS),
        packages: [...a.packages].sort(),
      };
      if (ver) {
        hit.version = ver.version;
        if (ver.versions) hit.versions = ver.versions;
      }
      return hit;
    })
    .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));

  const languages = [...langCounts.entries()]
    .map(([id, n]) => ({ id, files: n }))
    .sort((a, b) => b.files - a.files || (a.id < b.id ? -1 : 1));

  return { techs, packages, languages, files: fileCount };
}
