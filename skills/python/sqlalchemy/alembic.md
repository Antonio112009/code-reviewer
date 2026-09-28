---
name: Alembic migrations
description: Alembic defects — autogenerate against incomplete metadata dropping tables, renames generated as drop+add, undetected server defaults and anonymous constraints, ORM models inside migrations, non-transactional PostgreSQL DDL, SQLite ALTER limits, empty downgrades and multiple heads.
priority: 66
tags: [CWE-665]
activation:
  files: ["**/alembic/versions/*.py", "**/migrations/versions/*.py", "**/{alembic,migrations}/env.py"]
  content:
    - '^[ \t]*from[ \t]+alembic[ \t]+import\b'
    - '\bop\.(?:drop_table|drop_column|add_column|alter_column|create_index|create_unique_constraint|execute|batch_alter_table)\('
    - '\b(?:target_metadata|compare_type|compare_server_default|naming_convention|autocommit_block|down_revision)\b'
  examples:
    - 'from alembic import op'
    - 'op.add_column("users", sa.Column("email", sa.String()))'
    - 'down_revision = "abc123"'
sources:
  - https://alembic.sqlalchemy.org/en/latest/autogenerate.html
  - https://alembic.sqlalchemy.org/en/latest/naming.html
  - https://alembic.sqlalchemy.org/en/latest/batch.html
  - https://alembic.sqlalchemy.org/en/latest/api/runtime.html#alembic.runtime.migration.MigrationContext.autocommit_block
---
- **Incomplete target_metadata**: models not imported in `env.py` are missing from `target_metadata`, so autogenerate emits `drop_table` for their tables. Review every generated `op.drop_*` before merging.
- **Renames as drop + add**: autogenerate cannot detect table or column renames; the generated `drop_column`/`add_column` pair loses the data. Fix: hand-edit to `alter_column(new_column_name=...)` / `rename_table`.
- **Blind spots**: server-default changes are ignored unless `compare_server_default=True`; unnamed constraints cannot be dropped or altered reliably; non-native `Enum` changes and CHECK constraints are missed by default. Fix: `MetaData(naming_convention=...)`, explicit ops.
- **ORM models in migrations**: importing application models (or `Session` queries on them) in a revision breaks when the models later change. Fix: `sa.table()`/`sa.column()` snapshots and `op.execute()`.
- **Non-transactional PostgreSQL DDL**: `postgresql_concurrently=True` indexes fail inside the migration transaction, and a value added by `ALTER TYPE ... ADD VALUE` cannot be used before commit; `autocommit_block()` commits everything before it. Fix: a separate revision per such step.
- **SQLite ALTER limits**: most column changes on SQLite need `op.batch_alter_table()` (table copy); plain `alter_column` fails.
- **Empty or lossy downgrade**: `def downgrade(): pass`, or drops without restoring data, make rollbacks silently incomplete.
- **Multiple heads**: parallel branches each adding a revision with the same `down_revision` break `alembic upgrade head`. Fix: `alembic merge` in the change that introduces the second head.
