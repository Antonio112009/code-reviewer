import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

/**
 * Environment variables through which AWS hands out role credentials (CodeBuild / ECS task roles,
 * EKS IRSA and Pod Identity, Lambda). EC2 instance profiles (IMDS) cannot be detected offline.
 */
const ROLE_ENV = [
  'AWS_WEB_IDENTITY_TOKEN_FILE',
  'AWS_CONTAINER_CREDENTIALS_RELATIVE_URI',
  'AWS_CONTAINER_CREDENTIALS_FULL_URI',
  'AWS_EXECUTION_ENV',
];

/** Offline hints that AWS credentials are available (no network, no SDK call). */
export function awsCredentialSources(
  profile: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const sources: string[] = [];
  if (env.AWS_BEARER_TOKEN_BEDROCK) sources.push('AWS_BEARER_TOKEN_BEDROCK');
  if (env.AWS_ACCESS_KEY_ID) sources.push('AWS_ACCESS_KEY_ID');
  if (profile || env.AWS_PROFILE) sources.push(`profile ${profile ?? env.AWS_PROFILE}`);
  for (const name of ROLE_ENV) if (env[name]) sources.push(name);
  const awsDir = path.join(homedir(), '.aws');
  if (
    existsSync(env.AWS_SHARED_CREDENTIALS_FILE ?? path.join(awsDir, 'credentials')) ||
    existsSync(awsConfigFile(env))
  )
    sources.push('~/.aws');
  return sources;
}

function awsConfigFile(env: NodeJS.ProcessEnv): string {
  return env.AWS_CONFIG_FILE ?? path.join(homedir(), '.aws', 'config');
}

/** `region` of an AWS profile in the shared config file (`[profile x]`, or `[default]`), if set. */
export function profileRegion(
  profile: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  let text: string;
  try {
    text = readFileSync(awsConfigFile(env), 'utf8');
  } catch {
    return undefined;
  }
  const name = profile ?? env.AWS_PROFILE ?? 'default';
  const wanted = name === 'default' ? ['default', 'profile default'] : [`profile ${name}`];
  let inSection = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const section = /^\[\s*([^\]]+?)\s*\]$/.exec(line);
    if (section) {
      inSection = wanted.includes(section[1]!);
      continue;
    }
    const region = inSection ? /^region\s*=\s*(\S+)/.exec(line) : null;
    if (region) return region[1];
  }
  return undefined;
}

/** Region used for Bedrock: config, AWS_REGION / AWS_DEFAULT_REGION, the profile's region, else us-east-1. */
export function bedrockRegion(
  cfg: { region?: string; profile?: string },
  env: NodeJS.ProcessEnv = process.env,
): string {
  return (
    cfg.region ?? env.AWS_REGION ?? env.AWS_DEFAULT_REGION ?? profileRegion(cfg.profile, env) ?? 'us-east-1'
  );
}
