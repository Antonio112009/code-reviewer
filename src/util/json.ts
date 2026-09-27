/** Only the tail of a reply is searched: models put their JSON last, and the scan must stay cheap. */
const MAX_SCAN_CHARS = 256 * 1024;
/** Candidate spans actually parsed (largest first). */
const MAX_PARSE_ATTEMPTS = 20;
/** How far down the bracket stack a mismatched closer looks for its opener. */
const MAX_UNWIND = 64;

/**
 * Extracts the most plausible JSON value from free-form model output:
 * fenced ```json blocks first (last one wins), then the largest balanced {...} / [...] span.
 * Linear in the reply length (model output can be steered by the reviewed code).
 */
export function extractJson(text: string): unknown | undefined {
  const tail = text.length > MAX_SCAN_CHARS ? text.slice(-MAX_SCAN_CHARS) : text;
  const fenced = [...tail.matchAll(/```(?:json|JSON)?[ \t\r]*\n([\s\S]*?)```/g)].map((m) => m[1] ?? '');
  for (const candidate of fenced.reverse().slice(0, MAX_PARSE_ATTEMPTS)) {
    const parsed = tryParse(candidate);
    if (parsed !== undefined) return parsed;
  }
  for (const candidate of balancedSpans(tail).slice(0, MAX_PARSE_ATTEMPTS)) {
    const parsed = tryParse(candidate);
    if (parsed !== undefined) return parsed;
  }
  return undefined;
}

function tryParse(s: string): unknown | undefined {
  const trimmed = s.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    // tolerate trailing commas, the most common model mistake
    try {
      return JSON.parse(trimmed.replace(/,\s*([}\]])/g, '$1'));
    } catch {
      return undefined;
    }
  }
}

/**
 * Maximal balanced {...} / [...] spans, longest first, found in one pass with a bracket stack. Quotes only
 * count inside brackets (prose quotes cannot swallow the JSON); unmatched openers are skipped.
 */
function balancedSpans(text: string): string[] {
  const stack: number[] = []; // positions of open brackets
  const spans: Array<[number, number]> = [];
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"' && stack.length) inString = true;
    else if (ch === '{' || ch === '[') stack.push(i);
    else if (ch === '}' || ch === ']') {
      const open = ch === '}' ? '{' : '[';
      const floor = Math.max(0, stack.length - MAX_UNWIND);
      let k = stack.length - 1;
      while (k >= floor && text[stack[k]!] !== open) k--;
      if (k < floor) continue; // a stray closer
      const start = stack[k]!;
      stack.length = k;
      spans.push([start, i]);
    }
  }
  // Spans nest or are disjoint: keep the outermost ones.
  spans.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const outer: Array<[number, number]> = [];
  let lastEnd = -1;
  for (const s of spans) {
    if (s[0] > lastEnd) {
      outer.push(s);
      lastEnd = s[1];
    }
  }
  return outer.sort((a, b) => b[1] - b[0] - (a[1] - a[0])).map(([s, e]) => text.slice(s, e + 1));
}
