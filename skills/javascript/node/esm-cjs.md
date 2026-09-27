---
name: ESM and CommonJS interop in Node
description: Flipping package.json type, CommonJS globals in ESM, require(esm) version limits and ERR_REQUIRE_ASYNC_MODULE, named imports from CJS, exports maps and dual packages, JSON import attributes and Node 26 extensionless files.
priority: 60
activation:
  content:
    - '"type"\s*:\s*"(?:module|commonjs)"|"exports"\s*:'
    - '\brequire\s*\(|\bmodule\.exports\b|\bexports\.[\w$]+\s*='
    - '\b__(?:dirname|filename)\b|\bimport\.meta\.(?:url|dirname|filename)\b|\bcreateRequire\s*\('
    - '\bwith\s*\{\s*type\s*:|\bassert\s*\{\s*type\s*:'
sources:
  - https://nodejs.org/api/modules.html#loading-ecmascript-modules-using-require
  - https://nodejs.org/api/esm.html#interoperability-with-commonjs
  - https://nodejs.org/api/packages.html#determining-module-system
  - https://nodejs.org/en/blog/release/v26.0.0
---
- **Flipping `"type"`**: adding or removing `"type": "module"` changes how every `.js` file in the package loads (scripts, `jest.config.js`, tool configs) → `require is not defined` or `Cannot use import statement…`. Fix: rename exceptions to `.cjs`/`.mjs`.
- **CJS globals in ESM**: `__dirname`, `__filename`, `require`, `module.exports` don't exist in ESM → `ReferenceError` on some rarely hit path. Fix: `import.meta.dirname` (Node ≥20.11), `createRequire(import.meta.url)`.
- **`require(esm)` limits**: unflagged only on Node ≥20.19/22.12 (older: `ERR_REQUIRE_ESM`); a top-level `await` anywhere in the graph throws `ERR_REQUIRE_ASYNC_MODULE`; the default export is under `.default`. Fix: `await import()`.
- **Named imports from CJS**: `import { x } from './legacy.cjs'` works only if `exports.x = …` is statically detectable; dynamic exports → `SyntaxError: Named export 'x' not found`. Fix: default import, then destructure.
- **Package `exports`**: once present, deep imports throw `ERR_PACKAGE_PATH_NOT_EXPORTED`; conditions match in order (`types` first, `default` last); CJS+ESM builds can load twice (duplicate singletons, failing `instanceof`).
- **Version changes**: JSON imports need `with { type: 'json' }` (`assert` removed in Node 22); Node 26 loads extensionless files in a `"type": "module"` package as ESM even via `require()` → CommonJS `bin/` scripts break. Fix: `.cjs`.
