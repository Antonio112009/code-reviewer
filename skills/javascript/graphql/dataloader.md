---
name: DataLoader batching and caching
description: DataLoader and N+1 defects — loaders shared across requests, batch functions returning rows in the wrong order or length, object keys without cacheKeyFn, stale or error-poisoned caches after mutations, unbounded batches and resolvers bypassing loaders.
priority: 62
tags: [CWE-200, CWE-400]
activation:
  content:
    - "\\bnew\\s+DataLoader\\b|\\bDataLoader\\s*<|\\bdataloader\\b"
    - "\\.(?:load|loadMany|clear|clearAll|prime)\\s*\\("
    - "@(?:ResolveField|FieldResolver)\\s*\\("
  examples:
    - 'const userLoader = new DataLoader(batchUsers);'
    - 'const user = await userLoader.load(id);'
    - '@ResolveField(() => User)'
sources:
  - https://github.com/graphql/dataloader
  - https://www.prisma.io/docs/orm/prisma-client/queries/query-optimization-performance
---
- **Shared loader**: a DataLoader created at module level or in a singleton provider caches results across requests and users → stale data and cross-user leaks. Fix: create loaders per request in `context`.
- **Order and length**: the batch function must return exactly one value per key, in key order; returning `WHERE id IN (…)` rows as-is attaches data to the wrong parents or rejects. Fix: map rows by key; `null`/`Error` for misses.
- **Object keys**: keys like `{ id, locale }` compare by reference → no deduplication, one query per call. Fix: `cacheKeyFn: (k) => \`${k.id}:${k.locale}\``, or primitive keys.
- **Stale after writes**: mutations don't invalidate loader caches, so later resolvers in the same request read old values. Fix: `loader.clear(id)` or `prime(id, updated)` after writes.
- **Cached failures**: rejected loads are memoised for the request, so retries in the same operation get the same error. Fix: `clear(key)` on transient errors.
- **Batch size**: without `maxBatchSize`, huge `IN (…)` lists exceed driver parameter limits (e.g. SQL Server's 2100, PostgreSQL's 65535) or return oversized results. Fix: set `maxBatchSize`.
- **Bypassed loaders**: field resolvers querying the ORM directly per parent (`findFirst`, `repo.findOne`) turn lists into N+1 queries even though a loader exists. Fix: route every per-parent lookup through loaders.
