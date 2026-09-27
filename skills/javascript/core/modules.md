---
name: ES module semantics
description: Circular imports and TDZ errors, setup code that runs after imports (dotenv), top-level await blocking importers, duplicated module instances, dynamic import() shape and read-only live bindings.
priority: 55
activation:
  content:
    - '^\s*import\s[^''"\n]{0,200}from\s*[''"]\.{1,2}/'
    - '^\s*export\s+(?:let|var|default)\b'
    - '\bimport\s*\('
    - '^await\s|^(?:const|let|var)\s[^=\n]{1,80}=\s*await\s'
    - '\bdotenv\b'
sources:
  - https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules
  - https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/import
  - https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/await#top_level_await
  - https://nodejs.org/api/esm.html#commonjs-namespaces
---
- **Circular imports**: a cycle evaluates a module before its dependency finishes → `ReferenceError: Cannot access 'X' before initialization` (or `undefined` in CJS), often only from one entry point or test order. Fix: extract shared code, or read bindings lazily inside functions.
- **Setup runs after imports**: static imports are evaluated before the importing module's body, so `import db from './db'; dotenv.config();` (or polyfills and globals set in code) runs after `db` already read `process.env`. Fix: `import 'dotenv/config'` first, or `node --env-file`.
- **Top-level `await`**: suspends every importer until it settles; a TLA waiting on something that needs the importer deadlocks, and network calls at import time slow startup and tests. Fix: keep TLA in entry points, export async initializers.
- **Duplicate module instances**: one file reached via different specifiers (`./a.js` vs `./a.js?v=1`, symlinks) or two package versions → two caches/pools, broken singletons and `instanceof`. Fix: one canonical path, dedupe dependencies.
- **Dynamic `import()` shape**: it resolves to the namespace; the default export is `mod.default` (for CommonJS targets that is `module.exports`) → calling `mod()` or reading undetected named exports fails. Fix: destructure the right export.
- **Read-only live bindings**: assigning to an imported binding throws `TypeError`; `export let x` reassigned later changes what importers see, while `export default expr` is a snapshot. Fix: export functions or objects to mutate state.
