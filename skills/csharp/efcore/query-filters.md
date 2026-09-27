---
name: Global query filters (soft delete, multi-tenancy)
description: HasQueryFilter defects — IgnoreQueryFilters removing tenant filters with soft-delete ones, a second HasQueryFilter overwriting the first before EF 10 named filters, per-request values captured in the cached model, required navigations dropping rows and raw SQL bypassing filters.
priority: 70
tags: [CWE-639, CWE-284, A01:2025]
activation:
  content:
    - '\bHasQueryFilter\(|\bIgnoreQueryFilters\('
    - '\bTenantId\b|\bIsDeleted\b|\bOnModelCreating\('
sources:
  - https://learn.microsoft.com/en-us/ef/core/querying/filters
  - https://learn.microsoft.com/en-us/ef/core/miscellaneous/multitenancy
  - https://learn.microsoft.com/en-us/ef/core/modeling/dynamic-model
---
- **IgnoreQueryFilters is all-or-nothing**: used to include soft-deleted rows, it also drops tenant/security filters → cross-tenant reads and updates. EF 10 named filters allow `IgnoreQueryFilters(["SoftDelete"])`. Fix: named filters, or re-add the tenant predicate.
- **Second filter overwrites the first**: before EF 10 named filters, calling `HasQueryFilter` twice on an entity keeps only the last → adding a tenant filter silently removes soft delete (or vice versa). Fix: one combined expression or named filters.
- **Per-request values in a cached model**: filters, schemas or table names built in `OnModelCreating` from a local, static or service value → the model is cached per context type, so the first tenant's value applies to everyone. Fix: reference a `DbContext` instance property.
- **Required navigations**: filtering out a principal reached through a required navigation turns into an INNER JOIN → dependents disappear from results unexpectedly. Fix: optional navigation or consistent filters on both sides.
- **Bypasses**: raw SQL (`ExecuteSql*`, `SqlQuery<T>` over unmapped types), Dapper/ADO.NET on the same database, reporting views → no tenant filter at all. Fix: add the tenant predicate explicitly there.
