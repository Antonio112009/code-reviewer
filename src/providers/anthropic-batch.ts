import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { SUBMIT_TOOLS, toolsFor } from '../tools/definitions';
import { SubmissionCollector } from '../tools/submission';
import { SubmitFindingsSchema, SubmitVerdictsSchema } from '../types';
import { type AgentResult, type AgentTask, ProviderError } from './types';

/*
 * One task as a single request of the Message Batches API: half the price of a regular request, answered
 * within minutes (up to 24 hours by Anthropic's terms). Only for tasks without read tools — a batch request
 * cannot call back for a tool result, so the model's first answer is final: its `submit_*` call (or, failing
 * that, its text, which the pipeline repairs like any other reply).
 *
 * When the batch has not ended within the wait limit (or the task is aborted), it is cancelled and
 * `BatchTimeout` is thrown: the caller falls back to a regular request.
 */

const API = 'https://api.anthropic.com/v1/messages/batches';
const VERSION = '2023-06-01';

export class BatchTimeout extends ProviderError {}

export interface BatchOptions {
  providerId: string;
  modelId: string;
  apiKey: string;
  /** Longest wait for the batch before it is cancelled (ms). */
  maxWaitMs: number;
  /** Between status checks (ms; default 10 s). */
  pollMs?: number;
  /** Injectable for tests. */
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

const BatchStatusSchema = z.object({
  id: z.string(),
  processing_status: z.string(),
  results_url: z.string().nullable().optional(),
});

const BatchResultSchema = z.object({
  custom_id: z.string(),
  result: z.object({
    type: z.string(),
    message: z
      .object({
        model: z.string().optional(),
        stop_reason: z.string().nullable().optional(),
        content: z.array(z.record(z.string(), z.unknown())),
        usage: z
          .object({
            input_tokens: z.number().optional(),
            output_tokens: z.number().optional(),
            cache_read_input_tokens: z.number().nullable().optional(),
            cache_creation_input_tokens: z.number().nullable().optional(),
          })
          .optional(),
      })
      .optional(),
    error: z.unknown().optional(),
  }),
});

/** The task's reasoning level as Messages API thinking settings (adaptive thinking; `none` = low effort). */
function thinkingFor(task: AgentTask): Record<string, unknown> {
  const effort = task.reasoning === 'none' ? 'low' : task.reasoning;
  return { thinking: { type: 'adaptive' }, output_config: { effort } };
}

/** The request body: our instructions as the system prompt, the prompt, and the submit tool only. */
export function batchParams(task: AgentTask, modelId: string): Record<string, unknown> {
  if (task.readTools) throw new ProviderError('a batch request cannot serve read tools', 'anthropic');
  const tools = toolsFor(task.kind, false).map((def) => ({
    name: def.name,
    description: def.description,
    input_schema: z.toJSONSchema(def.inputSchema, { io: 'input' }),
  }));
  return {
    model: modelId,
    max_tokens: task.maxOutputTokens ?? 32_000,
    system: task.instructions,
    messages: [{ role: 'user', content: task.prompt }],
    tools,
    tool_choice: { type: 'auto' },
    ...thinkingFor(task),
  };
}

export async function runBatchTask(task: AgentTask, opts: BatchOptions): Promise<AgentResult> {
  const doFetch = opts.fetch ?? ((url, init) => fetch(url, init));
  const sleep = opts.sleep ?? ((ms, signal) => delay(ms, undefined, { signal }));
  const headers = {
    'x-api-key': opts.apiKey,
    'anthropic-version': VERSION,
    'content-type': 'application/json',
  };
  const call = async (method: string, url: string, body?: unknown): Promise<Response> => {
    const res = await doFetch(url, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...(task.signal ? { signal: task.signal } : {}),
      redirect: 'error',
    });
    if (!res.ok) {
      const text = (await res.text().catch(() => '')).slice(0, 300);
      throw new ProviderError(`Message Batches API: ${method} ${res.status} ${text}`, opts.providerId);
    }
    return res;
  };

  const customId = 'task';
  const created = BatchStatusSchema.parse(
    await (
      await call('POST', API, {
        requests: [{ custom_id: customId, params: batchParams(task, opts.modelId) }],
      })
    ).json(),
  );
  const started = Date.now();
  let status = created;
  while (status.processing_status !== 'ended') {
    if (task.signal?.aborted || Date.now() - started >= opts.maxWaitMs) {
      await call('POST', `${API}/${status.id}/cancel`).catch(() => undefined);
      if (task.signal?.aborted) throw task.signal.reason ?? new Error('aborted');
      throw new BatchTimeout(
        `the batch was not answered within ${Math.round(opts.maxWaitMs / 1000)}s`,
        opts.providerId,
      );
    }
    await sleep(opts.pollMs ?? 10_000, task.signal);
    status = BatchStatusSchema.parse(await (await call('GET', `${API}/${status.id}`)).json());
  }
  if (!status.results_url?.startsWith('https://api.anthropic.com/')) {
    throw new ProviderError('the batch ended without a results URL on the API host', opts.providerId);
  }
  const lines = (await (await call('GET', status.results_url)).text()).split('\n').filter((l) => l.trim());
  const entry = lines
    .map((l) => BatchResultSchema.parse(JSON.parse(l)))
    .find((r) => r.custom_id === customId);
  const message = entry?.result.type === 'succeeded' ? entry.result.message : undefined;
  if (!message) {
    throw new ProviderError(
      `the batch request ${entry?.result.type ?? 'returned nothing'}: ${JSON.stringify(entry?.result.error ?? '').slice(0, 300)}`,
      opts.providerId,
    );
  }

  const collector = new SubmissionCollector();
  const submit = SUBMIT_TOOLS[task.kind].name;
  const warnings: string[] = [];
  let text = '';
  let toolCalls = 0;
  for (const block of message.content) {
    if (block.type === 'text' && typeof block.text === 'string') text += block.text;
    if (block.type !== 'tool_use' || block.name !== submit) continue;
    toolCalls++;
    const parsed = (task.kind === 'findings' ? SubmitFindingsSchema : SubmitVerdictsSchema).safeParse(
      block.input,
    );
    if (!parsed.success) {
      warnings.push(`the batch answer's ${submit} call did not match its schema`);
      continue;
    }
    if (task.kind === 'findings')
      collector.add('findings', parsed.data as z.infer<typeof SubmitFindingsSchema>);
    else collector.add('verdicts', parsed.data as z.infer<typeof SubmitVerdictsSchema>);
  }
  const u = message.usage ?? {};
  return {
    submission: collector.submission,
    text,
    usage: {
      inputTokens: u.input_tokens ?? 0,
      outputTokens: u.output_tokens ?? 0,
      ...(u.cache_read_input_tokens ? { cachedInputTokens: u.cache_read_input_tokens } : {}),
      ...(u.cache_creation_input_tokens ? { cacheWriteTokens: u.cache_creation_input_tokens } : {}),
      requests: 1,
      batch: true,
    },
    ...(message.model ? { model: message.model } : {}),
    ...(message.stop_reason ? { stopReason: message.stop_reason } : {}),
    toolCalls,
    toolUsage: toolCalls ? { [submit]: toolCalls } : {},
    warnings,
  };
}
