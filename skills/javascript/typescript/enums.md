---
name: Enums
description: Numeric enum reverse mappings and loose number assignability, const enums under per-file transpilers, and string enum values at JSON/DB boundaries.
priority: 50
activation:
  content:
    - '\b(?:const\s+)?enum\s+[A-Z]'
    - '\bObject\.(?:values|keys|entries)\s*\(\s*[A-Z][\w$]*\s*\)'
    - '\bas\s+[A-Z][\w$]*(?:Enum|Type|Status|Role|Kind)\b'
sources:
  - https://www.typescriptlang.org/docs/handbook/enums.html#reverse-mappings
  - https://www.typescriptlang.org/docs/handbook/enums.html#const-enum-pitfalls
  - https://www.typescriptlang.org/tsconfig/#isolatedModules
---
- **Reverse mappings**: numeric enums also map values to names → `Object.values(Status)`/`Object.keys(Status)` return names and numbers, so option lists, validation sets and `includes` checks are wrong. Fix: string enums or `as const` objects.
- **Any number is assignable**: a `number` variable (parsed input, DB value) assigns to a numeric enum without error - only out-of-range literals are rejected → unvalidated values pass typed boundaries. Fix: validate membership.
- **`const enum` across files**: esbuild, SWC, Babel and Vite compile files alone and can't inline a `const enum` from another file or a `.d.ts` (no runtime object) → `undefined`/ReferenceError at runtime. Fix: regular enums or `as const`; `isolatedModules` catches it.
- **String enums at boundaries**: JSON, DB and query values are plain strings - `value as Role` skips checking membership, and renaming a member's value silently changes what is persisted. Fix: validate (`Object.values(Role).includes(v)`), keep stored values stable.
