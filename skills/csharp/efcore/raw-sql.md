---
name: EF Core raw SQL
description: Raw SQL in EF Core — FromSqlRaw/ExecuteSqlRaw/SqlQueryRaw with interpolated or pre-built strings (injection), identifiers that can't be parameters, FromSql composition limits and tracked entities left stale by ExecuteSql.
priority: 74
tags: [CWE-89, A05:2025]
activation:
  content:
    - '\b(?:FromSql|FromSqlRaw|FromSqlInterpolated|SqlQuery|SqlQueryRaw|ExecuteSql|ExecuteSqlRaw|ExecuteSqlInterpolated)(?:Async)?\b'
  examples:
    - 'var users = context.Users.FromSqlInterpolated($"SELECT * FROM Users WHERE Id = {id}");'
    - 'await context.Database.ExecuteSqlRawAsync("UPDATE Users SET Active = 0 WHERE Id = " + id);'
sources:
  - https://learn.microsoft.com/en-us/ef/core/querying/sql-queries
  - https://learn.microsoft.com/en-us/ef/core/saving/execute-insert-update-delete
  - https://github.com/dotnet/efcore/issues/35735
---
- **Raw APIs with built strings**: `FromSqlRaw($"… {input}")`, `ExecuteSqlRaw("… " + input)`, or `SqlQueryRaw<T>(sql)` with `sql` built earlier → SQL injection. Only `FromSql`/`FromSqlInterpolated`, `ExecuteSql(Async)` and `SqlQuery<T>` parameterize (`FormattableString`). EF1002 checks only the call site (concatenation from EF 10).
- **Losing FormattableString**: assigning `$"…"` to a `string` first, then switching to `*Raw` because the safe overload no longer compiles → values inlined. Fix: pass the interpolated string directly, or `DbParameter` placeholders (`{0}`/`@p`) with `*Raw`.
- **Identifiers aren't parameters**: table/column names or `ASC/DESC` interpolated into `FromSql` become parameters (SQL errors or wrong results); into `FromSqlRaw` they become injection. Fix: allowlist identifiers (switch/`nameof`) and only then concatenate.
- **Composition limits**: `FromSql` must return every entity column with matching names; SQL Server can't compose LINQ over stored procedure calls (use `AsEnumerable()` after); results are tracked like normal queries. Fix: `AsNoTracking()` for read-only raw queries.
- **Stale tracked state**: `ExecuteSql*` changes rows behind the change tracker → tracked entities keep old values and a later `SaveChanges` can overwrite the raw update. Fix: `ChangeTracker.Clear()` or reload affected entities.
