---
name: GORM chains, transactions, hooks and soft delete
description: Reused *gorm.DB chains accumulating conditions, db used inside Transaction, missing WithContext, auto-saved associations, writes bypassing hooks, soft-delete surprises and AutoMigrate in production.
priority: 64
tags: [CWE-362, CWE-915, CWE-212]
activation:
  content:
    - '\.(?:Transaction|Begin|Commit|Rollback|Session|WithContext|Unscoped|Omit|Association|AutoMigrate|UpdateColumns?)\('
    - '\bgorm\.(?:G|Session|DeletedAt)\b'
    - '\b(?:Before|After)(?:Save|Create|Update|Delete|Find)\('
    - '\b\w{1,30}\s*:?=\s*(?:db|tx|DB|r\.db|s\.db)\.(?:Where|Model|Table|Joins|Scopes)\('
  examples:
    - 'db.Transaction(func(tx *gorm.DB) error {'
    - 'DeletedAt gorm.DeletedAt `gorm:"index"`'
    - 'func (u *User) BeforeSave(tx *gorm.DB) error {'
    - 'q := db.Where("active = ?", true)'
sources:
  - https://gorm.io/docs/method_chaining.html
  - https://gorm.io/docs/transactions.html
  - https://gorm.io/docs/delete.html
  - https://gorm.io/docs/the_generics_way.html
---
- **Chain pollution**: reusing a `*gorm.DB` after chain methods (`q := db.Where(a); q.Where(b).Find(&x); q.Where(c).Find(&y)`) accumulates conditions → the second query is also filtered by `b`; shared chains race across goroutines. Fix: `Session(&gorm.Session{})`, fresh chains, or `gorm.G[T]` (v1.30+).
- **Transactions**: inside `db.Transaction(func(tx *gorm.DB) error {…})`, calls on `db` or repositories run outside it; returning nil after a failed step commits partial work; manual `Begin` without Rollback on early returns holds locks. Fix: use `tx` everywhere and return errors.
- **Context**: queries without `WithContext(ctx)` ignore request cancellation and deadlines. Fix: `db.WithContext(ctx)` per request.
- **Auto-saved associations**: `Create`/`Save` upsert non-zero associations and run their hooks → request-decoded `Roles`, `Org` or `Owner` structs create or modify related rows. Fix: `Omit(clause.Associations)` or DTOs.
- **Hooks bypassed**: `UpdateColumn(s)`, `Exec`/`Raw` and map updates via `Table()` skip hooks and `UpdatedAt` → password hashing or auditing in `BeforeSave` is skipped.
- **Soft delete**: models with `gorm.DeletedAt` are only flagged on `Delete`; unique indexes still see deleted rows (re-create fails), raw SQL and hand-written joins return them; hard deletes need `Unscoped()`.
- **AutoMigrate in production**: runs DDL at every start from each replica (concurrent ALTERs, table locks) and never drops or renames columns → drift. Fix: versioned migrations.
