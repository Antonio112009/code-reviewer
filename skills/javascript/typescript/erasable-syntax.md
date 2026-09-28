---
name: Node type stripping (erasable TypeScript)
description: Running .ts files directly on Node 22.18+/23.6+ - non-erasable syntax (enums, namespaces, parameter properties, decorators), type-only imports without the type keyword, mandatory .ts extensions, ignored tsconfig paths and publishing .ts specifiers.
priority: 55
activation:
  versions: { runtime.node: '>=22' }
  content:
    - '\bfrom\s+[''"]\.{1,2}/[^''"\n]{1,200}\.[mc]?ts[''"]'
    - '\bimport\s*\(\s*[''"]\.{1,2}/[^''"\n]{1,200}\.[mc]?ts[''"]'
    - '\b(?:erasableSyntaxOnly|allowImportingTsExtensions|rewriteRelativeImportExtensions)\b'
    - '--(?:experimental-)?(?:strip|transform)-types'
  examples:
    - 'import { User } from ''./types.ts'';'
    - 'const config = await import(''./config.ts'');'
    - '"erasableSyntaxOnly": true,'
    - 'node --experimental-strip-types server.ts'
sources:
  - https://nodejs.org/api/typescript.html
  - https://www.typescriptlang.org/tsconfig/#erasableSyntaxOnly
  - https://www.typescriptlang.org/tsconfig/#rewriteRelativeImportExtensions
---
- **Non-erasable syntax**: `enum`, `namespace` with values, constructor parameter properties (`constructor(private db: Db)`) and `import x = …` aliases throw `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`; decorators are a parse error; `--experimental-transform-types` is gone in Node 26. Fix: `erasableSyntaxOnly` (TS ≥5.8) and plain-JS equivalents.
- **Type imports need `type`**: `import { User } from './types.ts'` where `User` is only a type → the missing export fails at runtime. Fix: `import type`/inline `type`; enforce with `verbatimModuleSyntax`.
- **Extensions and paths**: relative imports must spell `.ts`, `tsconfig` is ignored (`paths` aliases fail - use `#` subpath imports), `.tsx` and TypeScript inside `node_modules` are refused. Fix: `allowImportingTsExtensions` for type-checking.
- **Publishing `.ts` specifiers**: building the same code with `tsc` keeps `./db.ts` in emitted JS → the package can't resolve its own files unless `rewriteRelativeImportExtensions` (TS ≥5.7) is on. Fix: enable it for emitted builds.
- **No down-leveling, module type from package.json**: `.ts` follows the nearest `"type"` (`.mts` ESM, `.cts` CJS) and syntax runs as written → a CJS package with `import` syntax or syntax newer than the running Node breaks. Fix: explicit `.mts`/`.cts` or `"type"`.
