---
name: Unsound narrowing and indexing
description: Where TypeScript is unsound by design - unchecked index access, narrowing kept across await and callbacks, missing exhaustiveness checks, array covariance, Object.keys typing, compile-time-only readonly and excess-property checks.
priority: 55
activation:
  content:
    - '\[\s*(?:0|i|j|idx|index|key|k|id|name)\s*\]|\bRecord<|\[\s*\w+\s*:\s*string\s*\]\s*:'
    - '\bif\s*\(\s*!?this\.[\w$]+\s*\)'
    - '\bswitch\s*\(|\bdefault\s*:'
    - '\bObject\.(?:keys|entries)\s*\(|\bas\s+(?:\(\s*)?keyof\b'
    - '\breadonly\s|\bReadonly<|\bas\s+const\b'
  examples:
    - 'const first = arr[i];'
    - 'if (this.conn) { await x(); this.conn.query(); }'
    - 'switch (status) {'
    - 'const keys = Object.keys(obj) as (keyof Config)[];'
    - 'const config = { retries: 3 } as const;'
sources:
  - https://www.typescriptlang.org/tsconfig/#noUncheckedIndexedAccess
  - https://www.typescriptlang.org/docs/handbook/2/narrowing.html#exhaustiveness-checking
  - https://www.typescriptlang.org/docs/handbook/type-compatibility.html
  - https://www.typescriptlang.org/docs/handbook/2/objects.html#excess-property-checks
---
- **Unchecked index access**: without `noUncheckedIndexedAccess` (not part of `strict`), `arr[i]`, `const [first] = list` and `record[key]` are typed `T`, not `T | undefined` → `undefined` flows on and crashes later. Fix: enable the flag or handle the miss.
- **Stale narrowing**: a property checked before an `await`, callback or method call (`if (this.conn) { await x(); this.conn.query() }`) stays narrowed although it may be reset meanwhile → null access. Fix: copy into a local `const` first.
- **Missing exhaustiveness**: a `switch` or `if` chain over a union without a `never` check → a newly added member silently falls through (nothing happens, `undefined` returned). Fix: `default: { const _x: never = value; }`.
- **Array covariance**: a `Dog[]` passed as `Animal[]` can get a `Cat` pushed; method-shorthand parameters are bivariant (outside `strictFunctionTypes`) → callbacks get values they don't handle. Fix: `readonly` array params, function-property syntax.
- **Keys are just strings**: `Object.keys(o) as (keyof T)[]` and `for…in` also yield extra runtime keys (payload fields, DB columns) → lookups the type says can't happen. Fix: iterate a known key list.
- **Compile-time-only guarantees**: `readonly`, `Readonly<T>`, `as const` are shallow and erased (aliases still mutate); excess-property checks apply only to fresh literals, so a misspelled option in a variable (`{ retrys: 3 }`) passes and the default applies. Fix: `Object.freeze`; annotate literals where created.
