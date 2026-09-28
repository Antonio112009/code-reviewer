---
name: Validation, outputs and errors
description: tRPC data-exposure and error defects — procedures without strict input validators, outputs returning whole ORM rows, transformer mismatches between server and links, raw error messages sent to clients, isDev stack traces and onError logging of inputs.
priority: 64
tags: [CWE-20, CWE-200, CWE-209, CWE-532]
activation:
  content:
    - "\\.input\\s*\\(|\\.output\\s*\\(|\\bz\\.(?:any|unknown)\\s*\\(|\\.passthrough\\s*\\("
    - "\\bTRPCError\\b|\\berrorFormatter\\b|\\bonError\\s*[:(]|\\bisDev\\b"
    - "\\btransformer\\s*:|\\bsuperjson\\b"
    - "\\.(?:query|mutation)\\s*\\(\\s*(?:async\\s*)?\\(\\s*\\{"
  examples:
    - '.input(z.object({ id: z.string() }))'
    - 'throw new TRPCError({ code: ''BAD_REQUEST'' });'
    - 'transformer: superjson,'
    - '.query(async ({ ctx }) => ctx.user);'
sources:
  - https://trpc.io/docs/server/validators
  - https://trpc.io/docs/server/error-handling
  - https://github.com/trpc/trpc/blob/main/packages/server/src/unstable-core-do-not-import/error/TRPCError.ts
  - https://trpc.io/docs/migrate-from-v10-to-v11
---
- **Loose input**: procedures without `.input()`, or with `z.any()`/`.passthrough()`, accept arbitrary client data that flows into the ORM (`data: input`). Fix: strict schemas for every procedure taking input.
- **Whole-row outputs**: tRPC serialises whatever the resolver returns — returning `prisma.user.findUnique()` sends password hashes and tokens. Fix: `select` explicit fields or add `.output(schema)` (unknown keys stripped; failures become 500s).
- **Raw error messages**: any non-`TRPCError` thrown becomes `INTERNAL_SERVER_ERROR` whose `message` is the original one (Prisma, SQL, HTTP-client details) — sent to clients in production. Fix: an `errorFormatter` that masks 500 messages; throw `TRPCError` with `cause`.
- **isDev default**: `initTRPC.create()` sets `isDev` to `NODE_ENV !== 'production'`, so servers with NODE_ENV unset return stack traces in `error.data.stack`. Fix: set NODE_ENV or `isDev: false`.
- **Logging inputs**: `onError({ input, req })` handlers that log `input` or headers write passwords, tokens and PII to logs. Fix: redact before logging.
- **Transformer mismatch**: v11 moved `transformer` from the client to each link — a server using `superjson` while a link lacks it delivers `Date`s as strings, breaks `Map`/`Set`/`BigInt`, or fails to parse responses. Fix: same transformer on `initTRPC` and every link.
