---
name: Raw queries and injection
description: Sequelize injection paths — interpolated sequelize.query and literal(), replacements combined with where (< 6.19.1), request-chosen attributes (< 6.29.0), JSON-column keys with ::cast (< 6.37.8), ignored invalid where values (< 6.28.1) and QueryTypes misuse.
priority: 70
tags: [CWE-89]
activation:
  content:
    - "\\bsequelize\\.query\\b|\\b(?:Sequelize\\.)?(?:literal|fn|col|cast)\\s*\\("
    - "\\breplacements\\s*:|\\bbind\\s*:|\\bQueryTypes\\.\\w+"
    - "\\b(?:attributes|order|group)\\s*:\\s*(?:req|input|query|body|params)\\b|\\bwhere\\s*:\\s*(?:req|input|query|body|filter)\\b"
    - "\\bwhere\\s*:\\s*\\{[^}\\n]{0,120}:\\s*req\\.(?:body|query)\\b"
sources:
  - https://sequelize.org/docs/v6/core-concepts/raw-queries/
  - https://github.com/advisories/GHSA-wrh9-cjv3-2hpw
  - https://github.com/sequelize/sequelize/security/advisories/GHSA-f598-mfpv-gmfx
  - https://github.com/sequelize/sequelize/security/advisories/GHSA-6457-6jrx-69cr
---
- **Interpolation**: `sequelize.query(\`… ${input}\`)`, `literal(\`… ${x}\`)` or `where(literal(…))` built from input → SQL injection. Fix: `replacements` (`:name`, `?`) or `bind` (`$1`), never template literals.
- **Replacements with where (< 6.19.1)**: combining `replacements` with a model query's `where` let attacker values containing `:name` be substituted into SQL (CVE-2023-25813). Fix: upgrade; use `bind` inside literals.
- **Request-chosen attributes (< 6.29.0)**: attribute names with parentheses were emitted as raw SQL (CVE-2023-22578); even when escaped, `attributes`/`order` from input expose hidden columns. Fix: allowlist against `Model.getAttributes()`.
- **JSON-column keys (< 6.37.8)**: `where: { meta: req.body.filter }` passes user-controlled keys such as `'x::text) or 1=1--'` into CAST expressions (CVE-2026-30951). Fix: upgrade; never use request objects as JSON-column filters.
- **Invalid where ignored (< 6.28.1)**: non-object `where` values (`where: someDate`) were silently dropped → unfiltered queries (CVE-2023-22579). Fix: upgrade; validate filters.
- **Result shape**: `sequelize.query(sql)` without `type: QueryTypes.SELECT` resolves `[results, metadata]` — code treating that pair as rows is wrong. Fix: pass the query type.
