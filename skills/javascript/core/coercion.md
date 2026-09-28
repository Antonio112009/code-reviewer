---
name: Coercion and defaults
description: Logical-OR defaults that eat valid falsy values, string vs number id comparisons, lenient numeric parsing and truthy strings such as 'false' or '0' from env vars and forms.
priority: 60
tags: [CWE-704, CWE-697]
activation:
  content:
    - '\|\|\s*(?:-?\d|[''"`\[{]|true\b|false\b|null\b|[A-Z][A-Z0-9_]{2,}\b|new\s)|\|\|='
    - '\b(?:parseInt|parseFloat|Number|isNaN)\s*\('
    - '[^=!<>]==[^=]|!=[^=]'
    - '\bprocess\.env\.\w+\s*(?:\)|&&|\|\||\?|$)'
  examples:
    - 'const retries = opts.retries || 3;'
    - 'const id = parseInt(req.params.id, 10);'
    - 'if (role != ''admin'') return;'
    - 'if (process.env.DISABLE_AUTH) return next();'
sources:
  - https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Nullish_coalescing
  - https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Number#number_coercion
  - https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/parseInt
  - https://developer.mozilla.org/en-US/docs/Glossary/Truthy
---
- **`||` default eats valid values**: `opts.retries || 3`, `price || DEFAULT`, `limit || 50` replace legitimate `0`, `''`, `false` → retries can't be disabled, free items get a price. Fix: `??` / `??=`.
- **String vs number ids**: route/query params or JSON string ids compared with `===` to numbers (`req.params.id === user.id`) never match → ownership checks always fail, `!==` guards always pass. Fix: convert and validate first.
- **Lenient parsing**: `Number('')`/`Number(null)` → `0`, `parseInt('12abc')` → `12`, `['1','2'].map(parseInt)` → `[1, NaN]`, `parseFloat('1,5')` → `1`, `isNaN('')` → false → garbage input accepted as numbers. Fix: check the format, then `Number.isFinite`.
- **Truthy strings**: env vars and form/query values are strings - `'false'`, `'0'`, `' '` are truthy, so `if (process.env.DISABLE_AUTH)` or `Boolean(req.query.admin)` enables the flag. Fix: compare explicitly (`=== 'true'`) or parse with a schema.
- **Loose equality**: `==` coerces (`'' == 0`, `'0' == false`, `[] == false`); only `x == null` (null or undefined) is a safe idiom. Fix: `===` after explicit conversion.
