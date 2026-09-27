---
name: Sessions and cookies (Remix / React Router)
description: createCookie / createCookieSessionStorage / createFileSessionStorage defects — unsigned cookies, missing cookie attributes, uncommitted session changes, flash-message races, cookie size limits, static expiry and secret rotation order.
priority: 68
tags: [CWE-565, CWE-614, CWE-1004]
activation:
  content:
    - "\\bcreate(?:Cookie|CookieSessionStorage|FileSessionStorage|MemorySessionStorage|SessionStorage)\\s*\\("
    - "\\b(?:commitSession|destroySession|getSession)\\s*\\("
    - "\\bsession\\.(?:flash|unset|set)\\s*\\("
sources:
  - https://reactrouter.com/explanation/sessions-and-cookies
  - https://github.com/remix-run/react-router/security/advisories/GHSA-9583-h5hc-x8cw
---
- **Unsigned cookies**: `createCookie` or session cookies without `secrets` → users can edit values (user IDs, roles); with `createFileSessionStorage`, unsigned ids allowed unauthorized file access before 7.9.4. Fix: always set `secrets`.
- **Missing cookie attributes**: no `httpOnly`, `secure` or `sameSite: "lax"` → cookie theft through XSS, cleartext transport, cross-site sends. Fix: set them explicitly; there are no secure defaults.
- **Uncommitted changes**: `session.set`, `flash` or `unset` without returning `Set-Cookie: await commitSession(session)` in that response → changes are lost and flash messages reappear. Fix: commit on every response that touches the session.
- **Flash races**: parallel loaders reading the same flash key, or reading without committing → messages lost or shown twice. Fix: separate keys; commit after reading.
- **Cookie size**: cookie session storage keeps all data in the cookie (~4 KB) → large sessions get rejected by browsers and users are silently logged out. Fix: server-side session storage.
- **Static expiry**: `expires: new Date(Date.now() + …)` evaluated once at module load → cookies all expire at the same moment after a deploy. Fix: `maxAge` in seconds.
- **Secret rotation order**: `secrets[0]` signs, the rest only verify → appending a new secret keeps signing with the old (possibly leaked) one; dropping the old one logs everyone out. Fix: prepend new secrets.
