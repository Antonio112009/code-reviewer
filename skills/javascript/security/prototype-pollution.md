---
name: Prototype pollution
description: Deep merge/set helpers and lodash-style path setters fed with request data, JSON.parse output copied with Object.assign, and dictionary lookups on plain objects that reach inherited members.
priority: 75
tags: [CWE-1321, CWE-915]
activation:
  content:
    - '__proto__|\bconstructor\s*\]|\[\s*[''"](?:constructor|prototype)[''"]\s*\]'
    - '\b_\.(?:merge|mergeWith|defaultsDeep|set|setWith|zipObjectDeep|unset|omit)\s*\('
    - '\b(?:deepMerge|deepmerge|mergeDeep|deepExtend|setPath|setIn|setDeep|assignDeep|dset|dot-prop|set-value|merge-deep|lodash\.merge|lodash\.set)\b'
    - '\bObject\.assign\s*\([^)\n]{0,80}\b(?:req|body|query|params|input|payload|data|JSON\.parse)\b'
    - '\[\s*(?:key|k|prop|field|name|segment|part|path\[\w+\])\s*\]\s*=[^=]'
sources:
  - https://cheatsheetseries.owasp.org/cheatsheets/Prototype_Pollution_Prevention_Cheat_Sheet.html
  - https://nodejs.org/en/learn/getting-started/security-best-practices#prototype-pollution-attacks-cwe-1321
  - https://github.com/advisories/GHSA-xxjr-mmjv-4gpg
---
- **Recursive merge/set on input**: custom deep-merge, clone or `setPath(obj, 'a.b.c', v)` helpers, and `_.merge`/`_.defaultsDeep`/`_.set`/`_.setWith`/`_.zipObjectDeep` on request data → `__proto__` or `constructor.prototype` keys write to `Object.prototype` for the whole process (`isAdmin` appears on every object). Fix: skip those keys, null-prototype targets, patched libraries.
- **`JSON.parse` + `Object.assign`**: `JSON.parse` creates an own `__proto__` key; `Object.assign(target, parsed)` then triggers the setter and swaps `target`'s prototype (object spread doesn't). Fix: validate with a schema that rejects unknown keys before copying.
- **Lookups reaching inherited members**: `handlers[req.query.action]()`, `ROLES[role]`, `if (cache[key])` → `constructor`, `toString`, `__proto__` resolve to built-ins → bypassed checks, calling unintended functions, crashes. Fix: `Object.hasOwn`, `Map`, `Object.create(null)`.
- **Pollution becomes RCE through gadgets**: libraries reading options from plain objects (template engines such as EJS < 3.1.7 `outputFunctionName`, `child_process` options, loggers) pick up polluted properties. Fix: pass explicit option objects; run with `--disable-proto=delete` and keep lodash ≥ 4.17.23.
