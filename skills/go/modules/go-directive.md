---
name: Raising the go line (language semantics and GODEBUG defaults)
description: What changes when go.mod's go line crosses 1.21–1.27 — loop variables, ServeMux patterns, timers, math/rand seeding, TLS/X.509 and URL parsing defaults, removed GODEBUG settings — and why libraries should not raise it casually.
priority: 62
activation:
  content:
    - '^\s*go\s+1\.\d{1,2}'
    - '^\s*toolchain\s+go1\.'
    - '^\s*godebug\b'
sources:
  - https://go.dev/doc/godebug
  - https://go.dev/ref/mod#go-mod-file-go
  - https://go.dev/doc/go1.23
  - https://go.dev/doc/go1.27
---
- **Silent semantic switch**: the `go` line sets language semantics per module and GODEBUG defaults for the main module → bumping it changes behaviour with no code diff; review code for each version crossed.
- **1.21–1.22**: `panic(nil)` becomes a `*runtime.PanicNilError` (recover now sees it); loops get per-iteration variables (code relying on one shared `&v` changes); ServeMux method/wildcard patterns activate; TLS servers drop 1.0/1.1 and RSA key exchange.
- **1.23**: timer channels become unbuffered and unstopped timers collectable (`len(t.C)` is 0, drain idioms change); `x509negativeserial` rejects some certificates.
- **1.24**: `math/rand.Seed` becomes a no-op (`randseednop`) → seeded reproducible sequences change; RSA keys under 1024 bits are rejected.
- **1.25–1.27**: default GOMAXPROCS follows container CPU limits (1.25); `url.Parse` rejects colons in hosts and crypto ignores custom rand readers (1.26); `asynctimerchan`, `tls10server`, `tlsrsakex`, `tls3des`, `x509keypairleaf` are removed (1.27) — `godebug` lines setting old values fail the build.
- **Libraries**: raising a library's `go` line forces every consumer to that version (a module's line must be ≥ its dependencies'); `toolchain` and `godebug` apply only in the main module. Fix: libraries stay on the lowest version they need.
