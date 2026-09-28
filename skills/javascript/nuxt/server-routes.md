---
name: Nitro server routes
description: Nuxt server/api and server/middleware (Nitro/h3) defects — missing per-handler authorization, unvalidated input, over-returned records, misbehaving server middleware, app code on the server and leaky errors.
category: security
priority: 68
tags: [CWE-862, CWE-20, CWE-209]
activation:
  files: ["**/server/**/*.{ts,js,mjs}"]
  content:
    - "\\bdefine(?:Cached)?EventHandler\\b"
    - "\\b(?:readBody|readRawBody|readFormData|readMultipartFormData|getQuery|getRouterParams?|getCookie)\\s*[(<]"
    - "\\bcreateError\\s*\\("
  examples:
    - 'export default defineEventHandler(async (event) => { const body = await readBody(event); return body; });'
    - 'throw createError({ statusCode: 404, statusMessage: ''Not found'' });'
sources:
  - https://nuxt.com/docs/4.x/guide/directory-structure/server
  - https://h3.dev/utils/request
  - https://h3.dev/guide/basics/error
  - https://nuxt.com/docs/4.x/api/utils/create-error
---
- **Page middleware as auth**: `server/api` handlers relying on route middleware/`definePageMeta` (page navigation only) → endpoints callable directly without a session. Fix: check session and ownership in every handler (or a server util/middleware).
- **Unvalidated input**: `readBody<T>()`, `getQuery()`, `getRouterParam()` results only cast → wrong types, `string[]` query values, mass assignment when spread into DB writes. Fix: `readValidatedBody`/`getValidatedQuery`/`getValidatedRouterParams` with a schema.
- **Over-returning**: handlers returning ORM rows or user objects as-is → password hashes, tokens and other users' fields in JSON and SSR payloads. Fix: map to DTOs.
- **Server middleware responding**: a `server/middleware` handler that returns a value or ends the response → every route answers with it. Fix: only read/extend `event.context`, or throw.
- **App code on the server**: importing components or composables (`useState`, `useNuxtApp`) into `server/` → crashes; `useRuntimeConfig()` without `event` may miss runtime overrides. Fix: server utils only; `useRuntimeConfig(event)`.
- **Module-level request state**: per-request data stored in module variables of `server/` files → shared across concurrent requests. Fix: `event.context`.
- **Leaky errors**: `createError({ statusText: e.message, data: dbError })` → explicit HTTP errors reach the client as-is (only unhandled ones are masked). Fix: generic text; log details server-side.
