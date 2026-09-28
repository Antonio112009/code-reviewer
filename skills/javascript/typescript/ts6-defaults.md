---
name: TypeScript 6 and 7 default changes
description: TypeScript 6.0/7.0 defaults that silently change emitted output (rootDir, module, target), strict-by-default escapes, and deprecated options kept alive with ignoreDeprecations that TypeScript 7 rejects.
priority: 60
activation:
  versions: { lang.typescript: '>=6' }
  files: ['**/tsconfig.json', '**/tsconfig.*.json']
  content:
    - '"(?:rootDir|outDir|module|target|strict|ignoreDeprecations|baseUrl|moduleResolution|esModuleInterop|downlevelIteration|outFile)"\s*:'
  examples:
    - '"rootDir": "./src",'
sources:
  - https://devblogs.microsoft.com/typescript/announcing-typescript-6-0/
  - https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/
---
- **`rootDir` defaults to the tsconfig folder**: with sources in `src/` and no explicit `rootDir`, output moves from `dist/index.js` to `dist/src/index.js` → `main`/`bin`/`exports`, start scripts and Docker `CMD` point to missing files. Fix: `"rootDir": "./src"`.
- **`module` defaults to `esnext`, `target` floats (es2025)**: a tsconfig that omitted them now emits `import`/`export` and newer syntax → CommonJS packages fail with `Cannot use import statement outside a module`; older runtimes can't parse the output. Fix: set both explicitly.
- **`strict` on by default**: silencing the resulting errors with `"strict": false` turns off null checks for all code instead of the few files that needed it. Fix: keep strict, fix or scope the errors.
- **Deprecations fail in 7.0**: `"ignoreDeprecations": "6.0"` only postpones `baseUrl`, `moduleResolution: node10`/`classic`, `esModuleInterop: false`, `target: es5`, `outFile`, AMD/UMD and `downlevelIteration`; TypeScript 7 (July 2026) rejects them. Fix: migrate (`ts5to6` codemod).
