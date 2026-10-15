import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { readRegularFile, readRegularFileSync, readRegularText } from '../src/util/files';

const dir = mkdtempSync(path.join(tmpdir(), 'cr-files-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('reading a regular file through one descriptor', () => {
  const file = path.join(dir, 'a.txt');
  writeFileSync(file, 'hello\n');

  it('reads a regular file, and refuses a missing, oversized or non-regular one', async () => {
    expect(await readRegularText(file, { maxBytes: 100 })).toBe('hello\n');
    expect(readRegularFileSync(file, { maxBytes: 100 })).toEqual({ data: Buffer.from('hello\n') });
    expect(await readRegularFile(path.join(dir, 'nope'), { maxBytes: 100 })).toEqual({ skip: 'missing' });
    expect(await readRegularFile(file, { maxBytes: 3 })).toEqual({ skip: 'too-large', size: 6 });
    expect(readRegularFileSync(file, { maxBytes: 3 })).toEqual({ skip: 'too-large', size: 6 });
    expect(await readRegularFile(dir, { maxBytes: 100 })).toEqual({ skip: 'not-a-file' });
  });

  it.skipIf(process.platform === 'win32')('does not follow a symlink unless asked to', async () => {
    const link = path.join(dir, 'link');
    symlinkSync(file, link);
    expect(await readRegularFile(link, { maxBytes: 100 })).toEqual({ skip: 'not-a-file' });
    expect(readRegularFileSync(link, { maxBytes: 100 })).toEqual({ skip: 'not-a-file' });
    expect(await readRegularText(link, { maxBytes: 100, follow: true })).toBe('hello\n');
  });

  it.skipIf(process.platform === 'win32')('does not block on a FIFO', async () => {
    const fifo = path.join(dir, 'fifo');
    execFileSync('mkfifo', [fifo]);
    expect(await readRegularFile(fifo, { maxBytes: 100 })).toEqual({ skip: 'not-a-file' });
    expect(readRegularFileSync(fifo, { maxBytes: 100 })).toEqual({ skip: 'not-a-file' });
  });
});
