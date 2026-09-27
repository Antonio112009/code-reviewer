---
name: $wpdb queries
description: $wpdb traps — interpolated queries without prepare(), quoted or numbered placeholders, LIKE without esc_like, identifiers (%i since 6.2), hand-built IN lists, unchecked false results and hard-coded wp_ table prefixes.
priority: 74
tags: [CWE-89, CWE-252]
activation:
  content:
    - '\$wpdb->(?:query|get_results|get_var|get_row|get_col|prepare|insert|update|delete|replace|esc_like)\s*\('
    - '\besc_sql\s*\(|[''"`]wp_\w+[''"`]'
sources:
  - https://developer.wordpress.org/reference/classes/wpdb/prepare/
  - https://developer.wordpress.org/reference/classes/wpdb/
  - https://developer.wordpress.org/reference/classes/wpdb/esc_like/
---
- **No prepare()**: `$wpdb->get_results("… WHERE ID = $id")` or `query()` with interpolated values → SQL injection. Fix: `$wpdb->prepare()` with a placeholder for every value.
- **Placeholder quoting**: write `%s` unquoted (prepare adds quotes); numbered or formatted placeholders such as `%1$s` or `%5s` are not quoted → injection when code assumes they are.
- **LIKE**: `%` and `_` in user input act as wildcards and a literal `%` in the query must be `%%` → pass the whole pattern as an argument: `'%' . $wpdb->esc_like($term) . '%'`.
- **Identifiers**: table or column names from input cannot be quoted by `%s`; `esc_sql()` adds no quotes → use `%i` (WordPress 6.2+) or an allowlist.
- **IN lists**: `implode(',', $ids)` inside the SQL injects. Fix: one placeholder per element (`implode(',', array_fill(0, count($ids), '%d'))`) passed to `prepare()`.
- **Errors and prefixes**: `query()` returns `false` on error and `0` for no rows → check `=== false` and `$wpdb->last_error`; hard-coded `wp_` table names break custom prefixes and multisite. Fix: `$wpdb->prefix`, `$wpdb->posts`.
