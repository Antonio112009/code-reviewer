---
name: DbContext lifetime and threading
description: DbContext misuse — concurrent operations on one instance, contexts captured in singletons/hosted services/Blazor circuits, long-lived contexts accumulating tracked entities, state leaking through DbContext pooling, reuse after failures and queries escaping their scope.
priority: 70
tags: [CWE-362, CWE-401]
activation:
  content:
    - '\bIDbContextFactory<|\bAddDbContext(?:Pool|Factory)?\b|\bPooledDbContextFactory\b|\bChangeTracker\b'
    - '\bTask\.WhenAll\(|\bParallel\.(?:For|ForEach|ForEachAsync)\('
    - ':\s*DbContext\b|\bDbContext\s+\w+\s*[;,)=]'
sources:
  - https://learn.microsoft.com/en-us/ef/core/dbcontext-configuration/
  - https://learn.microsoft.com/en-us/ef/core/performance/advanced-performance-topics
  - https://learn.microsoft.com/en-us/aspnet/core/blazor/blazor-ef-core
---
- **Concurrent use**: one `DbContext` used by parallel work (`Task.WhenAll` over queries, `Parallel.ForEach`, an un-awaited call followed by another) → "A second operation was started on this context instance". Fix: await sequentially, or one context per task via `IDbContextFactory<T>`.
- **Captured contexts**: `DbContext` held by singletons, static fields, hosted services or Blazor Server components (circuit-long scope) → unbounded change tracker, stale data, concurrent access across users. Fix: `IDbContextFactory<T>.CreateDbContext()` per unit of work.
- **Long-lived contexts**: batch jobs processing thousands of rows in one context → every entity stays tracked (memory growth, slower `DetectChanges`/`SaveChanges`). Fix: a context per batch, `ChangeTracker.Clear()`, `AsNoTracking()` for reads.
- **Pooling leaks state**: `AddDbContextPool` reuses instances like singletons — custom fields (tenant, user) set in the constructor or `OnConfiguring` carry into the next request, and the constructor can't take scoped services. Fix: set per-request state after renting (scoped factory wrapper).
- **Reuse after failure**: continuing with a context after an EF `InvalidOperationException` or failed `SaveChanges` retries the same pending changes or leaves it unusable. Fix: fresh context for retries.
- **Queries escaping the scope**: returning `IQueryable` or lazy-loaded navigations to code that runs after the scope ends → `ObjectDisposedException`. Fix: materialize inside the scope.
