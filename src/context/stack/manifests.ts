import { parse as parseToml } from 'smol-toml';
import YAML from 'yaml';
import type { Version } from '../../util/versions';
import type { Eco, FileKind } from './rules';
import type { TechId } from './techs';
import {
  javaVersion,
  leadingVersion,
  nodeVersion,
  pythonVersion,
  specVersion,
  tfmVersion,
  toolVersion,
} from './versions';

/** A dependency declared in a manifest. Names are normalised per ecosystem (see `normalizeDep`). */
export interface Dep {
  eco: Eco;
  name: string;
  /** Dev / test / peer / optional-group scope: lower weight. */
  dev: boolean;
  /** Version requirement as declared (`^15.0.3`, `>=3.10,<4`, `~> 7.1`, `v1.22.3`, `catalog:`), if any. */
  spec?: string;
}

/** A language / runtime / SDK version declared outside the dependency lists (`requires-python`, `go 1.22`, `net8.0`). */
export interface VersionDecl {
  tech: TechId;
  version: Version;
  /** Where it was declared, for reasons: `requires-python`, `go directive`, `TargetFramework`, … */
  what: string;
  /** Lockfile evidence: used only when nothing else in the package declares a version. */
  fallback?: boolean;
}

/** pnpm / Bun catalogs: catalog name (`default` for plain `catalog:`) → package → version spec. */
export type Catalogs = Map<string, Map<string, string>>;

export interface ManifestInfo {
  deps: Dep[];
  /** Workspace member patterns (globs or paths) relative to the manifest's directory. */
  workspaces: string[];
  /** Language / runtime versions declared by the file. */
  versions?: VersionDecl[];
  /** Exact versions from a lockfile (`Gemfile.lock`): version evidence only, never detection evidence. */
  locked?: Dep[];
  /** Version catalogs referenced by `catalog:` dependency specs of the workspace. */
  catalogs?: Catalogs;
  /** The file could not be parsed (no deps were extracted). */
  invalid?: boolean;
}

/** Longest line we ever run a regex on. */
export const MAX_LINE = 2_000;
/** Longest version spec kept on a dependency. */
const MAX_SPEC = 200;
/** Caps on what one file may contribute. */
const MAX_DECLS = 100;
const MAX_CATALOG_ENTRIES = 2_000;
const MAX_LOCKED = 2_000;

/** Splits text into lines truncated to `MAX_LINE` chars (keeps every regex linear and bounded). */
export function lines(text: string): string[] {
  const out = text.split(/\r?\n/);
  for (let i = 0; i < out.length; i++) if (out[i]!.length > MAX_LINE) out[i] = out[i]!.slice(0, MAX_LINE);
  return out;
}

/** `requirements-dev.txt`, `test-requirements.txt`, `requirements/lint.txt`, … */
const DEV_REQUIREMENTS = /(?:^|[-_.])(?:dev|develop|test|tests|lint|docs?|ci)(?:[-_.]|$)/;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const entries = (v: unknown): Array<[string, unknown]> => (isObj(v) ? Object.entries(v) : []);
const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/** Canonical dependency name for lookups: PEP 503 for PyPI, `/vN` stripped for Go, lowercase where case-insensitive. */
export function normalizeDep(eco: Eco, name: string): string {
  const n = name.trim();
  switch (eco) {
    case 'pypi':
      return n.toLowerCase().replace(/[-_.]+/g, '-');
    case 'go':
      return n.replace(/\/v\d+$/, '');
    case 'composer':
    case 'gem':
    case 'hex':
    case 'pub':
      return n.toLowerCase();
    default:
      return n;
  }
}

/**
 * Parses one allow-listed manifest; undefined when `kind` is not a manifest kind. Never throws:
 * malformed input yields `{ invalid: true }` without deps.
 */
