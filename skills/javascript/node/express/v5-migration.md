---
name: Express 5 behaviour changes
description: Express 5 changes that break code silently — path-to-regexp 8 route syntax and array wildcards, simple read-only req.query, undefined req.body, removed signatures, strict res.status, req.host with port, app.listen errors and dotfiles.
priority: 66
activation:
  versions: { framework.express: ">=5" }
  content:
    - "\\.(?:get|post|put|patch|delete|all|use|route)\\s*\\(\\s*['\"][^'\"\\n]{0,120}[*?+()]"
    - "\\breq\\.params\\s*\\[\\s*\\d|\\breq\\.params\\.splat\\b"
    - "\\breq\\.query\\.\\w+\\.\\w+|\\breq\\.query(?:\\.\\w+)?\\s*=(?!=)"
    - "(?:const|let|var)\\s*\\{[^}\\n]{0,160}\\}\\s*=\\s*req\\.body\\b|\\bObject\\.(?:keys|entries|values)\\s*\\(\\s*req\\.body\\s*\\)"
    - "\\bres\\.(?:json|jsonp|send|redirect)\\s*\\([^()\\n]{1,120},\\s*\\d{3}\\s*\\)|\\bres\\.send\\s*\\(\\s*\\d{3}\\s*\\)|\\bres\\.redirect\\s*\\(\\s*['\"]back['\"]"
    - "\\bres\\.status\\s*\\(\\s*(?:err|error|e)\\b|\\breq\\.host\\b|\\bapp\\.listen\\s*\\(|\\bexpress\\.(?:urlencoded|static)\\s*\\(|\\b(?:res\\.sendfile|req\\.param|app\\.del)\\s*\\("
    - "\\b(?:mongoSanitize|hpp|xss)\\s*\\(\\s*\\)"
sources:
  - https://expressjs.com/en/guide/migrating-5.html
  - https://expressjs.com/en/5x/api/application/
  - https://expressjs.com/en/5x/api/express/
---
- **Route syntax**: path-to-regexp 8 throws at startup on bare `*`, `?` and regex groups (`:id(\\d+)`); wildcards need names (`/*splat` misses `/`, `/{*splat}` matches it), optionals use braces (`/:file{.:ext}`).
- **Wildcard values**: `req.params.splat` is an array of segments and `req.params[0]` is gone → string ops and `path.join` break. Fix: `splat.join('/')`.
- **Query parser**: default is now `simple` — `?a[b]=1` stays the flat key `'a[b]'`; `req.query` is a getter, so middleware rewriting it (`express-mongo-sanitize`, `hpp`) throws or is lost. Fix: set `'extended'` explicitly.
- **Body may be undefined**: with no matching parser `req.body` is `undefined` — `const { a } = req.body` throws; `express.urlencoded()` defaults to `extended: false`.
- **Removed signatures**: `res.json(obj, 201)`, `res.send(201)`, `res.redirect(url, 301)`, `res.redirect('back')`, `req.param()` throw or silently send the wrong status/body. Fix: `res.status(201).json()`, `res.redirect(301, url)`.
- **Strict res.status**: anything but an integer 100–999 (e.g. `err.code`) throws, often inside error middleware.
- **Host, listen, dotfiles**: `req.host` includes the port (use `req.hostname`); `app.listen` hands `EADDRINUSE` to its callback instead of throwing; `express.static` ignores dot-directories (`/.well-known` needs `dotfiles: 'allow'`).
