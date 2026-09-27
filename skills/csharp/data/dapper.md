---
name: Dapper queries
description: Dapper defects — interpolated/concatenated SQL strings (not parameterized), IN-list expansion limits, fully buffered results, First vs Single semantics, multi-mapping splitOn, nvarchar parameters against varchar columns, literal replacements and missing cancellation.
priority: 68
tags: [CWE-89, A05:2025]
activation:
  content:
    - '\.(?:Query|QueryFirst|QueryFirstOrDefault|QuerySingle|QuerySingleOrDefault|QueryMultiple|QueryUnbuffered|Execute|ExecuteScalar|ExecuteReader)(?:Async)?\s*(?:<[^>\n]{1,80}>)?\('
    - '\bDynamicParameters\b|\bCommandDefinition\b|\bDbString\b|\bsplitOn\b|\bAsTableValuedParameter\('
sources:
  - https://github.com/DapperLib/Dapper/blob/main/Readme.md
  - https://learn.microsoft.com/en-us/sql/sql-server/maximum-capacity-specifications-for-sql-server
---
- **Interpolation isn't parameterization**: Dapper takes a plain `string` — `conn.Query<T>($"… WHERE Id = {id}")` or concatenation → SQL injection (unlike EF `FromSql`). Fix: `@name` placeholders with an anonymous object or `DynamicParameters`.
- **IN-list expansion**: `WHERE Id IN @Ids` becomes one parameter per element → SQL Server's 2,100-parameter limit throws on big lists; each length is a new plan. Fix: batches, `AsTableValuedParameter`, or `= ANY(@ids)` on PostgreSQL.
- **Buffered by default**: `Query<T>` loads the whole result set into memory; `buffered: false` keeps the reader and connection open while enumerating. Fix: page or stream deliberately.
- **First vs Single**: `QueryFirstOrDefault` silently picks one of several rows; `QuerySingle*` throws on duplicates → wrong record when the WHERE isn't unique. Fix: `QuerySingleOrDefault` where uniqueness is expected, `ORDER BY` with `First`.
- **splitOn**: multi-mapping splits on a column named `Id` by default; a joined key named differently (`UserId`) shifts columns into the wrong object silently. Fix: explicit `splitOn` matching the SELECT order.
- **nvarchar vs varchar**: C# strings are sent as `nvarchar(4000)` → implicit conversion prevents index seeks on `varchar` columns. Fix: `new DbString { Value = v, IsAnsi = true, Length = n }`.
- **Literals and cancellation**: `{=Name}` literal replacements are inlined, not parameters (numeric/bool constants only); `QueryAsync(sql, param)` can't take a token. Fix: `new CommandDefinition(sql, param, cancellationToken: ct)`.
