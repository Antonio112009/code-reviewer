---
name: SeaORM ActiveModels and queries
description: SeaORM pitfalls — save() choosing insert vs update from the primary key, Unchanged fields not persisted, update_many/delete_many without filters, raw Statement injection, queries escaping transactions and N+1 relation loading.
priority: 63
tags: [CWE-89, CWE-362]
activation:
  content:
    - '\.(?:save|insert|update|delete)\(\s*&?(?:db|txn|conn|tx)\b'
    - '\b(?:update|delete)_many\(\)'
    - '\bStatement::from_(?:string|sql_and_values)\b|\braw_sql!|\bfind_by_statement\b|_raw\('
    - '\.begin\(\)|\.transaction\b'
    - '\.find_related\(|\.load_(?:one|many)\(|\binto_active_model\(\)'
sources:
  - https://www.sea-ql.org/SeaORM/docs/basic-crud/save/
  - https://www.sea-ql.org/SeaORM/docs/basic-crud/update/
  - https://www.sea-ql.org/SeaORM/docs/basic-crud/raw-sql/
  - https://www.sea-ql.org/SeaORM/docs/advanced-query/transaction/
---
- **`save()` picks insert or update**: primary key `NotSet` → INSERT, `Set`/`Unchanged` → UPDATE; new rows with client-generated keys (UUIDs) are updated instead of inserted and fail. Fix: call `insert()` explicitly.
- **Unchanged fields are not written**: `into_active_model()` marks every field `Unchanged` and `update()` writes only `Set` fields, so editing the `Model` before converting persists nothing. Fix: `Set(..)` on the ActiveModel, or `reset()`/`reset_all()`.
- **Bulk statements without a filter**: `Entity::update_many()`/`delete_many()` without `.filter(..)` affect every row. Fix: always filter; check `rows_affected`.
- **Raw SQL**: `Statement::from_string(backend, format!(..))` or `find_by_statement` with interpolated input → injection. Fix: `raw_sql!` (2.0) or `Statement::from_sql_and_values`.
- **Transactions**: queries issued on `db` instead of `&txn` after `db.begin()` run outside the transaction; a dropped `DatabaseTransaction` rolls back. Fix: pass `&txn` everywhere, or `db.transaction(|txn| ..)`.
- **N+1 relations**: `model.find_related(..).all(db)` in a loop issues one query per row. Fix: `find_with_related`, `load_many`/loader APIs.
