---
name: Body parsing and input shapes
description: express.json/urlencoded/raw setup and the shapes req.body/req.query can take — parser order and content types, qs arrays and objects, raw bodies for webhook signatures, app-wide size limits and multer upload limits.
priority: 62
tags: [CWE-20, CWE-400, CWE-434]
activation:
  content:
    - "\\bexpress\\.(?:json|urlencoded|raw|text)\\s*\\(|\\bbody-?[pP]arser\\b"
    - "\\breq\\.(?:query|body|params)\\.\\w+\\s*(?:===|!==|\\.(?:trim|toLowerCase|toUpperCase|split|replace|startsWith|endsWith|includes|length)\\b)"
    - "\\bconstructEvent\\s*\\(|[xX]-[hH]ub-[sS]ignature|[sS]tripe-[sS]ignature|\\bverify\\s*:\\s*\\(|\\brawBody\\b"
    - "\\bmulter\\s*\\(|\\bupload\\.(?:single|array|fields|any|none)\\s*\\(|\\b(?:file|files)\\.originalname\\b|\\breq\\.files?\\b"
  examples:
    - 'app.use(express.json());'
    - 'if (req.query.id.trim() === '''') {'
    - 'const event = stripe.webhooks.constructEvent(req.body, sig, secret);'
    - 'app.post(''/upload'', upload.single(''file''), handler);'
sources:
  - https://expressjs.com/en/5x/api/express/
  - https://expressjs.com/en/guide/migrating-5.html
  - https://github.com/expressjs/multer
---
- **Parser placement**: `express.json()` mounted after the routes it serves or only on another router, or clients sending `application/vnd.api+json`/`text/plain` while `type` stays `application/json` → `req.body` empty or undefined. Fix: mount first; set `type`.
- **Type confusion**: repeated keys (`?id=1&id=2`) become arrays and extended qs/JSON bodies yield objects, numbers or booleans → `.trim()` TypeErrors (500s), misfiring `===`/`includes` checks, `{ "$ne": null }` in NoSQL filters. Fix: schema-validate to primitives.
- **Webhook signatures**: a global `express.json()` ahead of a Stripe/GitHub/Slack webhook route consumes the raw bytes; verifying `JSON.stringify(req.body)` instead fails (and checks get disabled). Fix: `express.raw({ type: 'application/json' })` on that route first, or keep bytes via `verify`.
- **App-wide limits**: the default `limit` is 100kb; raising it globally (`'50mb'`) for one upload route exposes every JSON endpoint to memory/CPU exhaustion. Fix: large limits only on the route that needs them.
- **multer limits**: `multer()` without `limits` accepts unlimited file sizes and counts, `memoryStorage` buffers whole files in RAM, and `upload.any()` takes files on every field. Fix: `limits: { fileSize, files }`, named fields.
- **Client file metadata**: `file.originalname`/`file.mimetype` come from the client — as disk paths or type checks they allow traversal, overwrites and spoofed types. Fix: generated names, fixed directory, magic-byte sniffing.
