---
name: ServeMux routing patterns (Go 1.22+)
description: Method and wildcard patterns under older go lines, subtree patterns exposing handlers, unescaped PathValue values, method-less patterns, trailing-slash redirects and more specific routes skipping protection.
priority: 62
tags: [CWE-22, CWE-284]
activation:
  content:
    - '\bHandle(?:Func)?\(\s*"(?:[A-Z]{3,7}\s+)?[^"\n]{0,80}[{}]'
    - '"(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+/'
    - '\bPathValue\('
    - '\bhttp\.(?:NewServeMux|Handle|HandleFunc|StripPrefix)\b'
sources:
  - https://go.dev/doc/go1.22
  - https://go.dev/blog/routing-enhancements
  - https://github.com/golang/go/issues/61410
  - https://go.dev/doc/go1.26
---
- **Old go line**: method/wildcard patterns (`"GET /items/{id}"`) only work when go.mod declares `go 1.22`+; with an older line (or `GODEBUG=httpmuxgo121=1`) they are literal paths → every such route 404s and `PathValue` is empty. Fix: raise the go line.
- **Subtree patterns**: a pattern ending in `/` (`"/admin/"`, `"GET /files/"`) matches every path below it → handlers answer URLs never meant to exist. Fix: `{$}` for exact matches (`"/admin/{$}"`).
- **Unescaped wildcards**: `PathValue` returns unescaped values — `/files/..%2F..%2Fetc%2Fpasswd` gives `{name}` = `../../etc/passwd` (the mux only cleans literal `..` segments) → traversal when used in paths. Fix: `filepath.IsLocal` or `os.OpenInRoot`.
- **Method-less patterns**: patterns without a method accept every method (GET too) → state-changing handlers reachable cross-site; `GET` patterns also serve `HEAD`. Fix: `"POST /…"` for mutations.
- **Uncovered sub-routes**: `mux.Handle("/admin/", auth(admin))` plus a later `mux.Handle("/admin/export", export)` → the more specific pattern wins and skips the wrapper. Fix: wrap the whole mux or every route.
- **Trailing-slash redirect**: `/dir` → `/dir/` redirects were 301 before Go 1.26 (307 since) → clients replay POST as GET without the body. Fix: register the exact path.
