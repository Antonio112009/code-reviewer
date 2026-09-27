---
name: Column types, defaults and drizzle-kit
description: Drizzle schema traps — numeric strings and bigint precision, timestamps without time zone, runtime-only $defaultFn/$onUpdate, JSON $type without validation, drizzle-kit push against production and the v1 changes to schema filters, casing and relational queries.
priority: 62
tags: [CWE-681, CWE-1284]
activation:
  content:
    - "\\b(?:numeric|decimal|bigint|bigserial|timestamp|json|jsonb)\\s*\\("
    - "\\.\\$(?:defaultFn|default|onUpdate|onUpdateFn|type)\\s*[(<]"
    - "\\bdefineConfig\\s*\\(|\\bschemaFilter\\b|\\btablesFilter\\b|\\bcasing\\s*:|\\bdefineRelations\\s*\\(|\\bdb\\._query\\b"
    - "\\bdrizzle-kit\\s+(?:push|migrate|generate)\\b"
sources:
  - https://orm.drizzle.team/docs/column-types/pg
  - https://orm.drizzle.team/docs/v0-v1-changes
  - https://orm.drizzle.team/docs/relations-v1-v2
---
- **Numbers**: `numeric`/`decimal` return strings by default (`a + b` concatenates), and `bigint({ mode: 'number' })` silently loses precision above 2^53. Fix: decimal libraries or explicit `mode`; `mode: 'bigint'` for ids and counters.
- **Timestamps**: `timestamp()` is `without time zone` unless `withTimezone: true` — Drizzle treats naive values as UTC while `defaultNow()`, raw SQL and other writers use the session time zone → shifted instants. Fix: `withTimezone: true`, UTC sessions.
- **Runtime-only defaults**: `$defaultFn`/`$onUpdate` run in the application, not the database — raw SQL, other services and bulk `sql` updates skip them (missing ids, stale `updatedAt`). Fix: database defaults or triggers for invariants.
- **$type is a cast**: `json().$type<Settings>()` and `text().$type<'a' | 'b'>()` only change TypeScript types — no validation on read or write. Fix: validate at the boundaries (zod, `drizzle-orm/zod` in v1).
- **push in production**: `drizzle-kit push` applies diffs directly (renames can become drop+add, `--force` skips data-loss prompts); v1 manages all database schemas by default — without `schemaFilter` it touches `auth`/`storage` or other apps' schemas.
- **v1 query API**: v1 removed relational queries v1 — `db.query` uses `defineRelations` object syntax (old calls moved to `db._query` during the beta) and `drizzle({ casing })` is gone in favour of per-table casing. Fix: follow the v1 migration before upgrading.
