import type { Category, Severity } from '../../types';
import type { SourceFile } from '../types';

/**
 * What a rule's `when` predicate sees about a match. Predicates run synchronously between two
 * checkpoints of the scan, so each call must stay cheap: never rescan the whole file per match (compute
 * per-file facts once, memoized on `lines`) and never run a regex over the whole untrusted content.
 */
export interface MatchContext {
  match: RegExpExecArray;
  /**
   * All lines of the file, each clipped like the matched text. It is the same array for every match of
   * one scan, so it can key per-file facts (e.g. in a WeakMap).
   */
  lines: readonly string[];
  /** 0-based index of the line the match starts on. */
  index: number;
  /** The file (without its content: predicates only look at the clipped `lines`). */
  file: Pick<SourceFile, 'path' | 'language'>;
}

/**
 * A line-oriented regex rule of the built-in pattern analyzer. Rules are hints for the LLM, so they aim
 * at risky constructs with a decent prior (0.3–0.8), not at proof.
 */
export interface PatternRule {
  /** Stable id, e.g. `js-eval` (reported as the hit's ruleId). */
  id: string;
  /** Language ids the rule applies to (see `src/util/language.ts`). */
  languages?: readonly string[];
  /** Globs (picomatch, dot files included) that also make the rule apply, whatever the language. */
  paths?: readonly string[];
  /**
   * Tested against one line, or against `window + 1` lines joined with `\n`. Never use the `g`/`y` flags
   * and keep quantifiers bounded (`{0,200}`) — input lines are attacker-controlled.
   */
  regex: RegExp;
  /** Suppresses the hit when it matches the same text (line or window). */
  notIf?: RegExp;
  /**
   * The whole file must match (e.g. `pull_request_target` for a checkout rule). It runs over the whole
   * untrusted content: start every alternative with a literal and never use the `m` flag with a leading
   * `^\s*` / `.*`, which makes the match quadratic.
   */
  fileIf?: RegExp;
  /** The rule is skipped when the whole file matches (e.g. an XXE hardening call); same rules as `fileIf`. */
  fileNotIf?: RegExp;
  /** Extra following lines joined to the matched text (multi-line constructs). */
  window?: number;
  /** Extra check with access to the surrounding lines. */
  when?: (ctx: MatchContext) => boolean;
  /** Also match on comment lines (default: comment lines are skipped). */
  matchComments?: boolean;
  severity: Severity;
  category: Category;
  /** Prior probability that a hit is a real defect (0.3–0.8). */
  confidence: number;
  message: string;
  /** Short fix hint. */
  help?: string;
  cwe?: string;
  /** Id of the review skill this rule relates to (`skills/<category>/<id>.md`). */
  skill: string;
  /** Shared deduplication key with other analyzers (e.g. `secret`). */
  dedupeKey?: string;
}

// Language groups ---------------------------------------------------------------------------------

export const JS = ['javascript', 'typescript', 'vue', 'svelte'] as const;
export const JVM = ['java', 'kotlin', 'scala', 'groovy'] as const;
export const C_FAMILY = ['c', 'cpp', 'objective-c'] as const;
/** General-purpose programming languages. */
export const CODE = [
  ...JS,
  'python',
  'php',
  ...JVM,
  'csharp',
  'go',
  'ruby',
  'rust',
  ...C_FAMILY,
  'swift',
  'dart',
  'elixir',
] as const;
/** Languages with `try { } catch (…) { }` blocks. */
export const TRY_CATCH = [...JS, ...JVM, 'csharp', 'php', 'dart', 'swift', 'cpp'] as const;
/** Places where shell commands are written. */
export const SHELLISH = ['shell', 'dockerfile', 'makefile', 'yaml'] as const;
/** Infrastructure / configuration formats. */
export const CONFIG = ['yaml', 'json', 'toml', 'terraform'] as const;
/** GitHub Actions workflow and composite-action files. */
export const WORKFLOW_PATHS = ['**/.github/workflows/*.{yml,yaml}', '**/action.{yml,yaml}'] as const;
