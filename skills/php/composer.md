---
name: Composer manifest
description: composer.json changes that break production or weaken supply-chain protection — config.platform mismatches, require-dev/autoload-dev code used at runtime, allow-plugins, disabled advisory/malware policy, insecure repositories and unbounded constraints.
priority: 58
tags: [CWE-1104, CWE-829, OWASP-A03]
activation:
  files: ["**/composer.json"]
sources:
  - https://getcomposer.org/doc/06-config.md
  - https://getcomposer.org/doc/04-schema.md
  - https://getcomposer.org/doc/articles/versions.md
---
- **Platform mismatch**: `config.platform.php` (or `ext-*`) set higher than production PHP resolves packages that crash at runtime; set lower pins old versions. Fix: match production, run `composer check-platform-reqs` in deploys.
- **Dev dependencies at runtime**: classes from `require-dev` packages or `autoload-dev` paths (Faker, test helpers, debug bars) referenced by application code → "Class not found" after `composer install --no-dev`. Fix: move to `require`/`autoload`.
- **allow-plugins**: `"allow-plugins": true` or broad vendor wildcards let any installed plugin run code during install/update → supply-chain RCE on developer machines and CI. Fix: list trusted plugins explicitly.
- **Advisory and malware policy**: `"policy": false`, `policy.advisories.block: false`, broad `ignore-severity`/`ignore-id` entries, or the legacy `audit.block-insecure: false` let known-vulnerable or malware-flagged versions install. Fix: ignore single advisories with a reason and expiry.
- **Insecure sources**: `"secure-http": false`, `http://` repositories or `vcs`/`path` repositories pointing at forks → tampered or unreviewed code. Fix: HTTPS, pinned tags or commits.
- **Unbounded constraints**: `*`, `>=`, `dev-main` or `minimum-stability: dev` without `prefer-stable` → `composer update` pulls breaking majors or unstable code. Fix: caret constraints and a committed, updated `composer.lock`.
