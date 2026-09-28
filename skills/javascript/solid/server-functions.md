---
name: SolidStart server functions and actions
description: SolidStart "use server" functions, queries and actions — public RPC endpoints without authorization, unvalidated arguments, missing CSRF origin checks, over-returned data, shared module state and redirects that are never thrown.
category: security
priority: 68
tags: [CWE-862, CWE-352, CWE-20]
activation:
  content:
    - "['\"]use server['\"]"
    - "\\b(?:action|createAsync|useSubmission|useAction)\\s*\\("
    - "\\bgetRequestEvent\\s*\\("
    - "from ['\"]@solidjs/start(?:/[a-z]+)?['\"]"
  examples:
    - "'use server';"
    - "const data = createAsync(() => getUser(id));"
    - "const event = getRequestEvent();"
    - "import { getRequestEvent } from '@solidjs/start/server';"
sources:
  - https://docs.solidjs.com/solid-start/v1/reference/server/use-server
  - https://docs.solidjs.com/solid-start/v1/guides/data-mutation
  - https://github.com/solidjs/solid-router/issues/507
  - https://github.com/solidjs/solid-start/pull/2324
---
- **Public RPC**: every `"use server"` function (including server-side `query`/`action` bodies) is an HTTP endpoint callable with any arguments → missing session or ownership checks = IDOR. Fix: authenticate and authorize inside via `getRequestEvent()`.
- **Unvalidated arguments**: parameters typed as `User` or `number` are not checked at runtime → type confusion, mass assignment. Fix: type them `unknown` and parse with a schema.
- **No origin check**: SolidStart ≤2.0.5 does not verify `Origin`/`Sec-Fetch-Site` on server-function requests → cookie-authenticated mutations are CSRF-able. Fix: `SameSite=Lax`/`Strict` session cookies or an Origin check in middleware.
- **Over-returned data**: returning ORM rows or whole users from server functions/queries → serialized to the client. Fix: return DTOs.
- **Module state**: per-request data in module-level variables of server files → shared by concurrent requests. Fix: `getRequestEvent().locals`.
- **Redirect not thrown**: calling `redirect('/login')` without `throw` (or `return` from an action) → only builds a Response; execution continues. Fix: `throw redirect(…)`.
