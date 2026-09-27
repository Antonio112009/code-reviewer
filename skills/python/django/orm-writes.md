---
name: ORM write semantics
description: Django save/update/bulk/delete behaviour that silently skips code or overwrites data — full-row save(), update() and bulk_* bypassing save() and signals, QuerySet.delete() skipping Model.delete(), and F()/GeneratedField values left stale before 6.0.
priority: 62
tags: [CWE-362]
activation:
  content:
    - '\.(?:save|asave)\('
    - '\.(?:update|aupdate|bulk_create|abulk_create|bulk_update|abulk_update|delete|adelete)\('
    - '=\s*F\('
    - '\bGeneratedField\('
    - '\b(?:DB_CASCADE|DB_SET_NULL|DB_SET_DEFAULT)\b'
sources:
  - https://docs.djangoproject.com/en/stable/ref/models/querysets/#bulk-create
  - https://docs.djangoproject.com/en/stable/ref/models/instances/#specifying-which-fields-to-save
  - https://docs.djangoproject.com/en/stable/ref/models/expressions/
  - https://docs.djangoproject.com/en/dev/releases/6.0/
---
- **Full-row save()**: `obj.save()` writes every column, overwriting a concurrent change to another field with the stale value. Fix: `save(update_fields=[...])`, listing `auto_now` fields too (skipped otherwise).
- **update() bypasses the model**: `QuerySet.update()` runs no `save()`, sends no `pre_save`/`post_save`, leaves `auto_now` untouched → stale `updated_at`, skipped audit or denormalised data.
- **bulk_create**: no `save()`/signals/M2M; PKs come back only on PostgreSQL, MariaDB and SQLite, never with `ignore_conflicts=True`, which on MySQL/MariaDB also turns invalid or NULL values into warnings.
- **bulk_update**: no `save()`/signals, cannot change the PK, duplicates in the list give undefined results. Fix: dedupe, `batch_size`.
- **QuerySet.delete()**: never calls an overridden `Model.delete()` (file/cache cleanup skipped); per-object signals fire, except for rows removed by 6.1 `DB_CASCADE`/`DB_SET_NULL`.
- **F() stays on the instance (<6.0)**: after `obj.n = F("n") + 1; obj.save()`, a later `save()` re-applies the increment. Fix: `refresh_from_db()`; 6.0+ refreshes automatically.
- **GeneratedField stale (<6.0)**: `save()` does not read the computed value back. Fix: `refresh_from_db()`.
- **save() in loops**: one UPDATE per row for set-based changes. Fix: `update()` with `F()`, or `bulk_update`.
