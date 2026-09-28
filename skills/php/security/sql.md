---
name: SQL injection with PDO and mysqli
description: PHP-specific SQL injection paths — interpolated queries, identifiers and LIMIT/ORDER BY that cannot be bound, SET NAMES instead of a DSN charset, stacked queries with emulated prepares, escaping without quotes, LIKE wildcards and IN lists.
priority: 80
tags: [CWE-89, OWASP-A05]
activation:
  content:
    - '->(?:query|exec|prepare)\s*\(\s*["''][^"''\n]{0,200}\$'
    - '\bmysqli_(?:query|real_escape_string|multi_query)\s*\(|->real_escape_string\s*\('
    - '\b(?:ORDER\s+BY|LIMIT|LIKE)\b[^;\n]{0,80}\$'
    - '\bSET\s+NAMES\b|\bPDO::ATTR_EMULATE_PREPARES\b|->quote\s*\('
  examples:
    - '$pdo->query("SELECT * FROM users WHERE id = $id");'
    - '$result = mysqli_query($conn, "SELECT * FROM t WHERE id=$id");'
    - '$sql = "SELECT * FROM users ORDER BY " . $column;'
    - '$pdo->setAttribute(PDO::ATTR_EMULATE_PREPARES, false);'
sources:
  - https://www.php.net/manual/en/pdo.prepared-statements.php
  - https://www.php.net/manual/en/ref.pdo-mysql.connection.php
  - https://www.php.net/manual/en/mysqli.real-escape-string.php
  - https://cheatsheetseries.owasp.org/cheatsheets/Query_Parameterization_Cheat_Sheet.html
---
- **Interpolated SQL**: variables inside `query()`, `exec()` or even the string passed to `prepare()` → injection; preparing does not help if the SQL text is built from input. Fix: placeholders for every value.
- **Identifiers and keywords**: table/column names, `ORDER BY` columns and `ASC`/`DESC` cannot be bound, so they get concatenated from input. Fix: map input to an allowlist of identifiers.
- **Charset**: `SET NAMES gbk` (or other multibyte charsets) instead of `charset=` in the DSN makes client-side escaping and emulated prepares mis-escape → injection. Fix: set the charset in the DSN or `mysqli_set_charset()`.
- **Stacked queries**: PDO MySQL emulates prepares by default and allows multiple statements, so one injection point runs `; DROP …`. Fix: `ATTR_EMULATE_PREPARES => false`, `MYSQL_ATTR_MULTI_STATEMENTS => false`.
- **Escaping without quotes**: `real_escape_string()`/`quote()` output placed in numeric context (`WHERE id = $escaped`) or unquoted → `1 OR 1=1` passes. Fix: bind, or cast to int.
- **LIKE and IN**: bound LIKE values still treat `%`/`_` as wildcards (full-table matches, slow scans); `IN ($ids)` built with `implode` injects. Fix: escape wildcards, generate one placeholder per element.
