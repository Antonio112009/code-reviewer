---
name: sqlx macros, types and migrations
description: Compile-time checked macros with wrong nullability or stale offline data, editing applied migrations, timestamp/unsigned/money type mappings and unchecked query_as functions.
priority: 62
tags: [CWE-704, CWE-20]
activation:
  content:
    - '\bquery(?:_as|_scalar|_file(?:_as)?)?!\s*\('
    - '\bmigrate!\s*\(|\bMigrator\b'
    - '\bSQLX_OFFLINE\b'
    - '\b(?:NaiveDateTime|PrimitiveDateTime|OffsetDateTime)\b|\bDateTime<Utc>'
    - '\bquery_as::<|#\[sqlx\('
  examples:
    - 'let user = query_as!(User, "SELECT * FROM users WHERE id = $1", id).fetch_one(&pool).await?;'
    - 'sqlx::migrate!("./migrations").run(&pool).await?;'
    - 'if env::var("SQLX_OFFLINE").is_ok() { }'
    - 'let created_at: DateTime<Utc> = row.created_at;'
    - '#[sqlx(rename = "user_id")]'
sources:
  - https://docs.rs/sqlx/latest/sqlx/macro.query.html
  - https://docs.rs/sqlx/latest/sqlx/migrate/enum.MigrateError.html
  - https://docs.rs/sqlx/latest/sqlx/postgres/types/index.html
---
- **Nullability inference**: macros infer nullability from the database; columns from `LEFT JOIN`s, views and expressions can be inferred wrong → runtime "unexpected null" decode errors or needless `Option`s. Fix: `AS "col?"` (nullable) or `AS "col!"` (non-null) overrides.
- **Stale offline data**: builds with `SQLX_OFFLINE=true` use the committed `.sqlx/` metadata; schema changes without `cargo sqlx prepare` compile against old types and fail at runtime. Fix: `cargo sqlx prepare --check` in CI.
- **Editing applied migrations**: changing a migration file that already ran makes `migrate!().run()` fail with `VersionMismatch` at startup → crash-looping deploys. Fix: add a new migration instead.
- **Type mappings**: `TIMESTAMP` ↔ `NaiveDateTime`/`PrimitiveDateTime` drops the offset (use `TIMESTAMPTZ` ↔ `DateTime<Utc>`/`OffsetDateTime`); Postgres has no unsigned integers; `f64` for money rounds (use `NUMERIC` ↔ `rust_decimal`/`BigDecimal`).
- [full] **Unchecked function forms**: `query_as::<_, T>(sql)` is checked only at runtime → column/field mismatches appear in production. Fix: `query_as!` for static SQL, tests for dynamic SQL.
