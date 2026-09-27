import type { Config, ProviderConfig } from '../config/schema';
import type { Logger } from '../util/logger';
import { AcpProvider } from './acp/provider';
import { BedrockProvider } from './bedrock';
import { MockProvider } from './mock';
import { type Provider, ProviderError } from './types';

/** Lazily instantiates providers referenced by roles; shares instances between roles. */
export class ProviderRegistry {
  private readonly instances = new Map<string, Provider>();

  constructor(
    private readonly config: Config,
    private readonly logger: Logger,
  ) {}

  get(id: string): Provider {
    let p = this.instances.get(id);
    if (!p) {
      const cfg = this.config.providers[id];
      if (!cfg) {
        throw new ProviderError(
          `Unknown provider "${id}". Configured: ${Object.keys(this.config.providers).join(', ')}`,
          id,
        );
      }
      p = createProvider(id, cfg, this.logger, this.config.review.concurrency);
      this.instances.set(id, p);
    }
    return p;
  }

  async disposeAll(): Promise<void> {
    await Promise.allSettled([...this.instances.values()].map((p) => p.dispose()));
    this.instances.clear();
  }
}

export function createProvider(
  id: string,
  cfg: ProviderConfig,
  logger: Logger,
  concurrency: number,
): Provider {
  switch (cfg.type) {
    case 'bedrock':
      return new BedrockProvider(id, cfg);
    case 'acp':
      return new AcpProvider(id, cfg, logger, concurrency);
    case 'mock':
      return new MockProvider(id);
  }
}
