---
name: Optimistic concurrency
description: EF Core concurrency defects — read-modify-write without a concurrency token, detached updates comparing against the wrong original value, mishandled DbUpdateConcurrencyException, bypasses via ExecuteUpdate/raw SQL, check-then-insert races and provider-specific row versions.
priority: 66
tags: [CWE-362, CWE-367]
activation:
  content:
    - '\[(?:Timestamp|ConcurrencyCheck)\]|\bIsRowVersion\(|\bIsConcurrencyToken\(|\bRowVersion\b|\bxmin\b'
    - '\bDbUpdate(?:Concurrency)?Exception\b|\bOriginalValue\b|\bGetDatabaseValues\w*\('
sources:
  - https://learn.microsoft.com/en-us/ef/core/saving/concurrency
  - https://learn.microsoft.com/en-us/ef/core/saving/execute-insert-update-delete
  - https://www.npgsql.org/efcore/modeling/concurrency.html
---
- **No token**: read-modify-write of shared rows (balances, stock, status, counters) without `[Timestamp]`/`IsRowVersion()`/`[ConcurrencyCheck]` → last write wins, lost updates. Fix: add a token, or an atomic `ExecuteUpdate(s => s.SetProperty(p => p.Stock, p => p.Stock - n))` with a guard in `Where`.
- **Wrong original value**: in disconnected updates the client's row version must be set as the original (`Entry(e).Property(x => x.RowVersion).OriginalValue = dto.RowVersion`); loading fresh and copying fields compares against the latest version → conflicts never detected. Fix: set `OriginalValue`.
- **Exception handling**: catching `DbUpdateConcurrencyException` and simply calling `SaveChanges` again, or swallowing it → infinite retries or silent loss. Fix: `GetDatabaseValues()`, resolve/merge, or return 409.
- **Bypasses**: `ExecuteUpdate`/`ExecuteDelete` and raw SQL neither check tokens nor bump app-managed ones (`[ConcurrencyCheck]` values you set yourself). Fix: include the token in `Where`, update it in `SetProperty`, check affected rows.
- **Check-then-insert**: `if (!await db.Users.AnyAsync(u => u.Email == email)) db.Add(…)` races under concurrency → duplicates. Fix: unique index plus handling the unique-violation `DbUpdateException`.
- **Provider row versions**: `rowversion` is SQL Server-specific; on other providers the column isn't bumped automatically → the check never fires. Fix: provider mechanism (PostgreSQL `xmin`) or set the token on every update.
