---
name: Laravel migrations
description: Laravel schema-migration traps — ->change() dropping unlisted modifiers (11+), float/double argument changes (11+), non-transactional MySQL migrations, NOT NULL columns without defaults, cascading foreign keys and Eloquent models inside migrations.
priority: 66
tags: [CWE-1066, CWE-404]
activation:
  files: ["**/database/migrations/**/*.php"]
  content:
    - '\bSchema::(?:create|table|drop\w*|rename)\s*\('
    - '->(?:change|dropColumn|renameColumn|float|double|decimal|foreignId|constrained|cascadeOnDelete)\s*\('
sources:
  - https://laravel.com/docs/11.x/upgrade#modifying-columns
  - https://laravel.com/docs/13.x/migrations
  - https://dev.mysql.com/doc/refman/8.4/en/implicit-commit.html
---
- **->change() (11+)**: modifying a column keeps only the modifiers listed in that migration → `->nullable()->change()` silently drops an existing `default`, `unsigned` or `comment`. Fix: repeat every modifier to keep.
- **Float arguments (11+)**: `float('price', 8, 2)` now means `float($column, $precision)` → single-precision FLOAT and rounded amounts; `double()` ignores total/places. Fix: `decimal()` for money.
- **Non-transactional MySQL**: DDL commits implicitly, so a migration failing halfway leaves tables changed but the migration unrecorded → re-runs fail. Keep one risky change per migration; PostgreSQL/SQLite run them in transactions.
- **NOT NULL without default**: adding a required column to a populated table fails on PostgreSQL/SQLite and backfills `''`/0 on non-strict MySQL. Fix: nullable → backfill → constrain.
- **Cascades**: `cascadeOnDelete()`/`onDelete('cascade')` on keys to users, orders or invoices → one delete erases history in the database, bypassing model events and soft deletes. Fix: `restrictOnDelete()`, soft deletes.
- **Models in migrations**: data fixes using Eloquent models run today's scopes, casts, fillable rules and observers → later model changes break old migrations or fire events. Fix: `DB::table()` inside migrations.
