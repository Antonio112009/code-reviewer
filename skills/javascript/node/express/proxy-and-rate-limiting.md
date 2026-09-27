---
name: Trust proxy, client IPs and rate limiting
description: Express behind load balancers and CDNs — trust proxy values, spoofable req.ip/hostname/protocol, raw X-Forwarded-For parsing, express-rate-limit stores and IPv6 keys, and guards that miss routes due to order, mount paths or case-insensitive routing.
priority: 62
tags: [CWE-348, CWE-307, CWE-863]
activation:
  content:
    - "['\"]trust proxy['\"]"
    - "\\breq\\.(?:ip|ips|hostname|protocol|secure)\\b"
    - "[xX]-(?:[fF]orwarded-(?:[fF]or|[hH]ost|[pP]roto)|[rR]eal-[iI][pP])"
    - "\\bexpress-rate-limit\\b|\\brate-limiter-flexible\\b|\\b(?:rateLimit|slowDown)\\s*\\(|\\bkeyGenerator\\s*:"
    - "\\breq\\.(?:path|originalUrl|url)\\.(?:startsWith|includes|match|endsWith)\\s*\\(|\\breq\\.path\\s*[!=]=="
    - "\\b(?:app|router)\\.use\\s*\\(\\s*['\"][^'\"\\n]{1,80}['\"]\\s*,"
sources:
  - https://expressjs.com/en/guide/behind-proxies.html
  - https://express-rate-limit.mintlify.app/reference/error-codes
  - https://expressjs.com/en/5x/api/application/
---
- **trust proxy: true**: trusts every hop, so `req.ip` is the leftmost, client-supplied X-Forwarded-For entry — rate limits, IP allowlists and audit logs become spoofable. Fix: the real hop count or proxy CIDRs.
- **Unset behind a proxy**: the default `false` makes `req.ip` the load balancer (one shared rate-limit bucket) and `req.protocol` `http` (wrong absolute URLs, secure cookies dropped). Fix: configure `trust proxy`.
- **Raw header parsing**: `req.headers['x-forwarded-for'].split(',')[0]` or `x-real-ip` read attacker-controlled values whatever `trust proxy` says. Fix: `req.ip` with a correct setting.
- **Host header links**: `req.hostname`/`req.get('host')` (X-Forwarded-Host when trusted) in password-reset or e-mail links enables host-header poisoning. Fix: a configured public base URL.
- **Limiter keys and stores**: the default store is per-process memory (limits multiply per instance, reset on deploy); express-rate-limit v8 flags `keyGenerator: (req) => req.ip` (`ERR_ERL_KEY_GEN_IPV6`) because IPv6 clients rotate addresses — use `ipKeyGenerator`.
- **Order and mount paths**: auth or limiter middleware registered after the routes (`app.get` before `app.use(auth)`), or mounted on `/login` while the route is `/api/login`, never runs for them. Fix: guard the router or route itself.
- **String path checks**: routing is case-insensitive and ignores trailing slashes by default, so `/ADMIN/` reaches `/admin` while `req.path.startsWith('/admin')` misses it; inside mounted routers `req.url` lacks the mount path.
