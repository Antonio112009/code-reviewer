---
name: File paths, os.Root and archive extraction
description: Path traversal from request-derived names through filepath.Join and prefix checks, symlink races, zip-slip in archive/zip and archive/tar, and ServeFile with user-supplied names.
priority: 78
tags: [CWE-22, CWE-59, CWE-367]
activation:
  content:
    - '\bfilepath\.(?:Join|Clean|Abs|Rel|EvalSymlinks|IsLocal|Localize)\b'
    - '\bos\.(?:Open|OpenFile|Create|ReadFile|WriteFile|Remove\w{0,3}|Mkdir\w{0,3}|OpenRoot|OpenInRoot|Symlink|Link|Rename)\b'
    - '"archive/(?:zip|tar)"'
    - '\b(?:zip\.(?:NewReader|OpenReader)|tar\.NewReader)\b'
    - '\bhttp\.(?:ServeFile|ServeFileFS)\b'
sources:
  - https://go.dev/blog/osroot
  - https://pkg.go.dev/os#Root
  - https://pkg.go.dev/path/filepath#IsLocal
  - https://go.dev/doc/godebug
---
- **Join is not a jail**: `filepath.Join(base, name)`/`filepath.Clean` with request-derived names (route params, form fields, headers) resolve `..` and absolute parts → escape `base`; `strings.HasPrefix(p, base)` also accepts `/data/app2` and ignores symlinks. Fix: `os.OpenInRoot`/`os.OpenRoot` (Go 1.24+) or `filepath.IsLocal` (1.20+).
- **Symlink races**: check-then-open (`Stat`/`EvalSymlinks`, then `Open`) or writing into user-writable directories → a swapped symlink redirects the write. Fix: `os.Root` (openat-based on Unix).
- **Zip slip**: archive/zip and archive/tar don't reject `..`, absolute names or link entries by default (`zipinsecurepath`/`tarinsecurepath` still default to 1 in Go 1.27) → extraction writes outside the target. Fix: extract through `os.Root`, skip non-regular entries, check `filepath.IsLocal(name)`.
- **ServeFile with a name**: `http.ServeFile(w, r, dir+"/"+name)` rejects `..` only in `r.URL.Path`, not in the name argument → arbitrary file read. Fix: `http.ServeFileFS(w, r, os.DirFS(dir), name)` or `os.Root.FS()`.
