---
name: Sessions and cookies
description: express-session, cookie-session and cookie-parser pitfalls — MemoryStore in production, secure cookies behind TLS proxies, session fixation and incomplete logout, client-side sessions, unsigned cookies and res.cookie units.
priority: 62
tags: [CWE-384, CWE-565, CWE-614, CWE-613]
activation:
  content:
    - "\\b(?:express-session|cookie-session|cookie-parser)\\b|\\bsession\\s*\\(\\s*\\{|\\bcookieParser\\s*\\("
    - "\\breq\\.(?:session|signedCookies|cookies)\\b"
    - "\\bres\\.(?:cookie|clearCookie)\\s*\\("
  examples:
    - 'app.use(session({ secret: ''keyboard cat'', resave: false, saveUninitialized: false }));'
    - 'req.session.userId = user.id;'
    - 'res.clearCookie(''sid'', { path: ''/'' });'
sources:
  - https://github.com/expressjs/session
  - https://expressjs.com/en/advanced/best-practice-security.html
  - https://expressjs.com/en/5x/api/response/
---
- **MemoryStore**: `session({ … })` without `store` uses MemoryStore — it leaks memory, loses sessions on restart and isn't shared across instances (random logouts behind a load balancer). Fix: Redis or DB store.
- **Secure cookie behind a proxy**: `cookie.secure: true` with TLS terminated upstream and no `trust proxy` → the cookie is never sent (login "works", the next request is anonymous); `secure: false` in production leaks it over HTTP.
- **Fixation and logout**: setting `req.session.userId` without `req.session.regenerate()` keeps a session id an attacker may know; logout without `destroy()` + `clearCookie` leaves a valid session.
- **Client-side sessions**: `cookie-session` keeps the whole session in a signed, readable cookie — no secrets or PII, no server-side revocation (replay after logout), and a leaked or hard-coded `keys` value lets anyone forge `{ userId }`.
- **Unsigned cookies**: authorising from `req.cookies.role`/`userId` trusts client-edited values; signed values appear in `req.signedCookies` only with `cookieParser(secret)` and `res.cookie(…, { signed: true })`.
- **Units and clearing**: `res.cookie` `maxAge` is in milliseconds (`maxAge: 3600` ≈ 3.6 s); `res.clearCookie` must repeat the original `path`/`domain`, or the cookie survives logout.
- **resave / saveUninitialized**: `resave: true` lets parallel requests overwrite each other's session changes; `saveUninitialized: true` stores a session and cookie for every anonymous hit. Fix: both `false` with a `touch`-capable store.
