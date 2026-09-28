---
name: File system
description: Check-then-act races, non-atomic and concurrent writes, leaked FileHandles (closing on GC throws since Node 25), unreliable fs.watch, and paths resolved against process.cwd().
priority: 55
tags: [CWE-367, CWE-404]
activation:
  content:
    - '\bfs(?:Promises)?\.\w+\s*\(|[''"](?:node:)?fs(?:/promises)?[''"]'
    - '\b(?:readFile|writeFile|appendFile|existsSync|access|lstat|mkdir|rename|unlink|opendir|copyFile)(?:Sync)?\s*\('
  examples:
    - 'import fs from "node:fs/promises";'
    - 'const exists = fs.existsSync(configPath);'
sources:
  - https://nodejs.org/api/fs.html#fsaccesspath-mode-callback
  - https://nodejs.org/api/fs.html#fspromiseswritefilefile-data-options
  - https://nodejs.org/api/deprecations.html#dep0137-closing-fsfilehandle-on-garbage-collection
  - https://nodejs.org/api/fs.html#caveats
---
- **Check-then-act**: `existsSync`/`access`/`stat` before `open`, `readFile`, `writeFile` or `unlink` races with other processes (the docs advise against it). Fix: act directly and handle `ENOENT`/`EEXIST`; `flag: 'wx'` for create-if-absent.
- **Non-atomic writes**: `writeFile` truncates then writes → readers see empty or partial files and a crash mid-write corrupts state; concurrent `writeFile`/`appendFile` calls to one file interleave. Fix: write a temp file in the same directory, then `rename`; serialize writers.
- **Leaked handles**: `fsPromises.open()`/`opendir()` without `close()` in `finally` → `EMFILE`; a FileHandle left to GC used to warn and throws since Node 25 (DEP0137). Fix: `try/finally` or `await using` (Node ≥24).
- **`fs.watch` is unreliable**: duplicate or missing events, `filename` may be `null`, rename vs change differs per platform → reload loops or missed changes. Fix: debounce and re-`stat`, or a watcher library.
- **Relative to `cwd`**: `readFile('config.json')` resolves against `process.cwd()`, not the module → breaks under systemd, Docker `WORKDIR`, monorepo scripts or tests. Fix: `path.join(import.meta.dirname, 'config.json')` (Node ≥20.11) or `__dirname`.
