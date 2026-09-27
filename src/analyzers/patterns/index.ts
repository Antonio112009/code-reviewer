import picomatch from 'picomatch';
import { changedLineNumbers } from '../lines';
import type { AnalyzerDef, RawHit, SourceFile } from '../types';
import { BACKEND_RULES } from './rules-backend';
import { COMMON_RULES } from './rules-common';
import { INFRA_RULES } from './rules-infra';
import { JS_RULES } from './rules-js';
import { NATIVE_RULES } from './rules-native';
import { PYTHON_RULES } from './rules-python';
import type { PatternRule } from './types';

export type { MatchContext, PatternRule } from './types';

/** Every built-in pattern rule. */
export const PATTERN_RULES: readonly PatternRule[] = [
  ...JS_RULES,
  ...PYTHON_RULES,
  ...BACKEND_RULES,
  ...NATIVE_RULES,
  ...INFRA_RULES,
  ...COMMON_RULES,
];

/** Lines are clipped to this length before matching (minified code, crafted ReDoS input). */
const MAX_LINE_CHARS = 1_000;
/** Files above this size are not scanned. */
const MAX_FILE_CHARS = 2_000_000;

const SLASH_COMMENTS = new Set([
  'javascript',
  'typescript',
  'vue',
  'svelte',
  'java',
  'kotlin',
  'scala',
  'groovy',
  'csharp',
  'go',
  'rust',
  'c',
  'cpp',
  'objective-c',
  'swift',
  'dart',
  'php',
  'terraform',
  'protobuf',
]);
const HASH_COMMENTS = new Set([
  'python',
  'shell',
  'ruby',
  'yaml',
  'dockerfile',
  'toml',
  'makefile',
  'elixir',
  'terraform',
  'php',
]);
const MARKUP_COMMENTS = new Set(['html', 'vue', 'svelte', 'markdown']);

/** True when a line is only a comment in `language` (such lines are not matched by default). */
export function isCommentLine(language: string, line: string): boolean {
  const t = line.trimStart();
  if (!t) return false;
  if (SLASH_COMMENTS.has(language) && /^(?:\/\/|\/\*|\*(?:\s|\/|$))/.test(t)) return true;
  if (HASH_COMMENTS.has(language) && t.startsWith('#') && !t.startsWith('#!') && !t.startsWith('#['))
    return true;
  if (language === 'sql' && /^(?:--|\/\*)/.test(t)) return true;
  if (MARKUP_COMMENTS.has(language) && t.startsWith('<!--')) return true;
  return false;
}

const pathMatchers = new WeakMap<PatternRule, (p: string) => boolean>();

/** Whether `rule` applies to `file` (by language, or by path glob). */
export function ruleApplies(rule: PatternRule, file: Pick<SourceFile, 'path' | 'language'>): boolean {
  if (rule.languages?.includes(file.language)) return true;
  if (!rule.paths?.length) return false;
  let matcher = pathMatchers.get(rule);
  if (!matcher) {
    matcher = picomatch([...rule.paths], { dot: true });
    pathMatchers.set(rule, matcher);
  }
  return matcher(file.path);
}

function clip(line: string): string {
  return line.length > MAX_LINE_CHARS ? line.slice(0, MAX_LINE_CHARS) : line;
}

function countNewlines(s: string): number {
  let n = 0;
  for (let i = s.indexOf('\n'); i !== -1; i = s.indexOf('\n', i + 1)) n++;
  return n;
}

/** Regex executions between two checkpoints of `scanSteps`. */
const CHECKPOINT_EVERY = 256;

/**
 * Runs the pattern rules over one file as a generator: yields hits, and `null` checkpoints every few
 * hundred regex executions so a caller can yield to the event loop or stop at a deadline. Changed lines
 * only when the file has changed ranges (diff mode), every line otherwise. Multi-line (`window`) rules
 * must start on the first line of their window and touch at least one changed line.
 */
