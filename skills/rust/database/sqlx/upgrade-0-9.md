---
name: sqlx 0.9 behaviour changes
description: Silent runtime changes when upgrading to sqlx 0.9 — sqlx.toml ignored without the sqlx-toml feature, PgConnectOptions::options now escaping, MySQL no longer forcing utf8_general_ci, mysql-rsa auth and .pgpass unescaping.
priority: 62
tags: [CWE-1357]
activation:
  content:
    - '\b(?:Pg|MySql)ConnectOptions\b'
    - '\.(?:options|charset|collation|set_names)\('
    - '\bmigrate!\s*\(|\bsqlx\.toml\b|\bsqlx-toml\b'
    - '\bAssertSqlSafe\b'
  examples:
    - 'let opts = PgConnectOptions::new().host("localhost");'
    - 'opts = opts.collation("utf8mb4_unicode_ci");'
    - 'sqlx::migrate!("./migrations").run(&pool).await?;'
    - 'let q = sqlx::query(AssertSqlSafe(sql));'
  versions: { orm.sqlx: '>=0.9' }
sources:
  - https://github.com/launchbadge/sqlx/blob/main/CHANGELOG.md
---
- **`sqlx.toml` ignored at runtime**: sqlx-cli reads `sqlx.toml`, but the `sqlx` library only with the `sqlx-toml` feature → the app uses a different `DATABASE_URL` variable, migrations table or type overrides than the CLI. Fix: enable `sqlx-toml` on `sqlx`.
- **`PgConnectOptions::options()` escapes now**: values pre-escaped for the old behaviour (backslashes, spaces in `search_path` or settings) are double-escaped. Fix: pass raw values.
- **MySQL collation**: 0.9 sends `SET NAMES utf8mb4` without forcing `utf8_general_ci`, so the server default collation applies → comparisons, uniqueness and ordering can change; text columns once inferred as `Vec<u8>` become `String`. Fix: set `collation(..)` explicitly.
- **Runtime auth failures**: non-TLS MySQL logins needing RSA key exchange fail unless the `mysql-rsa` feature is enabled; `.pgpass` passwords are now backslash-unescaped. Fix: test connections after upgrading.
