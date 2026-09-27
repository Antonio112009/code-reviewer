import type { Config } from '../config/schema';
import { findExecutable, PRESETS } from './acp/presets';
import { awsCredentialSources, bedrockRegion } from './aws';

export interface ProviderStatus {
  id: string;
  type: string;
  label: string;
  available: boolean;
  experimental: boolean;
  detail: string;
}

/** Offline availability check: binaries on PATH, AWS credential sources. No network calls. */
export function detectProviders(config: Config): ProviderStatus[] {
  return Object.entries(config.providers).map(([id, cfg]): ProviderStatus => {
    if (cfg.type === 'mock') {
      return {
        id,
        type: 'mock',
        label: 'Mock (offline, deterministic)',
        available: true,
        experimental: false,
        detail: 'built-in',
      };
    }
    if (cfg.type === 'bedrock') {
      const sources = awsCredentialSources(cfg.profile);
      const region = bedrockRegion(cfg);
      return {
        id,
        type: 'bedrock',
        label: 'AWS Bedrock',
        available: sources.length > 0,
        experimental: false,
        detail: sources.length
          ? `credentials: ${sources.join(', ')}; region: ${region}`
          : 'no AWS credentials found (set AWS_PROFILE, AWS_ACCESS_KEY_ID or AWS_BEARER_TOKEN_BEDROCK, or run with an AWS role)',
      };
    }
    const preset = PRESETS[cfg.preset];
    const spec = preset.launch(cfg, { reasoning: 'medium' });
    const cliPath = preset.cli ? findExecutable(preset.cli) : undefined;
    const needsCli = preset.cli !== undefined && !cfg.command;
    const available = spec !== undefined && (!needsCli || cliPath !== undefined);
    let detail: string;
    if (!spec) detail = preset.cli ? `\`${preset.cli}\` not found on PATH` : 'no command configured';
    else if (needsCli && !cliPath)
      detail = `\`${preset.cli}\` CLI not found on PATH (install and log in first)`;
    else
      detail = `${[spec.command, ...spec.args].join(' ')} (via ${spec.via})${cliPath ? `; cli: ${cliPath}` : ''}`;
    return {
      id,
      type: `acp:${cfg.preset}`,
      label: preset.label,
      available,
      experimental: preset.experimental,
      detail,
    };
  });
}
