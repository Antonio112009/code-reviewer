---
name: QuerySet performance and N+1
description: Django QuerySet evaluation traps — N+1 relation access, prefetch caches bypassed by chained calls, len()/bool() on querysets, unbounded loads, iterator() caveats and 6.1 fetch modes.
priority: 60
activation:
  content:
    - '\.objects\.'
    - '\b(?:select_related|prefetch_related|Prefetch|iterator|aiterator|only|defer|fetch_mode)\('
    - '\.(?:all|filter|exclude)\([^)\n]{0,120}\)\s*:'
    - '\b(?:len|list|bool)\(\s*\w+(?:\.\w+){0,3}\.(?:all|filter|exclude)\('
sources:
  - https://docs.djangoproject.com/en/stable/topics/db/optimization/
  - https://docs.djangoproject.com/en/stable/ref/models/querysets/
  - https://docs.djangoproject.com/en/dev/topics/db/fetch-modes/
---
- **N+1 relation access**: a loop, template or serializer reads `obj.fk.attr` or `obj.children.all()` per row without `select_related` (FK) or `prefetch_related` (reverse FK/M2M) → one query per row. Fix: eager-load; on 6.1+ `fetch_mode(models.FETCH_PEERS)`.
- **Prefetch bypassed**: `.filter()`, `.exclude()`, `.order_by()` or `.annotate()` on a prefetched manager inside the loop queries again per object. Fix: `Prefetch("rel", queryset=..., to_attr=...)`.
- **Deferred fields**: `.only()`/`.defer()` then reading a deferred field per instance → one query each. Fix: load it up front.
- **Evaluating to test or count**: `if qs:`, `len(qs)`, `list(qs)` only to check emptiness or size loads every row. Fix: `.exists()` / `.count()`, unless the rows are used anyway.
- **Unbounded loads**: `.all()` in views, exports or tasks materialises the whole table. Fix: paginate, `.iterator(chunk_size=...)`, `.values_list()`, batches by primary key.
- **iterator() caveats**: prefetching needs `chunk_size` (ignored before 5.0 → N+1, ValueError since); MySQL still buffers the full result; PgBouncer transaction pooling needs `DISABLE_SERVER_SIDE_CURSORS=True`.
- **select_related() without arguments**: joins every non-null FK (deprecated in 6.1). Fix: name the relations.
