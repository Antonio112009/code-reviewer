---
name: HTTP transport, CSRF and caching
description: How JS GraphQL servers are exposed over HTTP — Apollo csrfPrevention and Yoga's opt-in CSRF plugin, multipart uploads, Express integration wiring and per-request context, and CDN or response caching of per-user data.
priority: 64
tags: [CWE-352, CWE-524, CWE-400]
activation:
  content:
    - "\\bcsrfPrevention\\b|\\buseCSRFPrevention\\b|\\bplugin-csrf-prevention\\b"
    - "\\bexpressMiddleware\\s*\\(|\\bstartStandaloneServer\\s*\\(|@as-integrations/|@apollo/server/(?:express4|standalone)"
    - "\\bgraphqlUploadExpress\\b|\\bGraphQLUpload\\b|\\bmultipart\\s*:"
    - "@cacheControl\\b|\\bcacheControl\\b|\\buseResponseCache\\s*\\(|\\bresponseCachePlugin\\b"
    - "\\bcontext\\s*:\\s*(?:async\\s*)?\\(|\\bcontext\\s*\\(\\s*\\{\\s*req\\b"
  examples:
    - 'csrfPrevention: true,'
    - 'app.use(''/graphql'', expressMiddleware(server));'
    - 'app.use(graphqlUploadExpress({ maxFileSize: 10_000_000 }));'
    - '@cacheControl(maxAge: 60)'
    - 'context: async ({ req }) => ({ user: req.user }),'
sources:
  - https://www.apollographql.com/docs/apollo-server/security/cors
  - https://the-guild.dev/graphql/yoga-server/docs/features/csrf-prevention
  - https://www.apollographql.com/docs/apollo-server/api/express-middleware
  - https://github.com/apollographql/apollo-server/security/advisories/GHSA-8r69-3cvp-wxc3
---
- **CSRF**: with cookie auth, disabling Apollo's `csrfPrevention` — or running Yoga, whose CSRF plugin is opt-in — lets cross-site pages send simple GET queries and `text/plain`/multipart POSTs without a preflight. Fix: keep or enable CSRF prevention (require a custom header).
- **Uploads**: `graphql-upload` and Yoga's multipart support (on by default) accept form-style requests, the classic CSRF vector, and need `maxFileSize`/`maxFiles`. Fix: require `Apollo-Require-Preflight`, set limits, or `multipart: false` when unused.
- **Integration wiring**: `expressMiddleware(server)` needs `await server.start()` first and `express.json()` mounted before it (Express 5 leaves `req.body` undefined); Apollo Server 5 moved it to `@as-integrations/express4`/`express5`.
- **Per-request context**: `context` must build a fresh object per request — returning a shared object, or caching the user or DataLoaders in a closure, leaks identities and data across requests.
- **Shared caches**: `@cacheControl(maxAge)` or response-cache plugins on user-specific data without `scope: PRIVATE`/a `session` key let CDNs or the server cache serve one user's data to others; batched responses carry one cache policy for all operations.
