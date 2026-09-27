---
name: ES2023-ES2026 built-ins vs runtime support
description: Newer built-ins and syntax (toSorted, groupBy, withResolvers, Set methods, iterator helpers, RegExp.escape, using, Uint8Array base64, Map.getOrInsert, Temporal) used where the supported Node or browser versions lack them.
priority: 60
activation:
  content:
    - '\.(?:toSorted|toReversed|toSpliced|findLast|findLastIndex)\s*\('
    - '\b(?:Object|Map)\.groupBy\s*\(|\bPromise\.(?:withResolvers|try)\s*\('
    - '\.(?:union|intersection|difference|symmetricDifference|isSubsetOf|isSupersetOf|isDisjointFrom|getOrInsert|getOrInsertComputed)\s*\('
    - '\bIterator\.(?:from|concat)\s*\(|\.values\(\)\.(?:map|filter|take|drop|toArray)\('
    - '\b(?:RegExp\.escape|Error\.isError|Array\.fromAsync|Math\.sumPrecise|Uint8Array\.from(?:Base64|Hex))\s*\(|\.to(?:Base64|Hex)\s*\('
    - '\bTemporal\.|\bFloat16Array\b|\bSymbol\.(?:asyncDispose|dispose)\b'
    - '(?:^|[;{]\s*)(?:await\s+)?using\s+[A-Za-z_$][\w$]*\s*='
    - '\(\?-?[ims]{1,3}(?:-[ims]{1,3})?:'
sources:
  - https://github.com/mdn/browser-compat-data
  - https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/using#browser_compatibility
  - https://nodejs.org/en/blog/release/v24.0.0
  - https://nodejs.org/en/blog/release/v26.0.0
---
- **Transpilers don't add APIs**: TS/Babel/esbuild lower syntax only; `lib: ["ESNext"]` lets new methods type-check though the runtime lacks them → `TypeError: x is not a function` on older Node, Safari or webviews. Fix: check `engines`/browserslist; polyfill or fall back.
- **ES2023-2024**: `toSorted`/`toReversed`/`toSpliced`/`with` need Node ≥20, Safari 16; `Object.groupBy`/`Map.groupBy` Node ≥21, Safari 17.4; `Promise.withResolvers` Node ≥22, Safari 17.4; `Array.fromAsync` Node ≥22.
- **ES2025**: Set methods (`union`, `intersection`…) and iterator helpers need Node ≥22 (iterator helpers: Safari 18.4); `Promise.try` Node ≥23; `RegExp.escape` and `Float16Array` Node ≥24, Safari 18.2.
- **New syntax breaks the whole file**: `using`/`await using` (Node ≥24, Chrome 134, Firefox 141, no Safari) and regex modifiers `(?i:…)` (Node ≥23, Safari 26) are `SyntaxError`s that fail the entire module or bundle, not one call. Fix: transpile or avoid.
- **ES2026 and newer**: `Error.isError` Node ≥24.3; `Uint8Array.fromBase64`/`toBase64` Node ≥25, Chrome 140; `Map.getOrInsert*`, `Iterator.concat`, `Temporal` Node ≥26 (no Temporal in Safari); `Math.sumPrecise` not in Node.
