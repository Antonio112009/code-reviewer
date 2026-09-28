---
name: Diesel queries
description: Diesel query pitfalls — update/delete without a filter, positional Queryable mapping, raw sql_query/dsl::sql injection, oversized batch inserts, unbounded loads and MySQL unsigned decoding before 2.3.13.
priority: 64
tags: [CWE-89, CWE-704, CWE-400]
activation:
  content:
    - '\b(?:diesel::)?(?:update|delete)\(\s*\w+(?:::table)?\s*\)'
    - '\bsql_query\(|\bdsl::sql\b|\bsql::<'
    - '\bQueryable\b|\bas_select\(\)|\bSelectable\b'
    - '\binsert_into\(|\.values\(\s*&'
    - '\.load(?:::<[^>\n]{0,60}>)?\(|\.get_results?\('
  examples:
    - 'diesel::update(users::table).set(active.eq(false)).execute(conn)?;'
    - 'let rows = sql_query("SELECT * FROM users WHERE id = $1").bind::<Integer, _>(id).load(conn)?;'
    - '#[derive(Queryable, Selectable)]'
    - 'diesel::insert_into(users::table).values(&new_user).execute(conn)?;'
sources:
  - https://docs.rs/diesel/latest/diesel/deserialize/trait.Queryable.html
  - https://docs.rs/diesel/latest/diesel/fn.sql_query.html
  - https://github.com/diesel-rs/diesel/blob/main/CHANGELOG.md
---
- **Update/delete without a filter**: `diesel::update(users::table).set(..)` or `delete(posts::table)` touch every row; easy when the filter is built conditionally and ends up empty. Fix: `update(users.find(id))` or `.filter(..)`; check affected-row counts.
- **`Queryable` is positional**: struct field order must match the selected columns; with compatible types, swapped fields load silently into the wrong fields. Fix: `#[derive(Selectable)]`, `.select(T::as_select())`, `#[diesel(check_for_backend(..))]`.
- **Raw SQL**: `sql_query(format!(..))` or `dsl::sql::<T>(&format!(..))` with input → injection. Fix: `.bind::<SqlType, _>(value)` or the query builder.
- **Large batches**: `insert_into(t).values(&rows)` with thousands of rows exceeds bind-parameter limits (PostgreSQL 65,535) at runtime. Fix: chunk rows.
- **Unbounded loads**: `.load::<T>(conn)` on user-driven queries without `limit`/pagination → memory blowups.
- **MySQL unsigned (<2.3.13)**: `UNSIGNED` columns read into signed types reinterpreted bits (40000 read as -25536); 2.3.13 decodes by the server-reported signedness. Fix: `Unsigned<..>` types, upgrade.
