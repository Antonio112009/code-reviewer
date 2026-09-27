---
name: Spring Boot configuration properties
description: Configuration defects in application*.properties/yml and @ConfigurationProperties/@Value — unvalidated properties, silently ignored unknown keys, @Value relaxed-binding mismatches, pre-2.4 profile syntax, empty secret defaults and production-unsafe JPA and error settings.
priority: 60
tags: [CWE-209, CWE-1188]
activation:
  files:
    - "**/application*.{properties,yml,yaml}"
    - "**/bootstrap*.{properties,yml,yaml}"
  content:
    - '@(?:ConfigurationProperties|EnableConfigurationProperties|ConfigurationPropertiesScan)\b'
    - '@Value\(\s*"\$\{'
sources:
  - https://docs.spring.io/spring-boot/reference/features/external-config.html
  - https://docs.spring.io/spring-boot/reference/data/sql.html
  - https://github.com/spring-projects/spring-boot/wiki/Spring-Boot-2.4-Release-Notes
---
- **Unvalidated @ConfigurationProperties**: constraint annotations are ignored unless the class is `@Validated`, and nested objects also need `@Valid` → the app starts with missing or invalid settings. Fix: add both.
- **Unknown keys ignored**: misspelled or renamed properties are silently ignored → timeouts, pool sizes or security settings never applied. Fix: typed `@ConfigurationProperties`; run `spring-boot-properties-migrator` during upgrades.
- **@Value names**: `@Value("${app.itemPrice}")` doesn't get relaxed binding → `APP_ITEMPRICE` or `app.item-price` isn't picked up. Fix: canonical kebab-case (`${app.item-price}`).
- **Profile syntax**: `spring.profiles` inside multi-document files (deprecated in 2.4), or `spring.profiles.active/include` in profile-specific documents (invalid since 2.4) → sections applied to the wrong profiles or startup failures. Fix: `spring.config.activate.on-profile`.
- **Empty secret defaults**: `${DB_PASSWORD:}` or `@Value("${api.key:}")` lets the app start with blank credentials or disabled checks. Fix: no default for required secrets; fail fast.
- **Production-unsafe settings**: `spring.jpa.hibernate.ddl-auto=update|create|create-drop` (unreviewed DDL, dropped data), `spring.jpa.open-in-view` left `true` (connection held per request), `show-sql=true`, `server.error.include-stacktrace|include-message=always` outside dev. Fix: profile-specific values.
