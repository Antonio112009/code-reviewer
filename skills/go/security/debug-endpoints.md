---
name: pprof, expvar and DefaultServeMux exposure
description: net/http/pprof and expvar side-effect imports registering on DefaultServeMux, public servers using a nil handler, and static file servers exposing the working directory or dotfiles.
priority: 74
tags: [CWE-200, CWE-489, CWE-538]
activation:
  content:
    - 'net/http/pprof'
    - '"expvar"|\bexpvar\.'
    - 'golang\.org/x/net/trace'
    - '\bhttp\.(?:DefaultServeMux|ListenAndServe(?:TLS)?)\b'
    - '\bhttp\.(?:FileServer|FileServerFS|Dir)\('
sources:
  - https://pkg.go.dev/net/http/pprof
  - https://pkg.go.dev/expvar
  - https://go.dev/doc/go1.27
---
- **pprof side effect**: `import _ "net/http/pprof"` registers `/debug/pprof/*` on `http.DefaultServeMux`; public servers using it (`ListenAndServe(addr, nil)`) expose heap dumps with secrets, CPU profiles (DoS), `cmdline` and Go 1.27's `goroutineleak`. Fix: separate admin port.
- **expvar**: importing `expvar` (directly or via a library) publishes `/debug/vars` on DefaultServeMux including `cmdline` → command-line flags with passwords or tokens leak. Fix: isolate like pprof.
- **Transitive registrations**: metrics, tracing and `golang.org/x/net/trace` packages also register on DefaultServeMux → every nil-handler server exposes them. Fix: never pass a nil handler to internet-facing servers.
- **Serving the working directory**: `http.FileServer(http.Dir("."))` or a project/home directory exposes `.git`, `.env`, configs and source, with directory listings on by default. Fix: a dedicated public directory or `embed.FS` via `http.FileServerFS`; disable listings.
