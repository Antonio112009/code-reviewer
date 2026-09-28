---
name: EF Core model mapping
description: Mapping defects — decimal precision defaults, value converters on mutable types without comparers, enums stored as ints, DateTime Kind lost on round-trips (and Npgsql 6+ UTC rules), SQL Server triggers vs OUTPUT (EF 7+) and EF 10 json columns.
priority: 62
tags: [CWE-681, CWE-197]
activation:
  content:
    - '\bHasPrecision\(|\[Precision\(|\bdecimal\b'
    - '\bHasConversion\b|\bValueConverter\b|\bValueComparer\b|\bHasTrigger\(|\bToTable\('
    - '\bIEntityTypeConfiguration<|\bmodelBuilder\.Entity<|\bToJson\(|\bUseAzureSql\(|\bUseCompatibilityLevel\('
  examples:
    - 'builder.Property(p => p.Rate).HasPrecision(18, 4);'
    - '[Precision(18, 4)] public decimal Rate { get; set; }'
    - 'builder.Property(p => p.Tags).HasConversion(v => string.Join(",", v), v => v.Split(",").ToList());'
    - 'builder.ToTable(t => t.HasTrigger("TR_Users_Audit"));'
    - 'public class UserConfiguration : IEntityTypeConfiguration<User> { }'
    - 'modelBuilder.Entity<Order>().ToJson();'
sources:
  - https://learn.microsoft.com/en-us/ef/core/modeling/value-comparers
  - https://learn.microsoft.com/en-us/ef/core/what-is-new/ef-core-7.0/breaking-changes
  - https://www.npgsql.org/doc/types/datetime.html
  - https://learn.microsoft.com/en-us/ef/core/what-is-new/ef-core-10.0/breaking-changes
---
- **Decimal precision**: `decimal` properties without `HasPrecision`/`[Precision]` map to `decimal(18,2)` on SQL Server (EF only logs a warning) → values like 0.125 or rates with more scale are silently rounded. Fix: explicit precision and scale.
- **Mutable converted types**: value converters for `List<T>`, arrays, dictionaries or custom classes (JSON/CSV columns) without a `ValueComparer` → in-place mutations aren't detected and never saved. Fix: supply a `ValueComparer`, or EF 8+ primitive collections/JSON columns.
- **Enums as ints**: enums are stored as integers (EF 8 also for enums inside JSON columns) → inserting or reordering members changes the meaning of existing rows. Fix: explicit numeric values or `HasConversion<string>()`.
- **DateTime Kind**: values read back from `datetime2`/`timestamp` columns are `Kind=Unspecified` → later `ToUniversalTime()` shifts them; Npgsql 6+ throws when writing non-UTC `DateTime` to `timestamp with time zone`. Fix: store UTC with a Kind-setting converter, or `DateTimeOffset`.
- **Triggers (SQL Server)**: since EF 7 `SaveChanges` uses `OUTPUT` clauses, which fail on tables with triggers unless declared via `ToTable(t => t.HasTrigger("name"))`. Fix: declare every trigger.
- **EF 10 json columns**: with `UseAzureSql` or compatibility level ≥ 170, primitive collections and `ToJson()` types map to SQL Server `json` — upgrading scaffolds a migration altering `nvarchar(max)` columns; some queries (e.g. `DISTINCT`) stop working. Fix: review it or `UseCompatibilityLevel(160)`.
