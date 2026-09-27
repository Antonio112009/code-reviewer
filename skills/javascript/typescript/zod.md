---
name: zod schemas (v3 and v4)
description: zod validation traps - Boolean coercion of 'false', parse vs safeParse handling, unknown keys stripped or passed through, and Zod 4 changes to defaults, formats, records and the error API.
priority: 60
activation:
  content:
    - '\bfrom\s+[''"]zod(?:/v4|/v3|/mini)?[''"]'
    - '\bz\.(?:object|string|number|boolean|coerce|enum|record|array|union|infer|strictObject|looseObject|stringbool|uuid|email)\b'
    - '\.(?:safeParse|parseAsync|safeParseAsync|passthrough|prefault)\s*\('
sources:
  - https://zod.dev/v4/changelog
  - https://zod.dev/api#coercion
  - https://zod.dev/api#stringbools
---
- **`z.coerce.boolean()` is `Boolean(x)`**: `'false'` and `'0'` become `true` → env flags and query toggles switch on; `z.coerce.number()` turns `''` into `0`. Fix: `z.stringbool()` (Zod 4) or enum + transform.
- **`parse` vs `safeParse`**: `parse` throws `ZodError` (uncaught in a route → 500, not 400); `safeParse(…).data` read without checking `success` is `undefined`; async refinements need `parseAsync`. Fix: branch on `success`.
- **Unknown keys**: `z.object` silently strips unknown keys, while `.passthrough()`/`z.looseObject` let arbitrary keys reach `save()`/`update()` → mass assignment. Fix: `z.strictObject` at trust boundaries, explicit mapping.
- **Zod 4 `.default()`**: returns the default for `undefined` without parsing/transforming it (v3 parsed it), and defaults inside `.optional()` fields now apply → keys appear where code expected absence. Fix: `.prefault()` for v3 behaviour.
- **Zod 4 stricter checks**: `z.uuid()` enforces RFC 9562 variant bits (`z.guid()` is lax), `z.number()` rejects `Infinity`, `.int()` only safe integers, `z.record(z.enum(…))` requires every key → previously valid input is rejected.
- **Zod 4 error API**: `err.errors` is gone (use `err.issues`); `.format()`/`.flatten()` are deprecated for `z.treeifyError()` → error-mapping code throws inside catch blocks. Fix: migrate it with the upgrade.
