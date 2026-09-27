---
name: Eloquent writes, races and transactions
description: Write-side bugs — mass update/delete skipping events and casts, insert/upsert semantics on MySQL, firstOrCreate races, lost read-modify-write updates, lockForUpdate outside transactions, DB::transaction retries and joined deletes ignoring LIMIT before Laravel 13.
priority: 68
tags: [CWE-362, CWE-367, CWE-841]
activation:
  content:
    - '->(?:update|delete|insert|insertOrIgnore|upsert|forceDelete)\s*\(|::(?:insert|upsert|destroy)\s*\('
    - '(?:->|::)(?:firstOrCreate|updateOrCreate|firstOrNew|createOrFirst|increment|decrement|lockForUpdate|sharedLock)\s*\('
    - '\bDB::(?:transaction|beginTransaction)\s*\('
sources:
  - https://laravel.com/docs/13.x/eloquent#mass-updates
  - https://laravel.com/docs/13.x/eloquent#upserts
  - https://laravel.com/docs/13.x/queries#pessimistic-locking
  - https://laravel.com/docs/13.x/upgrade
---
- **Mass writes skip model logic**: `Model::where(...)->update()`/`delete()` fire no model events or observers and apply no mutators or casts (arrays not JSON-encoded) → audit trails, cache busting and hashing silently skipped.
- **insert/upsert**: `insert()` sets no timestamps and runs no casts or events; MySQL/MariaDB `upsert()` ignores `uniqueBy` and matches any unique index → the wrong row is updated. Fix: include timestamps, make keys explicit.
- **Check-then-insert races**: `firstOrCreate`/`updateOrCreate` under concurrency create duplicates or throw unique violations. Fix: a unique index plus `createOrFirst()`.
- **Lost updates**: `$acct->balance -= $x; $acct->save()` overwrites concurrent changes. Fix: `decrement()`/`increment()`, or `lockForUpdate()` inside a transaction.
- **Locks without a transaction**: `lockForUpdate()`/`sharedLock()` in autocommit mode release the lock when the statement ends → no protection.
- **Transaction closures**: `DB::transaction($fn, attempts: 3)` re-runs the whole closure on deadlock (HTTP calls and mails repeat); catching exceptions inside the closure commits partial work.
- **Joined deletes (≤12)**: on MySQL, `DB::table('a')->join(...)->orderBy(...)->limit(100)->delete()` silently dropped ORDER BY/LIMIT before Laravel 13 → every matched row deleted.
