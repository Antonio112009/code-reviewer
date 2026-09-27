import path from 'node:path';
import { lintSource } from '@secretlint/core';
import { rules as recommendedRules } from '@secretlint/secretlint-rule-preset-recommend';
import type { Severity } from '../types';
import type { AnalyzerDef, RawHit, SourceFile } from './types';

type SecretlintConfig = Parameters<typeof lintSource>[0]['options']['config'];

/**
 * Inline `secretlint-disable` comments are honoured by this rule. A PR must not be able to hide its own
 * leak, so it is left out (newly added disable comments are reported as suppression hints instead).
 */
const FILTER_COMMENTS_RULE = '@secretlint/secretlint-rule-filter-comments';

/** Rules whose hits are likely shared/low-value credentials rather than live provider keys. */
const MAJOR_RULES = new Set([
  '@secretlint/secretlint-rule-basicauth',
  '@secretlint/secretlint-rule-database-connection-string',
  '@secretlint/secretlint-rule-docker',
]);

/** Files larger than this are not scanned in-process (generated data, dumps). */
const MAX_BYTES = 1024 * 1024;

let cachedConfig: SecretlintConfig | undefined;

/** Our own secretlint config: the recommended preset's scanners, without comment-based suppression. */
function secretlintConfig(): SecretlintConfig {
  if (!cachedConfig) {
    cachedConfig = {
      rules: recommendedRules
        .filter((rule) => rule.meta.id !== FILTER_COMMENTS_RULE)
        .map((rule) => ({ id: rule.meta.id, rule })) as SecretlintConfig['rules'],
    };
  }
  return cachedConfig;
}

function shortRuleId(ruleId: string): string {
  return ruleId.replace(/^@secretlint\/secretlint-rule-/, '');
}

/**
 * Message with every trace of the secret removed: secretlint masks the reported value with `*`, we also
 * cut the matched text itself and collapse the mask to `[REDACTED]`.
 */
export function redactSecretMessage(message: string, secret: string): string {
  let out = message;
  if (secret.length >= 4) out = out.split(secret).join('[REDACTED]');
  for (const part of secret.split(/[\s:@/]+/)) if (part.length >= 6) out = out.split(part).join('[REDACTED]');
  out = out.replace(/\*{3,}/g, '[REDACTED]').replace(/^found\s+/i, '');
  return `Hard-coded secret: ${out}`;
}

/** Scans one file's content with secretlint; hits carry redacted messages only. */
export async function scanSecrets(file: SourceFile): Promise<RawHit[]> {
  if (file.content.length > MAX_BYTES || file.content.includes('\u0000')) return [];
  const result = await lintSource({
    source: {
      content: file.content,
      filePath: file.path,
      ext: path.extname(file.path),
      contentType: 'text',
    },
    options: { config: secretlintConfig(), maskSecrets: true, noPhysicFilePath: true, locale: 'en' },
  });
  const hits: RawHit[] = [];
  for (const m of result.messages) {
    const secret = file.content.slice(m.range[0], m.range[1]);
    const severity: Severity = MAJOR_RULES.has(m.ruleId) ? 'major' : 'critical';
    hits.push({
      ruleId: shortRuleId(m.ruleId),
      file: file.path,
      startLine: m.loc.start.line,
      endLine: Math.max(m.loc.start.line, m.loc.end.line),
      severity,
      category: 'security',
      message: redactSecretMessage(m.message, secret),
      confidence: severity === 'critical' ? 0.7 : 0.5,
      help: 'Remove the credential from the code, rotate it, and load it from the environment or a secret store.',
      nonRejectable: true,
      dedupeKey: 'secret',
    });
  }
  return hits;
}

/** Built-in secret scanner (secretlint recommended preset, our config only). */
export const secretsAnalyzer: AnalyzerDef = {
  id: 'secrets',
  label: 'Secrets (secretlint)',
  tier: 'builtin',
  languages: ['*'],
  description:
    'Hard-coded credentials (cloud keys, API tokens, private keys) via the secretlint recommended rules.',
  select: (files) => files,
  async run(ctx) {
    const hits: RawHit[] = [];
    let done = 0;
    for (const file of ctx.files) {
      if (ctx.signal.aborted || Date.now() > ctx.deadline) {
        return {
          hits,
          status: ctx.signal.aborted && Date.now() <= ctx.deadline ? 'failed' : 'timeout',
          reason: `stopped after ${done}/${ctx.files.length} files`,
        };
      }
      hits.push(...(await scanSecrets(file)));
      done++;
      // secretlint works synchronously per file: yield so timers and Ctrl+C handlers can run.
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    return { hits };
  },
};
