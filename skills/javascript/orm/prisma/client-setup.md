---
name: Client instances, extensions and connections
description: Prisma client lifecycle — many PrismaClient instances exhausting connections, $extends results that are never used, query extensions skipping nested operations, $use removal and CLI env loading in v7, and v7 driver-adapter pool, timeout and TLS defaults.
priority: 62
tags: [CWE-400, CWE-295]
activation:
  content:
    - "\\bnew\\s+PrismaClient\\s*\\(|\\bglobalThis\\.\\w*[pP]risma\\b"
    - "\\$(?:extends|use|on)\\s*\\("
    - "@prisma/adapter-[\\w-]+|\\bPrisma(?:Pg|MariaDb|BetterSqlite3|Neon|D1|LibSQL|Mssql|PlanetScale)\\b|\\bprisma\\.config\\b|\\bdefineConfig\\s*\\("
    - "\\bconnection_limit\\b|\\bpool_timeout\\b|\\bconnectionTimeoutMillis\\b|\\bprovider\\s*=\\s*['\"]prisma-client"
sources:
  - https://www.prisma.io/docs/orm/prisma-client/client-extensions
  - https://www.prisma.io/docs/orm/v7/more/upgrade-guides/upgrading-versions/upgrading-to-prisma-7
  - https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/databases-connections/connection-pool
---
- **Many clients**: `new PrismaClient()` per request, per module or on every dev hot reload opens a pool each time → "too many connections" and P2024 timeouts. Fix: one shared instance (cached on `globalThis` in dev); an external pooler for serverless.
- **$extends is immutable**: `prisma.$extends(ext)` returns a new client — code that keeps using or exporting the original `prisma` silently skips soft-delete filters, tenant scoping or audit logic. Fix: export and inject only the extended client.
- **Query extensions scope**: `query` extensions don't run for nested reads and writes (`include`, nested `create`/`update`) → soft-delete or tenant filters leak through relations. Fix: also filter relations, or enforce in the database (RLS, views).
- **v7 removals**: Prisma 7 removed `$use` middleware (move logic to `$extends({ query })`) and the CLI no longer loads `.env` automatically. Fix: migrate middleware; load env in `prisma.config.ts`.
- **v7 pool defaults**: with driver adapters the pool is the driver's — `pg` defaults to `max: 10` with no acquire timeout (`connectionTimeoutMillis: 0`), so overload hangs instead of failing; invalid TLS certificates are now rejected.
