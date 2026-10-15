import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs';
import { open } from 'node:fs/promises';

/*
 * Reading a file that something else may change meanwhile (the reviewed checkout is untrusted). The file is
 * opened once, its type and size are checked on that descriptor, and the same descriptor is read: a file
 * swapped between a check and the read (for a symlink out of the root, a FIFO, or a larger file) cannot slip
 * through. A symlink is not followed unless `follow` is set (Windows has no O_NOFOLLOW: callers there keep
 * their own lstat check). O_NONBLOCK keeps a FIFO from blocking the open.
 */

const NOFOLLOW = constants.O_NOFOLLOW ?? 0;
const NONBLOCK = constants.O_NONBLOCK ?? 0;

export type ReadSkip = 'missing' | 'not-a-file' | 'too-large';
export type ReadOutcome = { data: Buffer } | { skip: ReadSkip; size?: number };

export interface ReadOptions {
  /** Larger files are not read (`skip: 'too-large'`, with their size). */
  maxBytes: number;
  /** Follow a symlink at the path itself (default: no, a symlink is `not-a-file`). */
  follow?: boolean;
}

function flags(follow: boolean | undefined): number {
  return constants.O_RDONLY | NONBLOCK | (follow ? 0 : NOFOLLOW);
}

/** `ELOOP` (a symlink under O_NOFOLLOW) and friends: something that is not a regular file. */
function skipFor(err: unknown): ReadOutcome {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  return { skip: code === 'ENOENT' || code === 'ENOTDIR' ? 'missing' : 'not-a-file' };
}

/** A regular file's bytes, read through one descriptor (see above); never throws. */
export async function readRegularFile(file: string, opts: ReadOptions): Promise<ReadOutcome> {
  let fh: Awaited<ReturnType<typeof open>>;
  try {
    fh = await open(file, flags(opts.follow));
  } catch (err) {
    return skipFor(err);
  }
  try {
    const st = await fh.stat();
    if (!st.isFile()) return { skip: 'not-a-file' };
    if (st.size > opts.maxBytes) return { skip: 'too-large', size: st.size };
    // Read at most one byte past the limit: a file that grew since the stat is still refused.
    const buf = Buffer.alloc(Math.min(st.size, opts.maxBytes) + 1);
    let n = 0;
    while (n < buf.length) {
      const { bytesRead } = await fh.read(buf, n, buf.length - n, n);
      if (bytesRead === 0) break;
      n += bytesRead;
    }
    if (n > opts.maxBytes) return { skip: 'too-large', size: n };
    return { data: buf.subarray(0, n) };
  } catch (err) {
    return skipFor(err);
  } finally {
    await fh.close().catch(() => undefined);
  }
}

/** Synchronous {@link readRegularFile}. */
export function readRegularFileSync(file: string, opts: ReadOptions): ReadOutcome {
  let fd: number;
  try {
    fd = openSync(file, flags(opts.follow));
  } catch (err) {
    return skipFor(err);
  }
  try {
    const st = fstatSync(fd);
    if (!st.isFile()) return { skip: 'not-a-file' };
    if (st.size > opts.maxBytes) return { skip: 'too-large', size: st.size };
    const buf = Buffer.alloc(Math.min(st.size, opts.maxBytes) + 1);
    let n = 0;
    while (n < buf.length) {
      const read = readSync(fd, buf, n, buf.length - n, n);
      if (read === 0) break;
      n += read;
    }
    if (n > opts.maxBytes) return { skip: 'too-large', size: n };
    return { data: buf.subarray(0, n) };
  } catch (err) {
    return skipFor(err);
  } finally {
    closeSync(fd);
  }
}

/** The file's text (UTF-8), or undefined when it is missing, not a regular file or too large. */
export async function readRegularText(file: string, opts: ReadOptions): Promise<string | undefined> {
  const r = await readRegularFile(file, opts);
  return 'data' in r ? r.data.toString('utf8') : undefined;
}

/** Synchronous {@link readRegularText}. */
export function readRegularTextSync(file: string, opts: ReadOptions): string | undefined {
  const r = readRegularFileSync(file, opts);
  return 'data' in r ? r.data.toString('utf8') : undefined;
}