export function* scanSteps(
  file: SourceFile,
  rules: readonly PatternRule[] = PATTERN_RULES,
): Generator<RawHit | null, void, undefined> {
  if (file.content.length > MAX_FILE_CHARS || file.content.includes('\u0000')) return;
  const applicable = rules.filter((r) => ruleApplies(r, file));
  if (applicable.length === 0) return;
  // Rules and their `when` predicates only ever see clipped lines.
  const lines = file.content.split(/\r?\n/).map(clip);
  const changed = changedLineNumbers(file, lines.length);
  const changedSet = file.changedRanges.length > 0 ? new Set(changed) : undefined;
  const startsByWindow = new Map<number, number[]>();
  const startsFor = (window: number): number[] => {
    let starts = startsByWindow.get(window);
    if (!starts) {
      if (!changedSet || window === 0) starts = changed;
      else {
        const set = new Set<number>();
        for (const n of changed) for (let s = Math.max(1, n - window); s <= n; s++) set.add(s);
        starts = [...set].sort((a, b) => a - b);
      }
      startsByWindow.set(window, starts);
    }
    return starts;
  };

  let executed = 0;
  for (const rule of applicable) {
    if (rule.fileIf && !rule.fileIf.test(file.content)) continue;
    if (rule.fileNotIf?.test(file.content)) continue;
    const window = rule.window ?? 0;
    for (const lineNo of startsFor(window)) {
      if (++executed % CHECKPOINT_EVERY === 0) yield null;
      const index = lineNo - 1;
      const first = lines[index] ?? '';
      if (!first || (!rule.matchComments && isCommentLine(file.language, first))) continue;
      let text = first;
      for (let k = 1; k <= window && index + k < lines.length; k++) text += `\n${lines[index + k]}`;
      const match = rule.regex.exec(text);
      if (!match) continue;
      if (text.slice(0, match.index).includes('\n')) continue; // starts on a later line: found from there
      if (rule.notIf?.test(text)) continue;
      const endLine = lineNo + countNewlines(match[0]);
      if (changedSet && window > 0) {
        let touches = false;
        for (let n = lineNo; n <= endLine && !touches; n++) touches = changedSet.has(n);
        if (!touches) continue;
      }
      if (rule.when && !rule.when({ match, lines, index, file })) continue;
      yield {
        ruleId: rule.id,
        file: file.path,
        startLine: lineNo,
        endLine,
        severity: rule.severity,
        category: rule.category,
        message: rule.message,
        confidence: rule.confidence,
        help: [rule.help, rule.cwe].filter(Boolean).join(' ') || undefined,
        dedupeKey: rule.dedupeKey,
      };
    }
  }
}

/** Synchronous `scanSteps`: every hit of the pattern rules in one file. */
export function scanPatterns(file: SourceFile, rules: readonly PatternRule[] = PATTERN_RULES): RawHit[] {
  const hits: RawHit[] = [];
  for (const step of scanSteps(file, rules)) if (step) hits.push(step);
  return hits;
}

/** Continuous work before the analyzer yields to the event loop (keeps Ctrl+C and timers responsive). */
const SLICE_MS = 20;

const RULES_BY_ID = new Map(PATTERN_RULES.map((r) => [r.id, r]));

/** The pattern rule with this id, if any. */
export function patternRule(id: string): PatternRule | undefined {
  return RULES_BY_ID.get(id);
}

const LANGUAGES = [...new Set(PATTERN_RULES.flatMap((r) => [...(r.languages ?? [])]))].sort();

/** Built-in regex rules for risky constructs across languages. */
export const patternsAnalyzer: AnalyzerDef = {
  id: 'patterns',
  label: 'Pattern rules',
  tier: 'builtin',
  languages: LANGUAGES,
  description: `${PATTERN_RULES.length} regex rules for risky constructs (injection sinks, unsafe deserialization, disabled TLS checks, weak crypto, swallowed errors, CI/Docker pitfalls) on changed lines.`,
  select: (files) => files.filter((f) => PATTERN_RULES.some((r) => ruleApplies(r, f))),
  async run(ctx) {
    const hits: RawHit[] = [];
    let done = 0;
    let sliceStart = Date.now();
    const stop = () => ({
      hits,
      status: Date.now() > ctx.deadline ? ('timeout' as const) : ('failed' as const),
      reason: `stopped after ${done}/${ctx.files.length} files`,
    });
    for (const file of ctx.files) {
      for (const step of scanSteps(file)) {
        if (step) {
          hits.push(step);
          continue;
        }
        const now = Date.now();
        if (ctx.signal.aborted || now > ctx.deadline) return stop();
        if (now - sliceStart >= SLICE_MS) {
          await new Promise<void>((resolve) => setImmediate(resolve));
          sliceStart = Date.now();
        }
      }
      done++;
      if (ctx.signal.aborted || Date.now() > ctx.deadline)
        return done === ctx.files.length ? { hits } : stop();
    }
    return { hits };
  },
};
