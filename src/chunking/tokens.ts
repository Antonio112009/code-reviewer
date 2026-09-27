import { countTokens } from 'gpt-tokenizer';

/**
 * Token estimate. gpt-tokenizer implements OpenAI's o200k encoding; Claude and most other
 * tokenizers produce a few percent more tokens for code, so a safety margin is added.
 * Real usage reported by providers is recorded in the run for calibration.
 */
const SAFETY_FACTOR = 1.15;

/**
 * Runs of whitespace or of non-whitespace at least this long are estimated from their length: the
 * tokenizer's pre-split regex and BPE merges are quadratic in the length of one pre-token, and the text is
 * untrusted (a file with a megabyte of spaces or base64 must not stall chunking).
 */
const LONG_RUN = 256;
/** Characters per token for long runs (o200k merges long space runs; blobs are ~3 chars per token). */
const CHARS_PER_TOKEN = { space: 8, other: 3 } as const;
/** Special-token strings (`<|endoftext|>`, …) in reviewed code are plain text, never an error. */
const AS_TEXT = { disallowedSpecial: new Set<string>() };

function isSpace(code: number, ch: string): boolean {
  return code === 32 || (code >= 9 && code <= 13) || (code > 127 && /\s/.test(ch));
}

/** Estimated tokens of `text`, linear in its length whatever it contains. */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  let tokens = 0;
  let segmentStart = 0; // start of the text not yet counted
  let runStart = 0;
  let runSpace = false;
  const flush = (runEnd: number) => {
    if (runEnd - runStart < LONG_RUN) return;
    if (runStart > segmentStart) tokens += countTokens(text.slice(segmentStart, runStart), AS_TEXT);
    tokens += Math.ceil((runEnd - runStart) / (runSpace ? CHARS_PER_TOKEN.space : CHARS_PER_TOKEN.other));
    segmentStart = runEnd;
  };
  for (let i = 0; i < text.length; i++) {
    const space = isSpace(text.charCodeAt(i), text[i]!);
    if (i === 0) runSpace = space;
    else if (space !== runSpace) {
      flush(i);
      runStart = i;
      runSpace = space;
    }
  }
  flush(text.length);
  if (segmentStart < text.length) tokens += countTokens(text.slice(segmentStart), AS_TEXT);
  return Math.ceil(tokens * SAFETY_FACTOR);
}
