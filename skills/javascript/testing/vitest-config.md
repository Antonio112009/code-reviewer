---
name: Vitest configuration and upgrades
description: Vitest defaults and version changes that alter which tests run and what they assert - node environment, Vitest 4 test discovery and pool rework, Vitest 5 clearMocks, unawaited async assertions, toThrow('') and name filters.
priority: 50
activation:
  files: ['**/vitest.config.*', '**/vitest.workspace.*']
  content:
    - '\bfrom\s*[''"]vitest(?:/config)?[''"]'
    - '\b(?:environment|pool|poolOptions|isolate|maxWorkers|singleFork|singleThread|fileParallelism|clearMocks|workspace|projects|testNamePattern)\s*:'
    - '@vitest-environment\b'
sources:
  - https://vitest.dev/guide/migration.html
  - https://v4.vitest.dev/guide/migration
  - https://vitest.dev/config/environment
---
- **Wrong environment**: the default `environment` is `node` → DOM tests need `jsdom`/`happy-dom` (config or `// @vitest-environment jsdom`); neither does layout (`getBoundingClientRect()` returns zeros) → layout logic passes untested.
- **Vitest 4 discovery**: only `node_modules` and `.git` are excluded by default → compiled `dist/**/*.test.js`, Cypress specs or fixtures named `*.test.*` are collected and run. Fix: `test.dir`/`include`, or re-add excludes.
- **Vitest 4 pool rework**: `poolOptions`, `maxThreads`/`maxForks` and `singleThread`/`singleFork` were replaced by `maxWorkers`/`isolate`; `singleFork` equals `maxWorkers: 1, isolate: false`, so modules are no longer reset between files. Fix: migrate the options; `vi.resetModules()` in setup if needed.
- **Vitest 5 behaviour changes**: `clearMocks` defaults to `true` (calls recorded in `beforeAll`, setup files or module scope are gone at assertion time); unawaited `expect(p).resolves/rejects` now fail (≤4 auto-awaited them, so missing `await`s passed); `toThrow('')` now matches any message; `-t` filters match `>`-joined names.
- **Isolation traded for speed**: `isolate: false` or external resources (DB, ports, temp dirs) shared by parallel files → module state and mocks leak across files, flaky failures. Fix: keep isolation; per-worker resources keyed by `VITEST_POOL_ID`.
