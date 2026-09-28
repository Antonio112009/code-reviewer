---
name: sqlx queries and query building
description: SQL built with format!/AssertSqlSafe, raw QueryBuilder::push, bind-parameter limits in bulk inserts, fetch_one vs fetch_optional/fetch_all, and the ≤0.8.0 protocol-smuggling advisory.
priority: 64
tags: [CWE-89, CWE-400]
activation:
  content:
    - '\bsqlx::query(?:_as|_scalar|_with)?\b'
    - '\bquery(?:_as|_scalar)?(?:::<[^>\n]{0,80}>)?\(\s*&?(?:format!|AssertSqlSafe)'
    - '\bQueryBuilder\b|\.push(?:_bind|_values|_tuples)\(|\.push\(\s*&?format!'
    - '\bAssertSqlSafe\b'
    - '\.fetch_(?:one|optional|all)\('
  examples:
    - 'let row = sqlx::query("SELECT 1").fetch_one(&pool).await?;'
    - 'let rows = query(&format!("SELECT * FROM {table}")).fetch_all(&pool).await?;'
    - 'let mut qb = QueryBuilder::new("INSERT INTO users (name) ");'
    - 'let row = query(AssertSqlSafe(sql)).fetch_optional(&pool).await?;'
sources:
  - https://docs.rs/sqlx/latest/sqlx/struct.QueryBuilder.html
  - https://github.com/launchbadge/sqlx/blob/main/CHANGELOG.md
  - https://rustsec.org/advisories/RUSTSEC-2024-0363.html
---
- **Dynamic SQL strings**: `query(&format!(..))` (≤0.8) or `query(AssertSqlSafe(format!(..)))` (0.9 requires the wrapper for non-`'static` SQL) with request values → SQL injection. Fix: placeholders with `.bind()` or `query!`; allow-list identifiers such as sort columns.
- **`QueryBuilder::push`**: appends raw SQL text; values must go through `push_bind`/`separated(..).push_bind` → otherwise injection.
- **Bind-parameter limits**: `push_values` bulk inserts beyond 65,535 parameters (PostgreSQL/MySQL; SQLite 32,766) fail at runtime once data grows. Fix: chunk rows by limit ÷ columns, or bind arrays with `UNNEST` on Postgres.
- **Row-count expectations**: `fetch_one` returns `RowNotFound` for zero rows (often surfacing as 500 instead of 404) — use `fetch_optional`; `fetch_all` buffers every row → `fetch` streams or `LIMIT`.
- **Protocol smuggling (≤0.8.0)**: RUSTSEC-2024-0363 — values over 4 GiB had truncated length prefixes, letting attackers inject protocol messages. Fix: upgrade to ≥0.8.1 and cap request sizes.
