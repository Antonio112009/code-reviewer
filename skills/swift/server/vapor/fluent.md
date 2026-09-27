---
name: Fluent ORM
description: Fluent (Vapor 4) data-access bugs — reading relations that were never loaded, N+1 queries, bulk updates and deletes without filters, queries escaping their transaction, raw SQL interpolation and editing migrations that already ran.
tags: [CWE-89, CWE-400]
activation:
  content:
    - '\.query\(on:|\.with\(\\\.\$|\$\w+\.(?:get|load|query)\(on:|@(?:Parent|OptionalParent|Children|Siblings)\b'
    - '\.transaction\s*\{|\.(?:delete|update|save|create)\(on:|\.set\(\\\.\$|\bAsyncMigration\b|\bautoMigrate\('
    - '\bSQLDatabase\b|\.raw\("|\\\((?:raw|unsafeRaw):'
sources:
  - https://docs.vapor.codes/fluent/relations/
  - https://docs.vapor.codes/fluent/transaction/
  - https://github.com/vapor/fluent-kit/blob/main/Sources/FluentKit/Properties/Children.swift
  - https://github.com/vapor/sql-kit/blob/main/Sources/SQLKit/Expressions/Basics/SQLQueryString.swift
---
- **Unloaded relations crash**: reading `post.author` or `user.posts` without eager loading (`.with(\.$author)`) or `$author.get(on:)` hits `fatalError("… not eager loaded, use $ prefix to access")`.
- **N+1 queries**: loading a relation per row in a loop (`try await p.$author.get(on: db)` for each post) → one query per row. Fix: `.with(\.$author)`, one extra query per relation.
- **Unfiltered bulk operations**: `Model.query(on: db).delete()` or `.set(...).update()` without `.filter` → every row is changed; a lost filter in a refactor wipes the table.
- **Escaping the transaction**: multi-step writes without `db.transaction`, or using `req.db` inside `transaction { db in … }` instead of the closure's `db` → those statements run outside the transaction and aren't rolled back.
- **Raw SQL interpolation**: in `sql.raw("…")`, plain `\(string)`, `\(raw:)` and `\(unsafeRaw:)` insert text verbatim → SQL injection. Fix: `\(bind: value)` and `\(ident:)` for identifiers.
- **Edited migrations**: changing a migration that already ran instead of adding a new one → schemas diverge between environments; `autoMigrate()` at startup of several instances races.
