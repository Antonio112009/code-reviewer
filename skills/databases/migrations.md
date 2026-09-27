---
name: Database migrations
description: Migration defects that break rolling deploys or lose data, such as contract-before-expand, renames generated as drop+add, NOT NULL without database defaults, big-bang backfills, locking DDL, constraints on dirty data, destructive or irreversible changes, 32-bit keys and edited history.
category: database
priority: 64
tier: essential
tags:
  - CWE-190
  - CWE-197
  - CWE-221
activation:
  stack:
    - db.postgresql
    - db.mysql
    - db.sqlite
    - db.sqlserver
    - db.oracle
    - db.mongodb
    - db.redis
    - db.elasticsearch
    - db.clickhouse
    - db.cassandra
    - db.dynamodb
    - db.neo4j
    - db.cockroachdb
    - orm.prisma
    - orm.typeorm
    - orm.sequelize
    - orm.drizzle
    - orm.knex
    - orm.mongoose
    - orm.sqlalchemy
    - orm.django
    - orm.hibernate
    - orm.eloquent
    - orm.doctrine
    - orm.activerecord
    - orm.efcore
    - orm.gorm
    - orm.sqlx
    - orm.diesel
  languages:
    - sql
    - python
    - ruby
    - php
    - typescript
    - javascript
    - java
    - kotlin
    - scala
    - csharp
    - go
    - rust
    - elixir
    - shell
    - yaml
    - json
    - text
  files:
    - "**/migrations/**"
    - "**/migration/**"
    - "**/Migrations/**"
    - "**/db/migrate/**"
    - "**/alembic/versions/**"
    - "**/db/changelog/**"
    - "**/*.{up,down}.sql"
    - "**/V[0-9]*__*.sql"
    - "**/schema.sql"
    - "**/structure.sql"
    - "**/schema.prisma"
    - "**/prisma/schema/*.prisma"
    - "**/drizzle/*.sql"
  content:
    - \b(?:ALTER\s+TABLE|ALTER\s+COLUMN|DROP\s+(?:TABLE|COLUMN|INDEX|CONSTRAINT)|RENAME\s+(?:COLUMN|TO)|CREATE\s+(?:UNIQUE\s+)?INDEX|ADD\s+(?:COLUMN|CONSTRAINT))\b
    - "['\"`]\\s*(?:alter\\s+table|drop\\s+(?:table|column|index)|create\\s+(?:unique\\s+)?index|create\\s+table)\\b"
    - \bmigrations\.(?:AddField|RemoveField|AlterField|RenameField|RenameModel|DeleteModel|AddIndex|AddConstraint|RunPython|RunSQL)\b|\bop\.(?:add_column|drop_column|alter_column|create_index|drop_index|create_unique_constraint|create_foreign_key|execute|batch_alter_table)\(|\b(?:add_column|remove_column|rename_column|change_column|change_column_null|add_index|add_reference|add_foreign_key|rename_table)\b
    - \bSchema::(?:table|create|drop\w*|rename)\(|\bmigrationBuilder\.\w+[(<]|\bqueryRunner\.\w+\(|\bqueryInterface\.\w+\(|\bknex\.schema\.|\.AutoMigrate\(|<(?:addColumn|dropColumn|renameColumn|modifyDataType|addNotNullConstraint|createIndex|addUniqueConstraint)\b|\b(?:alter|create)\s+table\(:|\b(?:create|drop)\s+(?:unique_)?index\(:|^[ \t]*model[ \t]+\w+[ \t]*\{
---
- **Contract before expand**: dropping or renaming a column/table in the release whose code stops using it → still-running old instances and workers fail on it. Fix: expand, migrate reads, contract later (`ignored_columns`).
- **Rename as drop+add**: generated migrations (Prisma, Drizzle, TypeORM, EF Core, Django) may render a renamed field as `DROP COLUMN` plus `ADD COLUMN` → data loss. Fix: read the generated SQL; use an explicit rename.
- **NOT NULL rollout**: new NOT NULL columns without a database default (ORM `default=` isn't one) → failed migrations on existing rows, old code's inserts rejected. Fix: nullable, backfill, constrain; `db_default`.
- **Data migrations**: one `UPDATE` over a whole table inside the migration transaction → long locks, replica lag, deploy timeouts; importing live model classes breaks when models change. Fix: batched resumable jobs; `apps.get_model` or plain SQL.
- **Locking DDL**: index builds, constraint validation or type rewrites on large tables → blocked writes; DDL without `lock_timeout` queues behind long transactions, stalling all traffic. Fix: PG `CONCURRENTLY`, `NOT VALID`; MySQL `LOCK=NONE`; SQL Server `ONLINE=ON`.
- **Constraints on dirty data**: adding unique, foreign-key or check constraints while violating rows (duplicates, case variants, orphans) exist → the migration fails mid-deploy. Fix: clean and verify data first.
- **Destructive changes**: shorter `VARCHAR`, lower precision, casts or removed enum values → truncated or rejected data; drops and rewrites without a working `down` or backup → no rollback. Fix: check data, back up, mark irreversible.
- **32-bit keys**: new `serial`/`INT` primary keys, or `int` foreign keys referencing `bigint` ids, on growing tables → inserts fail at 2,147,483,647. Fix: `bigint` identity keys from the start.
- **Edited history**: editing an applied migration (Flyway/Liquibase checksum errors; Rails, Django, Prisma never rerun it), parallel branch heads, or model/schema edits without a migration → environments diverge. Fix: add a new migration.
