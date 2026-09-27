---
name: EF Core migrations
description: Migration defects — renames scaffolded as drop+add, narrowing or NOT NULL changes without backfill, Migrate() at application startup, EF 9 pending-model-change and explicit-transaction exceptions, EnsureCreated mixed with migrations and rewriting applied migrations.
priority: 68
tags: [CWE-1068]
activation:
  files: ["**/Migrations/*.cs"]
  content:
    - '\bmigrationBuilder\.\w+\(|\bMigrationBuilder\b'
    - '\.(?:Migrate|MigrateAsync|EnsureCreated|EnsureCreatedAsync|EnsureDeleted|EnsureDeletedAsync)\('
    - '\bHasData\(|\bPendingModelChangesWarning\b'
sources:
  - https://learn.microsoft.com/en-us/ef/core/managing-schemas/migrations/managing
  - https://learn.microsoft.com/en-us/ef/core/managing-schemas/migrations/applying
  - https://learn.microsoft.com/en-us/ef/core/what-is-new/ef-core-9.0/breaking-changes
---
- **Rename = drop + add**: renaming a property or entity scaffolds `DropColumn` + `AddColumn` (or drop/create table) → all existing values lost on apply. Fix: edit to `RenameColumn`/`RenameTable`; read every generated migration and its data-loss warnings.
- **Unsafe alters**: `AlterColumn` narrowing length/precision, or making a column non-nullable without a default/backfill → truncation errors or failed deploys on existing rows. Fix: add nullable → backfill via `migrationBuilder.Sql` → alter.
- **Migrate at startup**: `Database.Migrate()` in `Program` → before EF 9 replicas race (failures, corruption); the app needs DDL rights; a bad migration crash-loops every instance (EF 9+ adds a lock only). Fix: bundles or idempotent scripts in the pipeline.
- **EF 9 exceptions**: `Migrate()` throws on pending model changes (e.g. `HasData` with `DateTime.Now`/`Guid.NewGuid()` makes the model non-deterministic) and inside an explicit transaction. Fix: static seed values, no wrapping transaction.
- **EnsureCreated**: `EnsureCreated()` builds the schema without migration history → later `Migrate()` fails; `EnsureDeleted()` reachable outside tests drops databases. Fix: tests only.
- **Rewriting history**: editing or deleting migrations already applied elsewhere, or regenerating the model snapshot → environments diverge and future diffs are wrong. Fix: add a new migration instead.
- **Locking DDL**: large index/column changes run in the migration transaction (EF 9 applies all pending migrations in one) → long table locks and timeouts. Fix: `migrationBuilder.Sql(..., suppressTransaction: true)` with online/concurrent index builds.
