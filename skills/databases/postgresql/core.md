---
name: PostgreSQL
description: PostgreSQL (and wire-compatible CockroachDB) defects in driver pooling and type mapping, aborted and unretried transactions, upserts, parameters, JSONB nulls, pooled session state, early unlocks and row-level security.
category: database
priority: 60
tier: essential
tags:
  - CWE-284
  - CWE-362
  - CWE-681
  - OWASP-A01
activation:
  stack:
    - db.postgresql
    - db.cockroachdb
  languages:
    - sql
    - typescript
    - javascript
    - python
    - go
    - java
    - kotlin
    - scala
    - csharp
    - ruby
    - php
    - rust
    - elixir
    - shell
  files:
    - "**/*.sql"
  content:
    - (?:from\s+|require\(\s*)['"](?:pg|pg-pool|pg-promise|postgres|slonik|@neondatabase/serverless|@vercel/postgres|@electric-sql/pglite)['"]|drizzle-orm/(?:pg-core|node-postgres|postgres-js|neon-http|neon-serverless|pglite)
    - \b(?:import|from)\s+(?:psycopg2?|psycopg_pool|asyncpg)\b|sqlalchemy\.dialects\.postgresql|\bdjango\.contrib\.postgres\b|github\.com/(?:jackc/pgx|lib/pq)|\bjdbc:postgresql:|\b(?:org|io\.r2dbc)\.postgresql\b|\bNpgsql\w*|\bPostgrex\b|\btokio_postgres\b|\bsqlx::postgres\b|\bPgPool(?:Options)?\b|\bPG(?:::Connection|\.connect)\b|\bpg_(?:query_params|query|prepare|execute|connect)\s*\(
    - \b(?:jsonb|JSONB|timestamptz|TIMESTAMPTZ)\b|\bjsonb_\w+\(|\$\d+::\w|::(?:jsonb|timestamptz|regclass|int[248]|float8)\b|\b(?:ON\s+CONFLICT|on\s+conflict)\b|\bon_conflict_do_\w+|\bSKIP\s+LOCKED\b|\bpg_(?:try_)?advisory_\w+|\b(?:INDEX|index)\s+(?:CONCURRENTLY|concurrently)\b|\bRETURNING\b|\b(?:ROW\s+LEVEL\s+SECURITY|SECURITY\s+DEFINER|CREATE\s+POLICY|SET\s+LOCAL)\b|\b(?:setval|set_config|pg_notify)\(|=\s*ANY\s*\(\s*\$\d
    - \b(?:SELECT|UPDATE|DELETE)\b[\s\S]{0,200}?\b(?:FROM|SET|WHERE)\b|\bINSERT\s+INTO\b|\b(?:ALTER|CREATE)\s+(?:TABLE|(?:UNIQUE\s+)?INDEX)\b|['"`](?:BEGIN|COMMIT|ROLLBACK)\b
    - "['\"`]\\s*(?:select\\s+(?:\\*|distinct\\b|count\\(|[\\w.\"]+\\s*(?:,|\\bfrom\\b|\\bas\\b))|update\\s+[\\w.\"]+\\s+set\\b|delete\\s+from\\b|insert\\s+into\\b|with\\s+\\w+\\s+as\\s*\\()"
---
- **Pool misuse**: `BEGIN`/`COMMIT` via `pool.query()` hit different connections → no atomicity; unreleased clients hang the pool; without `pool.on('error')` idle-client errors crash Node. Fix: one checked-out client per transaction, `release()` in `finally`.
- **Type mapping**: node-postgres returns `int8` (`COUNT(*)`) and `numeric` as strings (`+` concatenates) and `date` as local midnight → off-by-one days after `toISOString`. Fix: casts, `setTypeParser`.
- **Aborted transactions**: after a caught error later statements fail (`25P02`) until rollback; serialization failures and deadlocks (`40001`, `40P01`) abort everything → spurious errors. Fix: `SAVEPOINT` or `ON CONFLICT`; retry whole transactions.
- **Upserts**: `DO NOTHING … RETURNING` yields no row for existing keys; NULL key columns never conflict → duplicates (`NULLS NOT DISTINCT`, PG 15+); multi-row `DO UPDATE` repeating a key errors. Fix: re-select, dedupe rows.
- **Parameters**: `ORDER BY $1` orders by a constant; `col IN ($1)` given an array errors or matches nothing → unsorted pages, empty results. Fix: allowlisted columns, `= ANY($1)`.
- **JSONB nulls**: `jsonb_set` with a NULL value returns NULL, with a missing parent key does nothing; `NULL || jsonb` stays NULL → wiped columns, silently lost updates. Fix: `COALESCE`, `jsonb_set_lax`.
- **Session state**: plain `SET` (RLS tenant id), session advisory locks and `LISTEN` leak across pooled or PgBouncer-multiplexed connections → cross-tenant reads, stuck locks. Fix: `SET LOCAL`, `pg_advisory_xact_lock`.
- **Early unlock**: `FOR UPDATE SKIP LOCKED` claims in autocommit (or on another pooled client than the update) unlock at statement end → two workers take one job. Fix: a single `UPDATE … RETURNING` claim.
- **RLS gaps**: tables exposed to Supabase `anon`/`authenticated` roles without RLS enabled and policies → world-readable; views and `SECURITY DEFINER` functions bypass RLS; `user_metadata` in policies is user-editable. Fix: `security_invoker` views.
