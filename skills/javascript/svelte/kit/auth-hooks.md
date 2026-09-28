---
name: Hooks, auth and cookies
description: SvelteKit authentication and hook defects — layout-only auth, broken handle contract, credentials leaked by handleFetch, error details from handleError, weakened cookie options and redirects swallowed by try/catch.
category: security
priority: 70
tags: [CWE-285, CWE-209, CWE-614]
activation:
  files: ["**/hooks.server.{js,ts}", "**/hooks.client.{js,ts}", "**/+layout.server.{js,ts}"]
  content:
    - "\\b(?:handle|handleFetch|handleError|handleValidationError)\\s*[:=(]"
    - "\\bsequence\\s*\\("
    - "\\bcookies\\.(?:set|delete|serialize)\\s*\\("
    - "\\blocals\\.(?:user|session)\\b"
    - "\\b(?:redirect|error)\\s*\\(\\s*[0-9]{3}"
  examples:
    - 'export const handle: Handle = async ({ event, resolve }) => resolve(event);'
    - 'export const handle = sequence(authHandle, loggingHandle);'
    - 'cookies.set(''session'', token, { httpOnly: true, secure: true, path: ''/'' });'
    - 'event.locals.user = await getUser(token);'
    - 'throw redirect(303, ''/login'');'
sources:
  - https://svelte.dev/docs/kit/hooks
  - https://svelte.dev/docs/kit/load
  - https://svelte.dev/docs/kit/@sveltejs-kit#Cookies
  - https://svelte.dev/blog/sveltekit-3-release-candidate
---
- **Layout-only auth**: a session check in `+layout.server.ts` does not protect `+page.server.ts` loads (run in parallel), form actions, `+server.ts` endpoints or remote functions → direct requests bypass it. Fix: authenticate in `handle`; authorize in every endpoint and action.
- **handle contract**: `handle` paths that don't return `resolve(event)` or a Response → 500s; auth data kept in module variables instead of `event.locals` → shared across requests. Fix: always return; use `event.locals`.
- **handleFetch credential leak**: forwarding `cookie`/`authorization` headers to every URL in `handleFetch` → session tokens sent to third-party hosts. Fix: add credentials only for your API origin.
- **Leaky handleError**: returning `error.message`, stacks or DB errors from `handleError` → shown to users via `page.error` (in SvelteKit 3 also for `error()` calls). Fix: log internally; return a generic message and an id.
- **Weakened cookies**: `cookies.set` with `httpOnly: false`, `secure: false` or `sameSite: 'none'` for session cookies → readable by XSS or sent cross-site; no `path` (required since Kit 2) → error. Fix: keep the defaults; `path: '/'`.
- **Swallowed redirect**: `redirect()`/`error()` throw by design → inside `try/catch` they are caught and ignored. Fix: call them outside the `try`, or rethrow when `isRedirect(e)`/`isHttpError(e)`.
