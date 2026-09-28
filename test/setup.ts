import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll } from 'vitest';

// Tests never touch the user's cache or signing key: every test file gets its own cache directory, and a
// fixed key (child processes such as `node dist/cli.js` inherit both).
const dir = mkdtempSync(path.join(tmpdir(), 'cr-test-cache-'));
process.env.CODE_REVIEWER_CACHE_DIR = dir;
process.env.CODE_REVIEWER_CACHE_KEY = 'test-cache-key-0123456789abcdef0123456789abcdef';

afterAll(() => rmSync(dir, { recursive: true, force: true }));
