---
name: Migrations
description: Django migration defects — real model imports in RunPython, irreversible operations, schema plus data changes in one PostgreSQL migration, concurrent index atomicity, rolling-deploy ordering, one-off defaults on unique fields and models changed without a migration.
priority: 66
tags: [CWE-665]
activation:
  files: ["**/migrations/*.py", "**/models.py", "**/models/*.py"]
  content:
    - '\b(?:RunPython|RunSQL|SeparateDatabaseAndState|AddIndexConcurrently|RemoveIndexConcurrently|AddField|RemoveField|RenameField|RenameModel|AlterField)\b'
    - '\bmigrations\.Migration\b'
sources:
  - https://docs.djangoproject.com/en/stable/ref/migration-operations/
  - https://docs.djangoproject.com/en/stable/topics/migrations/
  - https://docs.djangoproject.com/en/stable/howto/writing-migrations/
  - https://docs.djangoproject.com/en/stable/ref/contrib/postgres/operations/
---
- **Real models in RunPython**: `from app.models import X` inside a migration uses today's schema and custom methods → breaks when replayed on fresh databases. Fix: `apps.get_model("app", "X")`; historical models have no custom `save()` or methods.
- **Irreversible operations**: `RunPython` without `reverse_code` (or `RunPython.noop`) and `RunSQL` without `reverse_sql` block rollbacks.
- **Schema and data in one migration (PostgreSQL)**: `RunPython` next to `AddField`/`AlterField` can fail with "pending trigger events". Fix: separate migrations.
- **Concurrent index atomicity**: `AddIndexConcurrently`/`RemoveIndexConcurrently` need `atomic = False` on the `Migration` class, else they fail inside the transaction.
- **Rolling-deploy ordering**: `RemoveField`, `RenameField` or `RenameModel` in the same release that stops using it → still-running old code hits missing columns. Fix: two phases, `SeparateDatabaseAndState`.
- **One-off defaults**: `AddField(..., default=uuid.uuid4, unique=True)` on a populated table computes the default once for all rows → unique violation. Fix: nullable field, backfill with `RunPython`, then make it unique.
- **Model change without migration**: fields or `Meta` constraints edited in `models.py` with no new migration file in the change → "column does not exist" at runtime.
- **Unbatched data migrations**: `.all()` loops with per-row `save()` over large tables hold one long transaction. Fix: `.iterator()`, batched `update()`, `atomic = False` with explicit batches.
