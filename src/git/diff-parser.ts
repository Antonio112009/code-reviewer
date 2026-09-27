import type { DiffLine, FileDiff, Hunk } from '../types';

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;

/** Parses `git diff` unified output (with a/ b/ prefixes) into structured file diffs. */
export function parseUnifiedDiff(diff: string): FileDiff[] {
  const files: FileDiff[] = [];
  const lines = diff.split('\n');
  let file: FileDiff | undefined;
  let hunk: Hunk | undefined;
  let oldLine = 0;
  let newLine = 0;
  let oldRemaining = 0;
  let newRemaining = 0;

  const finish = () => {
    if (file) files.push(file);
    file = undefined;
    hunk = undefined;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';

    if (line.startsWith('diff --git ')) {
      finish();
      const [a, b] = splitDiffGitPaths(line.slice('diff --git '.length));
      file = { path: b ?? a ?? '', oldPath: a, status: 'modified', binary: false, hunks: [] };
      continue;
    }
    if (!file) continue;

    const inHunkBody = hunk !== undefined && (oldRemaining > 0 || newRemaining > 0);
    if (inHunkBody && (line.startsWith(' ') || line.startsWith('+') || line.startsWith('-') || line === '')) {
      // Some tools strip the trailing space of empty context lines, hence `line === ''`.
      const text = line.slice(1);
      let entry: DiffLine;
      if (line.startsWith('+')) {
        entry = { type: 'add', text, newLine: newLine++ };
        newRemaining--;
      } else if (line.startsWith('-')) {
        entry = { type: 'del', text, oldLine: oldLine++ };
        oldRemaining--;
      } else {
        entry = { type: 'ctx', text, oldLine: oldLine++, newLine: newLine++ };
        oldRemaining--;
        newRemaining--;
      }
      hunk!.lines.push(entry);
      continue;
    }
    if (line.startsWith('\\ ')) continue; // "\ No newline at end of file"

    const hunkMatch = HUNK_RE.exec(line);
    if (hunkMatch) {
      oldLine = Number(hunkMatch[1]);
      newLine = Number(hunkMatch[3]);
      hunk = {
        header: line,
        oldStart: oldLine,
        oldLines: hunkMatch[2] === undefined ? 1 : Number(hunkMatch[2]),
        newStart: newLine,
        newLines: hunkMatch[4] === undefined ? 1 : Number(hunkMatch[4]),
        lines: [],
      };
      oldRemaining = hunk.oldLines;
      newRemaining = hunk.newLines;
      file.hunks.push(hunk);
      continue;
    }

    if (/^(?:new file|deleted file|old|new) mode 160000\b/.test(line) || /^index \S+ 160000$/.test(line)) {
      file.submodule = true;
    }
    if (line.startsWith('new file mode')) file.status = 'added';
    else if (line.startsWith('deleted file mode')) file.status = 'deleted';
    else if (line.startsWith('rename from ')) {
      file.oldPath = unquote(line.slice('rename from '.length));
      file.status = 'renamed';
    } else if (line.startsWith('rename to ')) {
      file.path = unquote(line.slice('rename to '.length));
      file.status = 'renamed';
    } else if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) {
      file.binary = true;
    } else if (line.startsWith('--- ')) {
      const p = stripPrefix(line.slice(4), 'a/');
      if (p !== null) file.oldPath = p;
    } else if (line.startsWith('+++ ')) {
      const p = stripPrefix(line.slice(4), 'b/');
      if (p !== null) file.path = p;
    }
  }
  finish();

  for (const f of files) {
    if (f.status === 'deleted') f.path = f.oldPath ?? f.path;
    if (f.status === 'modified' && f.oldPath === f.path) f.oldPath = undefined;
    if (f.status === 'added') f.oldPath = undefined;
  }
  return files;
}

/** Returns the path without the prefix, or null for /dev/null. */
function stripPrefix(raw: string, prefix: string): string | null {
  const p = unquote(raw.replace(/\t$/, ''));
  if (p === '/dev/null') return null;
  return p.startsWith(prefix) ? p.slice(prefix.length) : p;
}

function splitDiffGitPaths(rest: string): [string | undefined, string | undefined] {
  if (rest.startsWith('"')) {
    const m = /^("(?:[^"\\]|\\.)*")\s+(.*)$/.exec(rest);
    if (m) return [strip(unquote(m[1]!), 'a/'), strip(unquote(m[2]!), 'b/')];
  }
  // Unquoted "a/X b/X": when both sides are equal the midpoint split is unambiguous.
  const mid = (rest.length - 1) / 2;
  if (Number.isInteger(mid)) {
    const a = rest.slice(0, mid);
    const b = rest.slice(mid + 1);
    if (a.slice(2) === b.slice(2)) return [strip(a, 'a/'), strip(b, 'b/')];
  }
  const idx = rest.indexOf(' b/');
  if (idx > 0) return [strip(rest.slice(0, idx), 'a/'), strip(rest.slice(idx + 1), 'b/')];
  return [undefined, undefined];
}

function strip(p: string, prefix: string): string {
  return p.startsWith(prefix) ? p.slice(prefix.length) : p;
}

/** Undoes git's C-style path quoting (octal escapes are UTF-8 bytes). */
export function unquote(p: string): string {
  if (!(p.startsWith('"') && p.endsWith('"'))) return p;
  const body = p.slice(1, -1);
  const bytes: number[] = [];
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    if (ch !== '\\') {
      bytes.push(...Buffer.from(ch, 'utf8'));
      continue;
    }
    const next = body[++i];
    if (next === undefined) break;
    if (/[0-7]/.test(next)) {
      const oct = body.slice(i, i + 3);
      bytes.push(Number.parseInt(oct, 8));
      i += 2;
    } else {
      const map: Record<string, string> = {
        n: '\n',
        t: '\t',
        '"': '"',
        '\\': '\\',
        a: '\x07',
        b: '\b',
        f: '\f',
        r: '\r',
        v: '\v',
      };
      bytes.push(...Buffer.from(map[next] ?? next, 'utf8'));
    }
  }
  return Buffer.from(bytes).toString('utf8');
}

/** 1-based inclusive ranges of added lines in the new file, merged when adjacent. */
export function addedRanges(hunks: Hunk[]): Array<[number, number]> {
  const lines = hunks.flatMap((h) => h.lines.filter((l) => l.type === 'add').map((l) => l.newLine!));
  const ranges: Array<[number, number]> = [];
  for (const n of lines.sort((a, b) => a - b)) {
    const last = ranges[ranges.length - 1];
    if (last && n <= last[1] + 1) last[1] = Math.max(last[1], n);
    else ranges.push([n, n]);
  }
  return ranges;
}
