---
name: Type assertions at runtime boundaries
description: as-casts, non-null assertions and "typed" fetch/JSON helpers on unvalidated data, lying type guards, as on object literals, any leaks and suppression comments, and types that do not strip extra fields.
priority: 65
tags: [CWE-20, CWE-704, CWE-213]
activation:
  content:
    - '^(?!\s*(?:import|export)\b)[^\n]*?\bas\s+(?:[A-Z]|unknown\b|any\b|\{)'
    - '[\w$)\]]!(?:\.|\[|\)|;|,)'
    - '\):\s*[\w$]+\s+is\s+[\w$]|\basserts\s+[\w$]+\s+is\b'
    - '\bJSON\.parse\s*\(|\.json\s*(?:<[^>\n]{1,80}>)?\s*\(\s*\)'
    - '@ts-(?:ignore|nocheck|expect-error)\b|:\s*any\b'
  examples:
    - 'const user = req.body as CreateUser;'
    - 'const name = map.get(id)!.name;'
    - 'function isUser(x: unknown): x is User {'
    - 'const config = JSON.parse(raw) as Config;'
    - 'let payload: any;'
sources:
  - https://www.typescriptlang.org/docs/handbook/2/everyday-types.html#type-assertions
  - https://www.typescriptlang.org/docs/handbook/2/narrowing.html#using-type-predicates
  - https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-9.html#the-satisfies-operator
---
- **Casting unvalidated input**: `req.body as CreateUser`, `JSON.parse(s) as Config`, `(await res.json()) as T`, `get<T>(url)` helpers and env/storage reads typed by assertion → the compiler trusts shapes nobody checked; crashes surface far away. Fix: parse with a schema at the boundary.
- **Non-null assertions hiding misses**: `map.get(id)!`, `arr.find(…)!`, `querySelector(…)!`, `process.env.KEY!` → `undefined` at runtime where the type promised a value. Fix: handle the miss with a clear error.
- **Lying type guards**: `x is T` or `asserts x is T` functions that check less than `T` promises (only `typeof x === 'object'`, one field) → every caller trusts a wrong shape. Fix: check each field used, or derive guards from a schema.
- **`as` on object literals**: `{ retries: 3 } as Config` compiles although required props (`timeout`) are missing → `undefined` at runtime. Fix: annotate (`const c: Config = …`) or use `satisfies Config`.
- **`any` leaks and suppressions**: `as any`, `: any`, `JSON.parse` results or untyped libraries flow into typed code and disable checks downstream; `@ts-ignore`/`@ts-nocheck` also hide future errors. Fix: `unknown` + narrowing; `@ts-expect-error` with a reason.
- **Types don't strip data**: an entity returned as `PublicUser`, or `req.body` typed as a DTO, still carries every runtime field → password hashes serialized, extra columns mass-assigned. Fix: map fields explicitly.