export function parseManifest(kind: FileKind, file: string, text: string): ManifestInfo | undefined {
  try {
    switch (kind) {
      case 'npm':
        return parsePackageJson(text);
      case 'pnpm-workspace': {
        const doc = YAML.parse(text) as unknown;
        const o = isObj(doc) ? doc : {};
        return withCatalogs({ deps: [], workspaces: strings(o.packages) }, readCatalogs(o));
      }
      case 'pyproject':
        return parsePyproject(text);
      case 'requirements':
        return {
          deps: parseRequirements(text, DEV_REQUIREMENTS.test(file.slice(file.lastIndexOf('/') + 1))),
          workspaces: [],
        };
      case 'pipfile':
        return parsePipfile(text);
      case 'gomod':
        return parseGoMod(text);
      case 'gowork':
        return { deps: [], workspaces: parseGoWork(text) };
      case 'cargo':
        return parseCargo(text);
      case 'pom':
        return parsePom(text);
      case 'gradle':
        return parseGradle(text);
      case 'gradle-settings':
        return { deps: [], workspaces: parseGradleSettings(text) };
      case 'gradle-catalog':
        return { deps: parseGradleCatalog(text), workspaces: [] };
      case 'csproj':
      case 'nuget-props':
        return parseCsproj(text, file, /\.Tests?\.[cfv][sb]proj$|[/.]tests?\//i.test(file));
      case 'composer':
        return parseComposer(text);
      case 'gemfile':
        return parseGemfile(text);
      case 'gemfile-lock':
        return parseGemfileLock(text);
      case 'pubspec':
        return parsePubspec(text);
      case 'mix':
        return parseMix(text);
      case 'version-file':
        return { deps: [], workspaces: [], versions: parseVersionFile(file, text) };
      case 'tool-versions':
        return { deps: [], workspaces: [], versions: parseToolVersions(text) };
      case 'swift-package':
        return { deps: [], workspaces: [], versions: parseSwiftPackage(text) };
      default:
        return undefined;
    }
  } catch {
    return { deps: [], workspaces: [], invalid: true };
  }
}

function add(out: Dep[], eco: Eco, name: string, dev: boolean, spec?: unknown): void {
  if (!name || name.length > 214) return;
  const dep: Dep = { eco, name: normalizeDep(eco, name), dev };
  if (typeof spec === 'string') {
    const s = spec.trim();
    if (s && s.length <= MAX_SPEC) dep.spec = s;
  }
  out.push(dep);
}

function pushVersion(
  out: VersionDecl[],
  tech: TechId,
  version: Version | undefined,
  what: string,
  fallback = false,
): void {
  if (!version || out.length >= MAX_DECLS) return;
  out.push(fallback ? { tech, version, what, fallback } : { tech, version, what });
}

/** Resolves `${name}` / `$(name)` references (a few levels deep, bounded in size). */
function resolveVars(
  value: string | undefined,
  vars: ReadonlyMap<string, string>,
  re: RegExp,
): string | undefined {
  if (value === undefined) return undefined;
  let v = value;
  for (let i = 0; i < 5 && v.includes('$'); i++) {
    const next = v.replace(re, (all, k: string) => vars.get(k) ?? all);
    if (next === v || next.length > 1_000) break;
    v = next;
  }
  return v;
}

// ----- npm -----

const RUNTIMES = ['node', 'bun', 'deno'];

/** Catalogs from `catalog` / `catalogs` keys of any of `sources` (pnpm-workspace.yaml, Bun's package.json). */
function readCatalogs(...sources: Obj[]): Catalogs | undefined {
  const out: Catalogs = new Map();
  let n = 0;
  const addCatalog = (name: string, value: unknown) => {
    if (!isObj(value)) return;
    let catalog = out.get(name);
    if (!catalog) {
      catalog = new Map();
      out.set(name, catalog);
    }
    for (const [dep, raw] of Object.entries(value)) {
      // YAML reads `lodash: 4` as a number; `3.10`-like floats cannot be recovered and are skipped.
      const spec = typeof raw === 'number' && Number.isInteger(raw) ? String(raw) : raw;
      if (typeof spec === 'string' && !catalog.has(dep) && n++ < MAX_CATALOG_ENTRIES) catalog.set(dep, spec);
    }
  };
  for (const src of sources) {
    addCatalog('default', src.catalog);
    for (const [name, value] of entries(src.catalogs)) addCatalog(name, value);
  }
  return out.size > 0 ? out : undefined;
}

function withCatalogs(info: ManifestInfo, catalogs: Catalogs | undefined): ManifestInfo {
  return catalogs ? { ...info, catalogs } : info;
}

function parsePackageJson(text: string): ManifestInfo {
  const pkg = JSON.parse(text) as unknown;
  if (!isObj(pkg)) return { deps: [], workspaces: [] };
  const deps: Dep[] = [];
  const section = (v: unknown, dev: boolean) => {
    for (const [k, spec] of entries(v)) add(deps, 'npm', k, dev, spec);
  };
  section(pkg.dependencies, false);
  section(pkg.optionalDependencies, false);
  section(pkg.devDependencies, true);
  section(pkg.peerDependencies, true);
  // Runtime declarations become pseudo-dependencies (npm package names cannot contain ':').
  const engines = isObj(pkg.engines) ? pkg.engines : {};
  for (const r of RUNTIMES)
    if (typeof engines[r] === 'string') add(deps, 'npm', `engines:${r}`, false, engines[r]);
  if (isObj(pkg.volta) && typeof pkg.volta.node === 'string')
    add(deps, 'npm', 'volta:node', false, pkg.volta.node);
  const runtime = isObj(pkg.devEngines) ? pkg.devEngines.runtime : undefined;
  for (const e of Array.isArray(runtime) ? runtime.slice(0, 10) : [runtime]) {
    if (isObj(e) && typeof e.name === 'string' && RUNTIMES.includes(e.name))
      add(deps, 'npm', `devEngines:${e.name}`, false, e.version);
  }
  const pm = typeof pkg.packageManager === 'string' ? /^([\w.-]+)@([^\s+]+)/.exec(pkg.packageManager) : null;
  if (pm) add(deps, 'npm', `packageManager:${pm[1]}`, false, pm[2]);
  const ws = pkg.workspaces;
  const workspaces = Array.isArray(ws) ? strings(ws) : isObj(ws) ? strings(ws.packages) : [];
  // Bun reads catalogs from `workspaces` or the top level of the root package.json.
  return withCatalogs({ deps, workspaces }, readCatalogs(isObj(ws) ? ws : {}, pkg));
}

// ----- Python -----

/**
 * Name and version part of a PEP 508 requirement: `Django[argon2]>=5.0 ; python_version>"3.9"` →
 * `Django`, `>=5.0`. Direct references (`pkg @ https://…`) and pip options (`--hash=…`) carry no version.
 */
function pep508(spec: string): { name: string; version?: string } | undefined {
  const m = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*(?:\[[^\]]*\])?(.*)$/.exec(spec);
  if (!m) return undefined;
  const name = m[1]!;
  let rest = m[2] ?? '';
  const semi = rest.indexOf(';');
  if (semi >= 0) rest = rest.slice(0, semi);
  rest = rest.trim();
  if (!rest || rest.startsWith('@')) return { name };
  const opt = rest.search(/\s-/);
  if (opt >= 0) rest = rest.slice(0, opt);
  rest = rest
    .replace(/\\$/, '')
    .replace(/^\(|\)$/g, '')
    .trim();
  return rest ? { name, version: rest } : { name };
}

