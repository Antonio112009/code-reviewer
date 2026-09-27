---
name: Saving entities and transactions
description: TypeORM write-path defects — repositories used outside the transaction's manager, unreleased QueryRunners, save() upserting client-supplied ids and cascaded relations, listeners skipped by update/insert/upsert, and synchronize enabled in production.
priority: 68
tags: [CWE-915, CWE-362, CWE-400]
activation:
  content:
    - "\\.transaction\\s*\\(|\\bcreateQueryRunner\\s*\\(|\\bqueryRunner\\.\\w+\\s*\\(|\\bstartTransaction\\s*\\("
    - "\\.(?:save|insert|update|upsert|remove|softRemove|preload|merge)\\s*\\("
    - "\\bcascade\\s*:|\\bsynchronize\\s*:|\\bmigrationsRun\\b|@(?:BeforeInsert|BeforeUpdate|AfterLoad|AfterInsert)\\s*\\(|\\bEntitySubscriberInterface\\b"
sources:
  - https://typeorm.io/docs/listeners-and-subscribers/
  - https://typeorm.io/docs/transactions/
  - https://typeorm.io/docs/data-source/data-source-options/
---
- **Outside the manager**: inside `dataSource.transaction(async (manager) => …)`, calls on injected repositories (`@InjectRepository`) or `dataSource.getRepository()` run on other connections and are not rolled back. Fix: `manager.getRepository(Entity)`/`manager.save` throughout.
- **QueryRunner leaks**: `createQueryRunner()` without `release()` in `finally` (and `rollbackTransaction()` on error) leaks pooled connections until the app stalls.
- **save() is an upsert**: `repo.save(req.body)` or `save({ ...dto, id })` updates whichever row the client-supplied `id` names (or inserts), and `cascade: true` creates or updates nested relations from the payload. Fix: load with ownership check, `create()` from allowed fields.
- **Listeners skipped**: `@BeforeInsert`/`@BeforeUpdate` (password hashing, slugs, audit fields) run only for `save()`/`remove()` — and `@BeforeUpdate` only when something changed; `update()`, `insert()`, `upsert()` and QueryBuilder writes skip them. Fix: do it in the service.
- **synchronize in production**: `synchronize: true` (often inherited from a shared config) alters the schema on boot — renamed or removed columns are dropped with their data. Fix: `false` outside local dev; reviewed migrations.
