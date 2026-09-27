---
name: Build-time configuration and native images
description: Quarkus build-time vs runtime traps — build-time fixed properties changed only at runtime, classes initialized at build time capturing seeds and environment, static-init config injection, and native-image reflection, resource and proxy registration.
priority: 60
tags: [CWE-330, CWE-1188]
activation:
  content:
    - '@(?:RegisterForReflection|RegisterForProxy|StaticInitSafe|ConfigProperty|ConfigMapping)\b'
    - '\b(?:Class\.forName|getResourceAsStream|getResource|Proxy\.newProxyInstance)\('
    - '\bstatic\s+(?:final\s+)?(?:Random|SecureRandom|SplittableRandom|UUID)\b'
    - '\bstatic\s*\{|\bSystem\.getenv\('
    - '\bquarkus\.native\.'
sources:
  - https://quarkus.io/guides/writing-native-applications-tips
  - https://quarkus.io/guides/config-reference
---
- **Build-time fixed properties**: properties fixed at build time (lock icon in the docs, e.g., `quarkus.datasource.db-kind`, many `quarkus.hibernate-orm.*` settings) are ignored when set only through runtime env vars or ConfigMaps. Fix: set them at build time and rebuild.
- **Build-time initialization (native)**: Quarkus initializes classes at build time → `static final Random`/`SecureRandom` seeds and `System.getenv` or clock values in static initializers are frozen into the binary (same "random" values in every pod). Fix: runtime init in CDI beans.
- **Config in static init**: config injected during static initialization is compared with runtime values and startup fails on mismatch unless `@StaticInitSafe`. Fix: read config at runtime.
- **Reflection**: classes used only reflectively (Jackson types not returned by REST endpoints, `Class.forName`, reflective mappers) are removed from native images → failures only in native builds. Fix: `@RegisterForReflection`.
- **Resources and proxies**: files read via `getResourceAsStream` aren't in the native image unless listed in `quarkus.native.resources.includes`; `Proxy.newProxyInstance` interfaces need `@RegisterForProxy`. Fix: register them.
