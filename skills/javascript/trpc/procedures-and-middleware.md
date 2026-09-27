---
name: Procedures, middleware and context
description: tRPC authorization defects — private data on publicProcedure, middleware that does not return next() or narrow ctx, authorization decided on unvalidated raw input, identity taken from input instead of ctx, shared per-request context and hand-built server-side callers.
priority: 68
tags: [CWE-862, CWE-639, CWE-285]
activation:
  content:
    - "\\b(?:publicProcedure|protectedProcedure|adminProcedure|baseProcedure|t\\.procedure)\\b"
    - "\\bt\\.middleware\\s*\\(|\\.use\\s*\\(\\s*(?:async\\s*)?(?:\\(|\\w+Middleware\\b|isAuthed\\b)"
    - "\\bopts\\.next\\s*\\(|\\bnext\\s*\\(\\s*\\{\\s*ctx\\b|\\bgetRawInput\\s*\\(|\\brawInput\\b"
    - "\\bcreate(?:\\w+)?Context\\s*[=(:]|\\bcreateCallerFactory\\s*\\(|\\bcreateCaller\\s*\\("
    - "\\binput\\.(?:userId|ownerId|tenantId|orgId|accountId|authorId)\\b"
sources:
  - https://trpc.io/docs/server/middlewares
  - https://trpc.io/docs/server/context
  - https://trpc.io/docs/server/authorization
  - https://trpc.io/docs/server/server-side-calls
---
- **Wrong base procedure**: queries or mutations touching private data built on `publicProcedure` (or `t.procedure`) instead of the authenticated base — easy when copying routers. Fix: default to `protectedProcedure`; review every `publicProcedure`.
- **Middleware contract**: middleware must `return opts.next(...)`; forgetting `return` fails every call, and authenticating without passing `next({ ctx: { user } })` leaves `ctx.user` nullable downstream (`ctx.user!` crashes). Fix: return `next` with narrowed ctx.
- **Raw input in middleware**: `.use()` placed before `.input()` receives unvalidated input (`getRawInput()`, v10 `rawInput`) — authorization decided on unexpected shapes. Fix: authorize after `.input()`, or validate inside the middleware.
- **Identity from input**: `input.userId`/`orgId` used for ownership instead of `ctx.session.user.id` lets any client act on others' records. Fix: derive identity from ctx; check ownership of every id.
- **Per-request context**: `createContext` runs once per HTTP request and is shared by all procedures in a batch — mutating `ctx` in one leaks into siblings, and expensive lookups run even for public calls. Fix: immutable ctx, lazy lookups.
- **Server-side callers**: `createCaller(ctx)` in server components, actions or jobs with a hand-built ctx (`{ session: null }` or a system/admin ctx) runs procedures with the wrong identity. Fix: build ctx from the real request (`headers()`).
