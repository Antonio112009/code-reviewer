import picomatch from 'picomatch';

/**
 * Globs that come from the reviewed repository (its config, its project skills) are untrusted:
 * picomatch compiles them to backtracking regexes, and globs such as `+(*)+(*)Z` or `*a*a*a*a*b` take
 * exponential or high-polynomial time on a long path or branch name — a hang Ctrl+C cannot interrupt.
 * These limits keep every accepted glob's regex cheap: no extglobs, at most one `*` per path segment,
 * at most two `**` segments, bounded length and brace alternatives; matched strings are bounded too.
 */
export const MAX_GLOB_LENGTH = 256;
const MAX_GLOBSTARS = 2;
const MAX_BRACE_ALTERNATIVES = 32;
/** Longer strings (paths, branch names) never match an untrusted glob. */
const MAX_SUBJECT_LENGTH = 1_024;

/** Why an untrusted glob is refused, or undefined when it is acceptable. */
export function unsafeGlobReason(glob: string): string | undefined {
  if (!glob) return 'empty';
  if (glob.length > MAX_GLOB_LENGTH) return `longer than ${MAX_GLOB_LENGTH} characters`;
  if (/[!@+*?]\(/.test(glob)) return 'extglob syntax (+(…), @(…), !(…), *(…), ?(…)) is not supported';
  const braces = (glob.match(/[{,]/g) ?? []).length;
  if (braces > MAX_BRACE_ALTERNATIVES) return `more than ${MAX_BRACE_ALTERNATIVES} brace alternatives`;
  if (/\{[^}]*\{/.test(glob)) return 'nested braces';
  let globstars = 0;
  for (const segment of glob.split('/')) {
    if (segment === '**') {
      globstars++;
      continue;
    }
    const stars = (segment.replace(/\\\*/g, '').match(/\*+/g) ?? []).length;
    if (stars > 1) return `more than one "*" in the path segment "${segment}"`;
  }
  if (globstars > MAX_GLOBSTARS) return `more than ${MAX_GLOBSTARS} "**" segments`;
  return undefined;
}

/**
 * Matcher for globs from an untrusted source: refused globs are dropped (reported through `onRefused`),
 * the rest compile like picomatch's `{ dot: true }` without extglobs, and over-long subjects never match.
 */
export function untrustedGlobMatcher(
  globs: string | readonly string[],
  onRefused?: (glob: string, reason: string) => void,
): (subject: string) => boolean {
  const accepted: string[] = [];
  for (const glob of typeof globs === 'string' ? [globs] : globs) {
    const reason = unsafeGlobReason(glob);
    if (reason) onRefused?.(glob, reason);
    else accepted.push(glob);
  }
  if (accepted.length === 0) return () => false;
  const match = picomatch(accepted, { dot: true, noextglob: true });
  return (subject) => subject.length <= MAX_SUBJECT_LENGTH && match(subject);
}
