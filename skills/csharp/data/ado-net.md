---
name: ADO.NET commands and connections
description: Raw ADO.NET defects — SQL text built from input, leaked connections exhausting the pool, null vs DBNull parameters, AddWithValue type inference, command timeouts and commands not enlisted in the open transaction.
priority: 68
tags: [CWE-89, CWE-404, A05:2025]
activation:
  content:
    - '\b(?:Sql|Npgsql|MySql|Sqlite|Oracle|Odbc|OleDb)(?:Command|Connection|Parameter|DataReader|Transaction)\b|\bI?Db(?:Command|Connection|DataReader|Parameter)\b'
    - '\.(?:ExecuteReader|ExecuteNonQuery|ExecuteScalar)(?:Async)?\(|\bCommandText\b'
    - '\bAddWithValue\(|\bDBNull\b|\bCommandTimeout\b|\bBeginTransaction(?:Async)?\('
sources:
  - https://learn.microsoft.com/en-us/dotnet/framework/data/adonet/configuring-parameters-and-parameter-data-types
  - https://learn.microsoft.com/en-us/sql/connect/ado-net/sql-server-connection-pooling
  - https://learn.microsoft.com/en-us/dotnet/api/system.data.sqlclient.sqlcommand.commandtimeout
---
- **SQL from strings**: `new SqlCommand("… WHERE Name = '" + name + "'")` or `$"…{id}"` in `CommandText` → SQL injection, also via `ORDER BY` and `IN (...)` lists. Fix: `Parameters.Add(...)`; allowlist identifiers.
- **Connection/reader leaks**: connections, commands or `DbDataReader`s not disposed (or disposed only on the happy path) → pool exhausted (`Max Pool Size` default 100) → "Timeout expired … max pool size was reached". Fix: `await using` for connection, command and reader.
- **null vs DBNull**: `parameter.Value = null` means "not supplied" (procedure error or default used), not SQL NULL; `(string)reader["col"]` throws on `DBNull.Value`. Fix: `(object?)value ?? DBNull.Value`; `IsDBNull`/`GetFieldValue<T?>`.
- **AddWithValue inference**: infers `nvarchar(length of value)`, `datetime` or `decimal` from the .NET value → implicit conversions on `varchar`/`datetime2` columns (index scans) and one cached plan per distinct length. Fix: `Add(name, SqlDbType.VarChar, size).Value = …`.
- **Timeouts**: `CommandTimeout` defaults to 30 s (separate from the connection timeout) → long jobs fail midway; `CommandTimeout = 0` waits forever; tokens not passed to `ExecuteReaderAsync(ct)`. Fix: explicit timeouts, pass tokens.
- **Transaction not attached**: after `BeginTransaction()`, SqlClient commands without `command.Transaction = tx` throw `InvalidOperationException`; other code paths run outside the intended transaction. Fix: assign the transaction to every command.
