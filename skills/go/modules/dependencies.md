---
name: go.mod requirements, replace directives and known-bad modules
description: replace/exclude ignored outside the main module, committed local replaces and go.work files, mixed major versions of one library, and modules with known vulnerabilities or no maintenance.
priority: 58
tags: [CWE-1104, CWE-1395]
activation:
  content:
    - '^\s*(?:replace|exclude|retract)\b'
    - '^\s*(?:require\b|use\b)'
    - '^\s*[\w.-]{1,60}\.[a-z]{2,6}/[\w./-]{1,120}\s+v\d'
  examples:
    - 'replace github.com/pkg/errors => github.com/pkg/errors v0.9.1'
    - 'require github.com/gin-gonic/gin v1.9.1'
    - 'github.com/pkg/errors v0.9.1'
sources:
  - https://go.dev/ref/mod#go-mod-file-replace
  - https://go.dev/ref/mod#major-version-suffixes
  - https://github.com/advisories/GHSA-mh63-6h87-95cp
  - https://github.com/jackc/pgx/blob/master/CHANGELOG.md
---
- **replace in libraries**: `replace`/`exclude` apply only in the main module → a library pinning a patched fork or excluding a vulnerable version protects nobody downstream. Fix: require the fixed version or publish the fork under its own path.
- **Local paths committed**: `replace x => ../x` or absolute paths, or a committed `go.work` with local `use` entries, break CI and other machines or silently override modules. Fix: keep local overrides out of commits.
- **Two majors of one library**: `/v4` and `/v5` of one module (jwt, pgx, echo) linked together have separate types and sentinels → `errors.Is` and type assertions fail across them; `+incompatible` versions may jump majors. Fix: converge on one major.
- **Known-bad modules**: `github.com/dgrijalva/jwt-go` (CVE-2020-26160), `github.com/satori/go.uuid` (CVE-2021-3538 weak UUIDs), golang-jwt v4 < 4.5.2 / v5 < 5.2.2, pgx v5 < 5.9.2, chi < 5.2.4, archived `gopkg.in/yaml.v3` (successor `go.yaml.in/yaml/v3`). Fix: upgrade; run `govulncheck`.
