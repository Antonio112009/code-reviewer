import type { Category, Severity } from '../types';
import type { ProcessRegistry } from '../util/processes';
import type { StructuralCheck } from './ast-grep';

/** A file handed to the static-analysis pre-pass (mirror of `AnalyzeFile` in `./index`). */
export interface SourceFile {
  /** Repo-relative POSIX path. */
  path: string;
  /** Content of the reviewed revision. */
  content: string;
  language: string;
  /**
   * 1-based inclusive ranges of changed lines (diff mode); empty = whole file (files mode only: diff-mode
   * files without changed lines are never analysed).
   */
  changedRanges: Array<[number, number]>;
}

export type AnalyzerTier = 'builtin' | 'external' | 'project';

/** A hit as produced by one analyzer, before filtering, deduplication and id assignment. */
export interface RawHit {
  ruleId: string;
  /** Repo-relative POSIX path (must be one of the analysed files, otherwise the hit is dropped). */
  file: string;
  startLine: number;
  endLine?: number;
  severity: Severity;
  category: Category;
  message: string;
  /** Prior confidence 0..1. */
  confidence: number;
  help?: string;
  nonRejectable?: boolean;
  /**
   * Hits of different analyzers that describe the same thing share a key (e.g. `secret`), so only the
   * strongest one per file+line survives deduplication. Defaults to `<analyzer>:<ruleId>`.
   */
  dedupeKey?: string;
}

/** Sandboxed copy of some files in a fresh temp dir outside the repository. */
export interface Sandbox {
  /** Directory holding the copied files at their repo-relative paths (tools run with this cwd). */
  dir: string;
  /** Scratch directory next to (not inside) `dir` for our own configs and reports. */
  outDir: string;
  /** Repo-relative paths that were written (sorted). Files that could not be written are left out. */
  files: string[];
}

export interface AnalyzerContext {
  /** Files selected for this analyzer (sorted by path). */
  files: SourceFile[];
  mode: 'diff' | 'files';
  /** Aborted on user interrupt or when the analyzer's time budget is spent. */
  signal: AbortSignal;
  timeoutMs: number;
  /** Absolute time (ms since epoch) after which the analyzer should stop. */
  deadline: number;
  /** Scrubbed environment for subprocesses. */
  env: NodeJS.ProcessEnv;
  /** Resolved executable (external/project analyzers). */
  tool?: LocatedBinary;
  version?: string;
  /** Repository root — project analyzers only. */
  repoRoot?: string;
  registry?: ProcessRegistry;
  /** Structural checks of the loaded skills (`ast-grep`). */
  checks?: readonly StructuralCheck[];
  /** Writes `files` (optionally transformed) into a fresh sandbox; removed when the analyzer ends. */
  sandbox(files: SourceFile[], transform?: (file: SourceFile) => string): Promise<Sandbox>;
}

export interface AnalyzerOutcome {
  hits: RawHit[];
  /** Defaults to `ok`. */
  status?: 'ok' | 'skipped' | 'failed' | 'timeout';
  reason?: string;
  version?: string;
}

/** Where an external/project analyzer's executable was found. */
export interface LocatedBinary {
  /** Absolute path of the program to spawn. */
  command: string;
  /** Arguments to put before the analyzer's own (e.g. the script when running `node <bin.js>`). */
  prefixArgs: string[];
  /** Whether probing `--version` is safe without an opt-in (false for repository-local binaries). */
  trusted: boolean;
}

export interface LocateContext {
  env: NodeJS.ProcessEnv;
  repoRoot?: string;
}

/** Definition of one analyzer. */
export interface AnalyzerDef {
  id: string;
  label: string;
  tier: AnalyzerTier;
  /** Language ids (from `src/util/language.ts`) the analyzer looks at; `*` = any. */
  languages: string[];
  description: string;
  /** True when the analyzer sends data over the network. */
  network?: boolean;
  /** Picks the files this analyzer would look at (`checks`: the skills' structural checks). */
  select(files: SourceFile[], mode: 'diff' | 'files', checks?: readonly StructuralCheck[]): SourceFile[];
  /** External/project analyzers: finds the executable (undefined = not installed). */
  locate?(ctx: LocateContext): Promise<LocatedBinary | undefined>;
  /** Arguments of the version probe (default `--version`). */
  versionArgs?: string[];
  run(ctx: AnalyzerContext): Promise<AnalyzerOutcome>;
}

const SEVERITY_RANK: Record<Severity, number> = { critical: 3, major: 2, minor: 1, info: 0 };

/** Numeric rank of a severity (higher = more severe). */
export function severityRank(severity: Severity): number {
  return SEVERITY_RANK[severity];
}
