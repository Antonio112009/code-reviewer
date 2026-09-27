---
name: Responses, redirects, files and views
description: Express response APIs that turn input into vulnerabilities or double responses — res.send HTML strings, missing returns, open redirects, sendFile/download paths, express.static roots and dotfiles, and res.render view names or locals.
priority: 64
tags: [CWE-79, CWE-601, CWE-22, CWE-94]
activation:
  content:
    - "\\bres\\.(?:send|redirect|location|sendFile|sendfile|download|render|attachment)\\s*\\("
    - "\\bexpress\\.static\\s*\\(|\\bserve-static\\b|\\bserveStatic\\s*\\("
    - "\\bres\\.status\\s*\\(\\s*4\\d\\d\\s*\\)|\\bres\\.sendStatus\\s*\\(\\s*4\\d\\d\\s*\\)"
sources:
  - https://expressjs.com/en/5x/api/response/
  - https://expressjs.com/en/4x/api/express/
  - https://expressjs.com/en/advanced/best-practice-security.html
  - https://expressjs.com/en/advanced/security-updates.html
---
- **HTML by default**: `res.send(string)` answers `Content-Type: text/html` — echoing input (`res.send(\`Unknown ${req.query.q}\`)`, error text) is reflected XSS. Fix: `res.json()`, `res.type('text/plain')` or escaping.
- **Missing return**: `res.status(403).json(…)` or `res.redirect()` without `return` keeps executing — guarded code runs after an auth failure and the next `res.*` throws `ERR_HTTP_HEADERS_SENT`. Fix: `return res…`.
- **Open redirect**: `res.redirect(req.query.next)`/`res.location()` send the URL unvalidated (only encoded); absolute URLs, `//evil.com` and `/\evil.com` leave the site (redirect CVEs fixed by 4.20.0). Fix: allowlist origins via `new URL(next, base)`.
- **sendFile paths**: `res.sendFile(path.join(dir, req.params.name))` — `join` resolves `..` first, so traversal passes; `res.download` behaves the same. Fix: `res.sendFile(name, { root: dir, dotfiles: 'deny' })` — Express rejects paths escaping `root`.
- **Static roots**: `express.static(__dirname)`, `process.cwd()` or the repo root serves source, configs and backups; Express 4's default `dotfiles` still serves files inside dot-directories (`/.git/config`). Fix: a dedicated `public/` directory.
- **Views**: `res.render(req.query.view)` or `res.render(view, req.body)` — view names hit the filesystem and locals double as engine options (EJS `settings`/`outputFunctionName`, hbs `layout`) → file read or RCE. Fix: fixed view names, explicit locals.