function requirement(deps: Dep[], line: string, dev: boolean): void {
  const r = pep508(line);
  if (r) add(deps, 'pypi', r.name, dev, r.version);
}

function parseRequirements(text: string, dev: boolean): Dep[] {
  const deps: Dep[] = [];
  for (const raw of lines(text)) {
    const line = raw.replace(/\s#.*$/, '').trim();
    if (!line || line.startsWith('#') || line.startsWith('-')) continue;
    requirement(deps, line, dev);
  }
  return deps;
}

/** Version of a Poetry / Pipfile dependency: `"^2.0"` or `{ version = "^2.0", … }`. */
const tableSpec = (v: unknown): string | undefined => str(v) ?? (isObj(v) ? str(v.version) : undefined);

function parsePyproject(text: string): ManifestInfo {
  const doc = parseToml(text) as Obj;
  const deps: Dep[] = [];
  const versions: VersionDecl[] = [];
  const project = isObj(doc.project) ? doc.project : {};
  for (const s of strings(project.dependencies)) requirement(deps, s, false);
  for (const [, group] of entries(project['optional-dependencies']))
    for (const s of strings(group)) requirement(deps, s, true);
  for (const [, group] of entries(doc['dependency-groups']))
    for (const s of strings(group)) requirement(deps, s, true);
  pushVersion(versions, 'lang.python', specVersion(str(project['requires-python'])), 'requires-python');
  const tool = isObj(doc.tool) ? doc.tool : {};
  const poetry = isObj(tool.poetry) ? tool.poetry : {};
  for (const [k, v] of entries(poetry.dependencies)) {
    if (k.toLowerCase() === 'python')
      pushVersion(versions, 'lang.python', specVersion(tableSpec(v)), 'tool.poetry python');
    else add(deps, 'pypi', k, false, tableSpec(v));
  }
  for (const [k, v] of entries(poetry['dev-dependencies'])) add(deps, 'pypi', k, true, tableSpec(v));
  for (const [, g] of entries(poetry.group))
    if (isObj(g)) for (const [k, v] of entries(g.dependencies)) add(deps, 'pypi', k, true, tableSpec(v));
  for (const section of [tool.uv, tool.pdm]) {
    if (!isObj(section)) continue;
    for (const s of strings(section['dev-dependencies'])) requirement(deps, s, true);
  }
  const members = isObj(tool.uv) && isObj(tool.uv.workspace) ? strings(tool.uv.workspace.members) : [];
  return { deps, workspaces: members, versions };
}

function parsePipfile(text: string): ManifestInfo {
  const doc = parseToml(text) as Obj;
  const deps: Dep[] = [];
  const versions: VersionDecl[] = [];
  for (const [k, v] of entries(doc.packages)) add(deps, 'pypi', k, false, tableSpec(v));
  for (const [k, v] of entries(doc['dev-packages'])) add(deps, 'pypi', k, true, tableSpec(v));
  const requires = isObj(doc.requires) ? doc.requires : {};
  pushVersion(
    versions,
    'lang.python',
    leadingVersion(str(requires.python_version)),
    'Pipfile python_version',
  );
  pushVersion(
    versions,
    'lang.python',
    leadingVersion(str(requires.python_full_version)),
    'Pipfile python_full_version',
  );
  return { deps, workspaces: [], versions };
}

// ----- Go -----

function parseGoMod(text: string): ManifestInfo {
  const deps: Dep[] = [];
  const versions: VersionDecl[] = [];
  let inRequire = false;
  let hasModule = false;
  let go: Version | undefined;
  for (const raw of lines(text)) {
    const line = raw.trim();
    if (inRequire) {
      if (line.startsWith(')')) {
        inRequire = false;
        continue;
      }
    } else if (/^require\s*\(/.test(line)) {
      inRequire = true;
      continue;
    } else if (!line.startsWith('require ')) {
      if (/^module\s/.test(line)) hasModule = true;
      // The `go` directive is the module's language version: it gates language features and semantics
      // such as per-iteration loop variables (1.22); the `toolchain` line only picks the compiler.
      const directive = /^go\s+(\d+(?:\.\d+){0,2})/.exec(line);
      if (directive) go = leadingVersion(directive[1]);
      continue;
    }
    const m = /^(?:require\s+)?([\w.~-]+(?:\/[\w.~-]+)*)\s+(v\S+)(.*)$/.exec(line);
    if (m?.[1]) add(deps, 'go', m[1], /\/\/\s*indirect\b/.test(m[3] ?? ''), m[2]);
  }
  // "If the go directive is missing, go 1.16 is assumed." (go.dev/ref/mod)
  if (go) pushVersion(versions, 'lang.go', go, 'go directive');
  else if (hasModule) pushVersion(versions, 'lang.go', [1, 16], 'go directive (missing: 1.16 assumed)');
  return { deps, workspaces: [], versions };
}

function parseGoWork(text: string): string[] {
  const out: string[] = [];
  let inUse = false;
  for (const raw of lines(text)) {
    const line = raw.replace(/\/\/.*$/, '').trim();
    if (inUse) {
      if (line.startsWith(')')) inUse = false;
      else if (line) out.push(line.replace(/^"|"$/g, ''));
    } else if (/^use\s*\(/.test(line)) inUse = true;
    else {
      const m = /^use\s+"?([^\s"]+)"?/.exec(line);
      if (m?.[1]) out.push(m[1]);
    }
  }
  return out;
}

// ----- Rust -----

function cargoTable(deps: Dep[], table: unknown, dev: boolean): void {
  for (const [key, spec] of entries(table)) {
    const name = isObj(spec) && typeof spec.package === 'string' ? spec.package : key;
    add(deps, 'cargo', name, dev, tableSpec(spec));
    if (isObj(spec)) for (const f of strings(spec.features)) add(deps, 'cargo', `${name}[${f}]`, dev);
  }
}

function parseCargo(text: string): ManifestInfo {
  const doc = parseToml(text) as Obj;
  const deps: Dep[] = [];
  const versions: VersionDecl[] = [];
  cargoTable(deps, doc.dependencies, false);
  cargoTable(deps, doc['build-dependencies'], false);
  cargoTable(deps, doc['dev-dependencies'], true);
  const ws = isObj(doc.workspace) ? doc.workspace : {};
  cargoTable(deps, ws.dependencies, false);
  for (const [, t] of entries(doc.target)) {
    if (!isObj(t)) continue;
    cargoTable(deps, t.dependencies, false);
    cargoTable(deps, t['dev-dependencies'], true);
  }
  // MSRV; `rust-version.workspace = true` members inherit it from the workspace root's package.
  const pkg = isObj(doc.package) ? doc.package : {};
  const wsPkg = isObj(ws.package) ? ws.package : {};
  pushVersion(versions, 'lang.rust', leadingVersion(str(pkg['rust-version'])), 'rust-version');
  pushVersion(versions, 'lang.rust', leadingVersion(str(wsPkg['rust-version'])), 'workspace rust-version');
  return { deps, workspaces: strings(ws.members), versions };
}

// ----- JVM -----

/** Removes `<!-- … -->` comments in linear time. */
function stripXmlComments(text: string): string {
  let out = '';
  let pos = 0;
  for (;;) {
    const start = text.indexOf('<!--', pos);
    if (start < 0) return out + text.slice(pos);
    out += text.slice(pos, start);
    const end = text.indexOf('-->', start + 4);
    if (end < 0) return out;
    pos = end + 3;
  }
}

/** Yields the inner text of every `<tag>…</tag>` block (non-nested tags only), each capped at `cap` chars. */
function* xmlBlocks(text: string, tag: string, cap = 4096): Generator<string> {
  const open = `<${tag}>`;
  const close = `</${tag}>`;
  let pos = 0;
  for (;;) {
    const start = text.indexOf(open, pos);
    if (start < 0) return;
    const end = text.indexOf(close, start + open.length);
    if (end < 0) return;
    yield text.slice(start + open.length, Math.min(end, start + open.length + cap));
    pos = end + close.length;
  }
}

function xmlValue(block: string, tag: string): string | undefined {
  const start = block.indexOf(`<${tag}>`);
  if (start < 0) return undefined;
  const end = block.indexOf(`</${tag}>`, start);
  if (end < 0) return undefined;
  return block.slice(start + tag.length + 2, end).trim();
}

/**
 * Simple `<name>value</name>` elements (Maven `<properties>`, MSBuild properties); the first definition
 * wins. A linear scan: no regex backtracking on hostile input.
 */
function simpleElements(xml: string, into: Map<string, string> = new Map()): Map<string, string> {
  let pos = 0;
  while (into.size < 1_000) {
    const lt = xml.indexOf('<', pos);
    if (lt < 0) break;
    const gt = xml.indexOf('>', lt + 1);
    if (gt < 0) break;
    pos = gt + 1;
    if (gt - lt > 101) continue;
    const name = xml.slice(lt + 1, gt);
    if (!/^[A-Za-z_][\w.-]*$/.test(name)) continue; // closing tags, attributes, `<x/>`, `<?xml …?>`
    const next = xml.indexOf('<', pos);
    if (next < 0) break;
    if (next - pos > 200 || !xml.startsWith(`</${name}>`, next)) continue;
    if (!into.has(name)) into.set(name, xml.slice(pos, next).trim());
    pos = next + name.length + 3;
  }
  return into;
}

/** Attribute text of every `<Tag …>` start tag (attributes capped at 2,000 chars), in linear time. */
function* startTags(xml: string, tag: string): Generator<{ attrs: string; end: number }> {
  const open = `<${tag}`;
  let pos = 0;
  for (;;) {
    const start = xml.indexOf(open, pos);
    if (start < 0) return;
    pos = start + open.length;
    const next = xml[pos];
    if (next !== undefined && !/[\s/>]/.test(next)) continue; // `<PackageReferences`, `<PackageVersion>`-like names
    const gt = xml.indexOf('>', pos);
    if (gt < 0) return;
    if (gt - pos <= 2_000) yield { attrs: xml.slice(pos, gt), end: gt + 1 };
    pos = gt + 1;
  }
}

const MAVEN_VAR = /\$\{([\w.-]+)\}/g;
/** Maven properties that set the Java language level (Spring Boot's parent maps `java.version` to `maven.compiler.release`). */
const MAVEN_JAVA_PROPS = [
  'maven.compiler.release',
  'maven.compiler.source',
  'maven.compiler.target',
  'java.version',
];

function parsePom(text: string): ManifestInfo {
  const xml = stripXmlComments(text);
  const props = new Map<string, string>();
  for (const block of xmlBlocks(xml, 'properties', 64 * 1024)) simpleElements(block, props);
  const resolve = (v: string | undefined) => resolveVars(v, props, MAVEN_VAR);
  const deps: Dep[] = [];
  const versions: VersionDecl[] = [];
  const coord = (block: string, defaultGroup?: string) => {
    const g = xmlValue(block, 'groupId') ?? defaultGroup;
    const a = xmlValue(block, 'artifactId');
    return g && a ? `${g}:${a}` : undefined;
  };
  for (const block of xmlBlocks(xml, 'dependency')) {
    const c = coord(block);
    if (c)
      add(
        deps,
        'maven',
        c,
        /^(?:test)$/.test(xmlValue(block, 'scope') ?? ''),
        resolve(xmlValue(block, 'version')),
      );
  }
  for (const block of xmlBlocks(xml, 'parent')) {
    const c = coord(block);
    if (c) add(deps, 'maven', c, false, resolve(xmlValue(block, 'version')));
  }
  for (const block of xmlBlocks(xml, 'plugin')) {
    const c = coord(block, 'org.apache.maven.plugins');
    if (!c) continue;
    add(deps, 'maven', c, false, resolve(xmlValue(block, 'version')));
    if (c !== 'org.apache.maven.plugins:maven-compiler-plugin') continue;
    for (const tag of ['release', 'source', 'target'])
      pushVersion(
        versions,
        'lang.java',
        javaVersion(resolve(xmlValue(block, tag))),
        `maven-compiler-plugin ${tag}`,
      );
  }
  for (const key of MAVEN_JAVA_PROPS)
    pushVersion(versions, 'lang.java', javaVersion(resolve(props.get(key))), key);
  const workspaces: string[] = [];
  for (const m of xmlBlocks(xml, 'module')) workspaces.push(m.trim());
  return { deps, workspaces, versions };
}

const GRADLE_COORD = /['"]([\w.-]+):([\w.-]+)(?::([^'"\s]*))?['"]/g;
const GRADLE_MAP_COORD =
  /\bgroup\s*[:=]\s*['"]([\w.-]+)['"]\s*,\s*(?:module|name)\s*[:=]\s*['"]([\w.-]+)['"](?:\s*,\s*version\s*[:=]\s*['"]([^'"]+)['"])?/;
/** `id("x") version "1.0"`, `id 'x' version '1.0' apply false`, `id("x").version("1.0")` */
const GRADLE_PLUGIN =
  /\bid\s*\(?\s*['"]([\w.-]+)['"]\s*\)?\s*(?:\.\s*)?(?:version\s*\(?\s*['"]([^'"\s]+)['"])?/;
const GRADLE_KOTLIN_PLUGIN =
  /\bkotlin\s*\(\s*['"]([\w.-]+)['"]\s*\)\s*(?:\.\s*)?(?:version\s*\(?\s*['"]([^'"\s]+)['"])?/;
const GRADLE_APPLY = /\bapply\s*\(?\s*plugin\s*[:=]\s*['"]([\w.-]+)['"]/;
/** Java toolchain / release / compatibility settings (Gradle Groovy and Kotlin DSL). */
const GRADLE_JAVA: Array<[RegExp, string]> = [
  [/\bJavaLanguageVersion\.of\s*\(\s*['"]?(\d+)/, 'toolchain languageVersion'],
  [/\bjvmToolchain\s*\(\s*(\d+)\s*\)/, 'jvmToolchain'],
  [/\boptions\.release(?:\.set)?\s*(?:=\s*|\(\s*)(\d+)/, 'options.release'],
  [
    /\b(?:source|target)Compatibility\s*(?:=\s*)?(?:JavaVersion\.(?:VERSION_|toVersion\s*\(\s*['"]?)(\d+(?:[._]\d+)?)|['"]?(\d+(?:\.\d+)?)\b)/,
    'sourceCompatibility',
  ],
];

function parseGradle(text: string): ManifestInfo {
  const deps: Dep[] = [];
  const versions: VersionDecl[] = [];
  for (const line of lines(text)) {
    const trimmed = line.trim();
    if (trimmed.startsWith('//')) continue;
    const dev = /^(?:test|androidTest|integrationTest)\w*\s*[(\s'"]/.test(trimmed);
    for (const m of trimmed.matchAll(GRADLE_COORD))
      add(deps, 'maven', `${m[1]}:${m[2]}`, dev, m[3]?.split(/[:@]/)[0]);
    const map = GRADLE_MAP_COORD.exec(trimmed);
    if (map) add(deps, 'maven', `${map[1]}:${map[2]}`, dev, map[3]);
    const plugin = GRADLE_PLUGIN.exec(trimmed);
    if (plugin?.[1]) add(deps, 'maven', `plugin:${plugin[1]}`, false, plugin[2]);
    else {
      const applied = GRADLE_APPLY.exec(trimmed);
      if (applied?.[1]) add(deps, 'maven', `plugin:${applied[1]}`, false);
    }
    const kt = GRADLE_KOTLIN_PLUGIN.exec(trimmed);
    if (kt?.[1]) add(deps, 'maven', `plugin:org.jetbrains.kotlin.${kt[1]}`, false, kt[2]);
    for (const [re, what] of GRADLE_JAVA) {
      const m = re.exec(trimmed);
      if (m) pushVersion(versions, 'lang.java', javaVersion(m[1] ?? m[2]), what);
    }
  }
  return { deps, workspaces: [], versions };
}

function parseGradleSettings(text: string): string[] {
  const out: string[] = [];
  for (const line of lines(text)) {
    if (!/^\s*include\b/.test(line)) continue;
    for (const m of line.matchAll(/['"]:?([\w.:-]+)['"]/g)) out.push(m[1]!.replaceAll(':', '/'));
  }
  return out;
}

function parseGradleCatalog(text: string): Dep[] {
  const doc = parseToml(text) as Obj;
  const deps: Dep[] = [];
  const table = isObj(doc.versions) ? doc.versions : {};
  /** `"1.2"`, rich `{ require | strictly | prefer }`, or `version.ref = "key"` into `[versions]`. */
  const rich = (v: unknown) =>
    str(v) ?? (isObj(v) ? (str(v.require) ?? str(v.strictly) ?? str(v.prefer)) : undefined);
  const version = (v: unknown) =>
    isObj(v) && typeof v.ref === 'string'
      ? Object.hasOwn(table, v.ref)
        ? rich(table[v.ref])
        : undefined
      : rich(v);
  for (const [, spec] of entries(doc.libraries)) {
    if (typeof spec === 'string') {
      const [g, a, v] = spec.split(':');
      if (g && a) add(deps, 'maven', `${g}:${a}`, false, v);
    } else if (isObj(spec)) {
      if (typeof spec.module === 'string') add(deps, 'maven', spec.module, false, version(spec.version));
      else if (typeof spec.group === 'string' && typeof spec.name === 'string') {
        add(deps, 'maven', `${spec.group}:${spec.name}`, false, version(spec.version));
      }
    }
  }
  for (const [, spec] of entries(doc.plugins)) {
    if (typeof spec === 'string') {
      const [id, v] = spec.split(':');
      if (id) add(deps, 'maven', `plugin:${id}`, false, v);
    } else if (isObj(spec) && typeof spec.id === 'string') {
      add(deps, 'maven', `plugin:${spec.id}`, false, version(spec.version));
    }
  }
  return deps;
}

// ----- .NET -----

const MSBUILD_VAR = /\$\(([\w.-]+)\)/g;
const XML_ATTR = {
  Include: /\bInclude\s*=\s*(?:"([^"]*)"|'([^']*)')/,
  Update: /\bUpdate\s*=\s*(?:"([^"]*)"|'([^']*)')/,
  Version: /\bVersion\s*=\s*(?:"([^"]*)"|'([^']*)')/,
  VersionOverride: /\bVersionOverride\s*=\s*(?:"([^"]*)"|'([^']*)')/,
} as const;

function xmlAttr(attrs: string, name: keyof typeof XML_ATTR): string | undefined {
  const m = XML_ATTR[name].exec(attrs);
  return m ? (m[1] ?? m[2]) : undefined;
}

/** `.csproj` / `.fsproj` / `.vbproj`, `Directory.Packages.props`, `Directory.Build.props`. */
function parseCsproj(text: string, file: string, testProject: boolean): ManifestInfo {
  const xml = stripXmlComments(text);
  const props = simpleElements(xml);
  const resolve = (v: string | undefined) => resolveVars(v, props, MSBUILD_VAR);
  const deps: Dep[] = [];
  const versions: VersionDecl[] = [];
  const dev = testProject || /<IsTestProject>\s*true\s*<\/IsTestProject>/i.test(xml);
  for (const line of lines(xml)) {
    const sdk = /<Project\s+Sdk\s*=\s*"([\w.-]+)/.exec(line) ?? /<Sdk\s+Name\s*=\s*"([\w.-]+)/.exec(line);
    if (sdk?.[1]) add(deps, 'nuget', `sdk:${sdk[1]}`, false);
  }
  for (const tag of ['PackageReference', 'PackageVersion']) {
    for (const { attrs, end } of startTags(xml, tag)) {
      const name = xmlAttr(attrs, 'Include') ?? xmlAttr(attrs, 'Update');
      if (!name || !/^[\w.-]+$/.test(name)) continue;
      let version = xmlAttr(attrs, 'Version') ?? xmlAttr(attrs, 'VersionOverride');
      if (version === undefined && !attrs.trimEnd().endsWith('/')) {
        // <PackageReference Include="x"><Version>1.2.3</Version></PackageReference>
        const body = xml.slice(end, end + 500);
        const close = body.indexOf(`</${tag}`);
        version = xmlValue(close >= 0 ? body.slice(0, close) : body, 'Version');
      }
      add(deps, 'nuget', name, dev, resolve(version));
    }
  }
  // .NET version: lang.csharp (C# projects) and framework.aspnet (.NET / .NET Core only).
  const csharp = !/\.(?:fs|vb)proj$/i.test(file);
  for (const m of xml.matchAll(/<TargetFrameworks?(?:\s[^>]{0,300})?>([^<]{1,300})<\/TargetFrameworks?>/g)) {
    for (const tfm of (resolve(m[1]) ?? '').split(';').slice(0, 20)) {
      const t = tfmVersion(tfm);
      if (!t) continue;
      if (csharp) pushVersion(versions, 'lang.csharp', t.version, 'TargetFramework');
      if (t.modern) pushVersion(versions, 'framework.aspnet', t.version, 'TargetFramework');
    }
  }
  // Legacy (non-SDK) projects: <TargetFrameworkVersion>v4.7.2</TargetFrameworkVersion> (.NET Framework)
  const legacy = /<TargetFrameworkVersion>\s*v(\d+(?:\.\d+){0,2})\s*<\/TargetFrameworkVersion>/.exec(xml);
  if (legacy && csharp)
    pushVersion(versions, 'lang.csharp', leadingVersion(legacy[1]), 'TargetFrameworkVersion');
  return { deps, workspaces: [], versions };
}

// ----- PHP / Ruby / Dart / Elixir -----

function parseComposer(text: string): ManifestInfo {
  const pkg = JSON.parse(text) as unknown;
  if (!isObj(pkg)) return { deps: [], workspaces: [] };
  const deps: Dep[] = [];
  const versions: VersionDecl[] = [];
  for (const [k, v] of entries(pkg.require)) {
    if (k.toLowerCase() === 'php') pushVersion(versions, 'lang.php', specVersion(str(v)), 'require.php');
    add(deps, 'composer', k, false, v);
  }
  for (const [k, v] of entries(pkg['require-dev'])) add(deps, 'composer', k, true, v);
  const config = isObj(pkg.config) ? pkg.config : {};
  const platform = isObj(config.platform) ? config.platform : {};
  pushVersion(versions, 'lang.php', leadingVersion(str(platform.php)), 'config.platform.php');
  // Symfony Flex pins every symfony/* package to `extra.symfony.require`.
  const extra = isObj(pkg.extra) ? pkg.extra : {};
  const symfony = isObj(extra.symfony) ? extra.symfony : {};
  pushVersion(versions, 'framework.symfony', specVersion(str(symfony.require)), 'extra.symfony.require');
  return { deps, workspaces: [], versions };
}

/** Requirement strings after a gem name: `, "~> 7.1", ">= 7.1.3"` → `~> 7.1, >= 7.1.3`. */
function gemRequirements(rest: string): string | undefined {
  const reqs: string[] = [];
  let s = rest;
  for (let i = 0; i < 5; i++) {
    const m = /^\s*,\s*(['"])([^'"]{0,100})\1/.exec(s);
    if (!m) break;
    reqs.push(m[2]!);
    s = s.slice(m[0].length);
  }
  return reqs.length ? reqs.join(', ') : undefined;
}

function parseGemfile(text: string): ManifestInfo {
  const deps: Dep[] = [];
  const versions: VersionDecl[] = [];
  /** Stack of open `do … end` blocks; true = a development/test group. */
  const blocks: boolean[] = [];
  for (const raw of lines(text)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const opensBlock = /\sdo\s*(?:\|[^|]*\|)?$/.test(line);
    if (opensBlock && /^group\s/.test(line)) {
      blocks.push(/:(?:development|test)\b/.test(line) && !/:production\b/.test(line));
      continue;
    }
    if (opensBlock) {
      blocks.push(blocks.at(-1) ?? false);
      continue;
    }
    if (/^end\b/.test(line)) {
      blocks.pop();
      continue;
    }
    const gem = /^gem\s+['"]([\w.-]+)['"](.*)$/.exec(line);
    if (gem?.[1]) {
      const rest = gem[2] ?? '';
      const inline = /\bgroups?:\s*\[?\s*:(?:development|test)\b/.test(rest);
      add(deps, 'gem', gem[1], (blocks.at(-1) ?? false) || inline, gemRequirements(rest));
      continue;
    }
    const ruby = /^ruby\s+['"]([^'"]{1,40})['"]/.exec(line);
    if (ruby) pushVersion(versions, 'lang.ruby', specVersion(ruby[1]), 'Gemfile ruby');
  }
  return { deps, workspaces: [], versions };
}

/**
 * `Gemfile.lock`: the resolved version of every gem (`    rails (7.1.4.2)` under `specs:` of the GEM,
 * GIT and PATH sections) and the `RUBY VERSION` section (indented by 3 spaces before Bundler 4, 2 after).
 */
function parseGemfileLock(text: string): ManifestInfo {
  const locked: Dep[] = [];
  const versions: VersionDecl[] = [];
  let section = '';
  let inSpecs = false;
  for (const raw of lines(text)) {
    if (!raw.trim()) continue;
    if (/^\S/.test(raw)) {
      section = raw.trim();
      inSpecs = false;
      continue;
    }
    if (section === 'GEM' || section === 'GIT' || section === 'PATH') {
      if (/^ {2}specs:\s*$/.test(raw)) inSpecs = true;
      else if (/^ {2}\S/.test(raw)) inSpecs = false;
      else if (inSpecs && locked.length < MAX_LOCKED) {
        const m = /^ {4}([\w.-]+) \(([^)\s]{1,60})\)\s*$/.exec(raw);
        if (m) add(locked, 'gem', m[1]!, false, m[2]);
      }
    } else if (section === 'RUBY VERSION') {
      const m = /^\s+ruby\s+(\d+(?:\.\d+){0,3})/.exec(raw);
      if (m) pushVersion(versions, 'lang.ruby', leadingVersion(m[1]), 'Gemfile.lock RUBY VERSION', true);
    }
  }
  return { deps: [], workspaces: [], locked, versions };
}

/** A pubspec dependency: `^1.2.0` or `{ version: ^1.2.0, hosted: … }` (`sdk:` / `path:` / `git:` carry none). */
const pubSpec = (v: unknown): string | undefined => str(v) ?? (isObj(v) ? str(v.version) : undefined);

function parsePubspec(text: string): ManifestInfo {
  const doc = YAML.parse(text) as unknown;
  if (!isObj(doc)) return { deps: [], workspaces: [] };
  const deps: Dep[] = [];
  const versions: VersionDecl[] = [];
  for (const [k, v] of entries(doc.dependencies)) add(deps, 'pub', k, false, pubSpec(v));
  for (const [k, v] of entries(doc.dev_dependencies)) add(deps, 'pub', k, true, pubSpec(v));
  const env = isObj(doc.environment) ? doc.environment : {};
  pushVersion(versions, 'lang.dart', specVersion(str(env.sdk)), 'environment.sdk');
  pushVersion(versions, 'framework.flutter', specVersion(str(env.flutter)), 'environment.flutter');
  return { deps, workspaces: strings(doc.workspace), versions };
}

function parseMix(text: string): ManifestInfo {
  const deps: Dep[] = [];
  const versions: VersionDecl[] = [];
  for (const line of lines(text)) {
    for (const m of line.matchAll(/\{\s*:([a-z][a-z0-9_]*)\s*,\s*(?:"([^"]{0,100})")?/g)) {
      add(
        deps,
        'hex',
        m[1]!,
        /\bonly:\s*(?::test|\[\s*:(?:dev|test)\s*(?:,\s*:(?:dev|test)\s*)?\])/.test(line),
        m[2],
      );
    }
    const elixir = /\belixir:\s*"([^"]{1,60})"/.exec(line);
    if (elixir) pushVersion(versions, 'lang.elixir', specVersion(elixir[1]), 'elixir requirement');
  }
  return { deps, workspaces: [], versions };
}

// ----- version files -----

/** First lines of a version file without comments, blank lines and (reserved) `key=value` lines. */
function versionValues(text: string, max: number): string[] {
  const out: string[] = [];
  for (const raw of lines(text)) {
    const v = raw.replace(/#.*$/, '').trim();
    if (!v || v.includes('=')) continue;
    out.push(v);
    if (out.length >= max) break;
  }
  return out;
}

/** `.nvmrc`, `.node-version`, `.python-version(s)`, `runtime.txt`, `.ruby-version`, `.bun-version`, `.swift-version`, `rust-toolchain(.toml)`. */
function parseVersionFile(file: string, text: string): VersionDecl[] {
  const base = file.slice(file.lastIndexOf('/') + 1);
  const out: VersionDecl[] = [];
  const first = (tech: TechId, parse: (s: string) => Version | undefined) => {
    const [v] = versionValues(text, 1);
    if (v) pushVersion(out, tech, parse(v), base);
  };
  switch (base) {
    case '.nvmrc':
    case '.node-version':
      first('runtime.node', nodeVersion);
      break;
    case '.python-version':
    case '.python-versions':
      // pyenv / uv may list several versions: the project runs on all of them.
      for (const v of versionValues(text, 20)) pushVersion(out, 'lang.python', pythonVersion(v), base);
      break;
    case 'runtime.txt': // Heroku (deprecated in favour of .python-version): `python-3.12.4`
      first('lang.python', (s) => leadingVersion(/^python-(.+)$/.exec(s)?.[1]));
      break;
    case '.ruby-version': // `3.3.5` or `ruby-3.3.5` (not jruby / truffleruby)
      first('lang.ruby', (s) => leadingVersion(s.replace(/^ruby-/, '')));
      break;
    case '.bun-version':
      first('runtime.bun', (s) => leadingVersion(s.replace(/^bun-/, '')));
      break;
    case '.swift-version':
      first('lang.swift', (s) => leadingVersion(s.replace(/^swift-/, '')));
      break;
    case 'rust-toolchain':
    case 'rust-toolchain.toml': {
      // `[toolchain] channel = "1.81.0"`, or the legacy plain `1.81.0`; `stable` / `nightly-…` carry no version.
      let channel: string | undefined;
      for (const line of lines(text).slice(0, 200)) {
        const m = /^\s*channel\s*=\s*['"]([^'"]{1,60})['"]/.exec(line);
        if (m) {
          channel = m[1];
          break;
        }
      }
      if (channel === undefined && base === 'rust-toolchain') channel = versionValues(text, 1)[0];
      if (channel && /^\d+\.\d+(?:\.\d+)?$/.test(channel.trim()))
        pushVersion(out, 'lang.rust', leadingVersion(channel), base);
      break;
    }
  }
  return out;
}

/** asdf / mise tool names → tech (Go is left out: its language version is the go.mod `go` directive). */
const TOOL_TECHS: Readonly<Record<string, TechId>> = {
  nodejs: 'runtime.node',
  node: 'runtime.node',
  deno: 'runtime.deno',
  bun: 'runtime.bun',
  python: 'lang.python',
  ruby: 'lang.ruby',
  java: 'lang.java',
  php: 'lang.php',
  rust: 'lang.rust',
  elixir: 'lang.elixir',
  kotlin: 'lang.kotlin',
  dart: 'lang.dart',
  flutter: 'framework.flutter',
};

/** `.tool-versions`: `<tool> <version> [fallback versions…]` per line, `#` comments. */
function parseToolVersions(text: string): VersionDecl[] {
  const out: VersionDecl[] = [];
  for (const raw of lines(text).slice(0, 500)) {
    const [tool, ...values] = raw.replace(/#.*$/, '').trim().split(/\s+/);
    const name = tool?.toLowerCase();
    if (!name || !Object.hasOwn(TOOL_TECHS, name)) continue;
    const tech = TOOL_TECHS[name]!;
    for (const value of values.slice(0, 5)) {
      if (/^(?:ref|path):|^(?:system|latest)$/i.test(value)) continue;
      const v =
        tech === 'runtime.node'
          ? nodeVersion(value)
          : tech === 'lang.python'
            ? pythonVersion(value)
            : tech === 'lang.java'
              ? javaVersion(value.replace(/^(?:[a-z][a-z0-9]*-)+/i, ''))
              : toolVersion(value);
      pushVersion(out, tech, v, `.tool-versions ${name}`);
    }
  }
  return out;
}

/** First line of `Package.swift`: `// swift-tools-version:5.9` or `// swift-tools-version: 6.0`. */
function parseSwiftPackage(text: string): VersionDecl[] {
  const first = text.slice(0, 300).split(/\r?\n/, 1)[0] ?? '';
  const m = /^\/\/\s*swift-tools-version\s*:\s*(\d+(?:\.\d+){0,2})/i.exec(first.trim());
  const out: VersionDecl[] = [];
  if (m) pushVersion(out, 'lang.swift', leadingVersion(m[1]), 'swift-tools-version');
  return out;
}
