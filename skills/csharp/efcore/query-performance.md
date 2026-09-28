---
name: EF Core query shape and performance
description: EF Core query defects — N+1 from loops and lazy loading, client-side filtering after AsEnumerable/ToList, cartesian explosion and split-query caveats, overfetching, unstable pagination and version-dependent Contains translation (EF 8 OPENJSON, EF 10 multi-parameter).
priority: 66
tags: [CWE-400, CWE-1049]
activation:
  content:
    - '\.(?:Include|ThenInclude|AsSplitQuery|AsSingleQuery|AsEnumerable|AsAsyncEnumerable|Skip|Take)\('
    - '\.(?:ToList|ToListAsync|Count|CountAsync|Any|AnyAsync|Contains|Select)\('
    - '\bUseLazyLoadingProxies\(|\bvirtual\s+(?:ICollection|IList|List)<|\bUseCompatibilityLevel\('
  examples:
    - 'var orders = await context.Orders.Include(o => o.Lines).AsSplitQuery().ToListAsync();'
    - 'var page = await context.Orders.OrderBy(o => o.Id).Skip(50).Take(25).ToListAsync();'
    - 'var count = context.Orders.Where(o => ids.Contains(o.Id)).Count();'
    - 'public virtual ICollection<OrderLine> Lines { get; set; } = new List<OrderLine>();'
sources:
  - https://learn.microsoft.com/en-us/ef/core/performance/efficient-querying
  - https://learn.microsoft.com/en-us/ef/core/querying/single-split-queries
  - https://learn.microsoft.com/en-us/ef/core/querying/client-eval
  - https://learn.microsoft.com/en-us/ef/core/what-is-new/ef-core-8.0/breaking-changes
---
- **N+1**: queries inside loops (`foreach (var o in orders) await db.Lines.Where(l => l.OrderId == o.Id).ToListAsync()`) or lazy-loading proxies touched per row → one round-trip per item. Fix: `Include`, a `Select` projection, or one query with `Contains`.
- **Client-side filtering**: `AsEnumerable()`, `ToList()` or an `IEnumerable<T>` repository return before `Where`/`OrderBy`/`Skip`/`Take`/`Count` → the whole table is loaded and filtered in memory. Fix: keep `IQueryable` until the final operator.
- **Cartesian explosion**: several collection `Include`s at the same level multiply rows (EF warns). `AsSplitQuery()` fixes that but split queries aren't consistent without a transaction, and before EF 10 `Skip/Take` with split queries needs a fully unique `OrderBy`.
- **Overfetching**: full entities (with large columns) loaded to read a few fields, `Include` just to count children, `ToList().Any()`/`Count() > 0`. Fix: projections, `AnyAsync`, `CountAsync`.
- **Pagination**: `Skip/Take` without a unique `OrderBy` → rows duplicated or missing across pages; deep offsets scan everything. Fix: order by a unique key; keyset pagination.
- **Contains over lists**: EF 8/9 send `ids.Contains(x.Id)` as a JSON parameter with `OPENJSON` (SQL Server compatibility level ≥ 130; older databases fail unless `UseCompatibilityLevel`); EF 10 defaults to multiple parameters. Huge lists still cost. Fix: correct compatibility level, batch big lists.
