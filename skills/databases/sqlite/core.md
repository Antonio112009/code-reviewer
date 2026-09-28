---
name: SQLite
description: SQLite (incl. libSQL/D1) defects from per-connection foreign keys, SQLITE_BUSY, shared-connection transactions, Python sqlite3 commits, cascading table rebuilds, REPLACE deletes, type affinity and offset-less UTC text.
category: database
priority: 58
tier: essential
tags:
  - CWE-362
  - CWE-681
  - CWE-704
activation:
  stack:
    - db.sqlite
  languages:
    - sql
    - typescript
    - javascript
    - python
    - go
    - java
    - kotlin
    - csharp
    - ruby
    - php
    - rust
    - elixir
    - swift
    - dart
    - objective-c
    - c
    - cpp
    - shell
  files:
    - "**/*.sql"
  content:
    - (?:from\s+|require\(\s*)['"](?:better-sqlite3|sqlite3?|node:sqlite|bun:sqlite|@libsql/client|expo-sqlite|@op-engineering/op-sqlite|sql\.js)['"]|drizzle-orm/(?:sqlite-core|better-sqlite3|libsql|bun-sqlite|expo-sqlite|op-sqlite|d1|durable-sqlite)|\b(?:D1Database|DatabaseSync)\b|\.prepare\([^()\n]{0,300}\)\s*\.bind\(
    - \b(?:import|from)\s+(?:sqlite3|aiosqlite|apsw|sqlite_utils)\b|github\.com/mattn/go-sqlite3|modernc\.org/sqlite|ncruces/go-sqlite3|\brusqlite\b|sqlx::sqlite|\bSqlitePool\b|\bMicrosoft\.Data\.Sqlite\b|\bSqliteConnection\b|\bUseSqlite\b|\bjdbc:sqlite:|\bSQLiteDatabase\b|androidx\.room|\bsqflite\b|\bGRDB\b|\bFMDatabase\w*|\bExqlite\b|\bSQLite3::Database\b|\bnew\s+SQLite3\b|\bPDO\(\s*['"]sqlite:|\bsqlite3_(?:open|prepare|exec|step|bind)\w*\(
    - \bPRAGMA\s+\w+|\bpragma\s+(?:foreign_keys|journal_mode|busy_timeout|synchronous|user_version|table_info)\b|\bsqlite_(?:master|schema|sequence)\b|\bWITHOUT\s+ROWID\b|\bAUTOINCREMENT\b|\b(?:INSERT|insert)\s+(?:OR|or)\s+(?:REPLACE|IGNORE|replace|ignore)\b|\bdatetime\(\s*'now'|\bwith(?:Exclusive)?TransactionAsync\b
    - \b(?:SELECT|UPDATE|DELETE)\b[\s\S]{0,200}?\b(?:FROM|SET|WHERE)\b|\bINSERT\s+INTO\b|\b(?:ALTER|CREATE)\s+(?:TABLE|(?:UNIQUE\s+)?INDEX)\b|['"`](?:BEGIN|COMMIT|ROLLBACK)\b
    - "['\"`]\\s*(?:select\\s+(?:\\*|distinct\\b|count\\(|[\\w.\"]+\\s*(?:,|\\bfrom\\b|\\bas\\b))|update\\s+[\\w.\"]+\\s+set\\b|delete\\s+from\\b|insert\\s+(?:or\\s+\\w+\\s+)?into\\b|replace\\s+into\\b)"
  examples:
    - 'import Database from "better-sqlite3";'
    - 'import sqlite3'
    - 'db.exec("PRAGMA foreign_keys = ON;");'
    - 'SELECT * FROM users WHERE id = ?;'
    - 'const row = db.prepare("select * from users where id = ?").get(id);'
---
- **Foreign keys off**: `PRAGMA foreign_keys` is per connection, off by default in Python `sqlite3`, Go drivers and node-sqlite3, and a no-op inside transactions → FKs and cascades silently unenforced. Fix: enable on every new connection.
- **SQLITE_BUSY**: deferred `BEGIN` transactions that read then write fail at once if another connection wrote meanwhile; `node:sqlite` defaults to no busy timeout → sporadic "database is locked". Fix: `BEGIN IMMEDIATE`, WAL, `busy_timeout`.
- **Shared-connection transactions**: `BEGIN`…`await`…`COMMIT` on one connection (better-sqlite3, expo `withTransactionAsync`) pulls concurrent requests' statements into the transaction → foreign writes committed or rolled back; D1 has no interactive transactions. Fix: sync transaction functions, D1 `batch()`.
- **Python `sqlite3`**: DML opens an implicit transaction, so writes without `commit()` vanish on close (`with conn:` commits but doesn't close); a `check_same_thread=False` connection shared across threads → interleaved transactions. Fix: explicit commits, per-thread connections.
- **Rebuild migrations**: table rebuilds (copy → `DROP TABLE` → rename) with FKs on make the drop cascade-delete child rows; `foreign_keys=OFF` or `defer_foreign_keys` inside the transaction doesn't help. Fix: disable FKs before `BEGIN`, then `foreign_key_check`.
- **REPLACE deletes**: `INSERT OR REPLACE`/`REPLACE INTO` deletes the conflicting row first → omitted columns reset to defaults, rowids change, and `ON DELETE CASCADE` wipes its children. Fix: `INSERT … ON CONFLICT(col) DO UPDATE`.
- **Type affinity**: non-`STRICT` tables accept any value in any column, and a column declared `STRING` gets NUMERIC affinity (`'007'` becomes 7) → corrupted codes, mismatched comparisons. Fix: `STRICT` tables, `TEXT` columns.
- **UTC text dates**: `CURRENT_TIMESTAMP`/`datetime('now')` give offset-less UTC text that JS `Date` parsing and naive Python read as local; mixed formats compare lexically → shifted, misfiltered times. Fix: parse as UTC, or store epoch integers.
