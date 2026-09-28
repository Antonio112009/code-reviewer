---
name: tsconfig pitfalls
description: Compiler options whose effect only shows at runtime - bundler resolution for Node-run code, paths aliases that are not rewritten, synthetic default imports without interop, isolatedModules with per-file transpilers, and loosened strictness.
priority: 55
activation:
  files: ['**/tsconfig.json', '**/tsconfig.*.json']
  content:
    - '"(?:strict|strictNullChecks|noImplicitAny|skipLibCheck|module|moduleResolution|paths|baseUrl|esModuleInterop|allowSyntheticDefaultImports|verbatimModuleSyntax|isolatedModules)"\s*:'
  examples:
    - '"moduleResolution": "bundler",'
sources:
  - https://www.typescriptlang.org/docs/handbook/modules/reference.html#the-moduleresolution-compiler-option
  - https://www.typescriptlang.org/tsconfig/#paths
  - https://www.typescriptlang.org/tsconfig/#esModuleInterop
  - https://www.typescriptlang.org/tsconfig/#isolatedModules
---
- **`moduleResolution: "bundler"` for code Node runs directly**: extensionless relative and directory imports type-check but fail at runtime (`ERR_MODULE_NOT_FOUND`, `ERR_UNSUPPORTED_DIR_IMPORT`). Fix: `"module": "nodenext"` (resolution follows) for Node-executed output.
- **`paths` aren't rewritten**: `@/lib/x` aliases compile, but emitted JS keeps the alias → `Cannot find module` at runtime unless a bundler, loader or package `imports` (`#lib/*`) maps it; test runners need the same mapping. Fix: subpath imports or matching bundler/runner aliases.
- **Synthetic defaults without interop**: `allowSyntheticDefaultImports: true` with `esModuleInterop: false` lets `import x from 'cjs-lib'` compile to `require(…).default` → `undefined`/"x is not a function" at runtime (TS ≥6 forbids `false`). Fix: enable `esModuleInterop`.
- **Per-file transpilers without `isolatedModules`**: esbuild/SWC/Babel can't tell that `export { T } from './types'` re-exports only a type → the emitted re-export of a missing binding fails at runtime. Fix: `isolatedModules` or `verbatimModuleSyntax`, plus `export type`.
- **Loosened checks**: `strict: false`, `strictNullChecks: false` or `noImplicitAny: false` (often added to silence an upgrade) disable null safety for every file; `skipLibCheck: true` hides conflicting `@types` versions. Fix: fix the errors or scope exceptions narrowly.
