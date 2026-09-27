---
name: Spring Boot 4 upgrade traps
description: Spring Boot 4 (Spring Framework 7, Jackson 3) changes that fail silently — Jackson 2 mapper beans and customizers not applied, Jackson 3 defaults, javax.annotation/javax.inject ignored, Flyway/Liquibase needing starters, in-memory Spring Batch and renamed properties.
priority: 66
activation:
  content:
    - '\bcom\.fasterxml\.jackson\.databind\b'
    - '\bJackson2ObjectMapperBuilder\w*|\bObjectMapper\b|@JsonComponent\b'
    - '^[ \t]*import[ \t]+javax\.(?:annotation|inject)\.'
    - '\bspring\.(?:data\.mongodb|session\.(?:redis|mongodb)|dao|jackson)\.'
    - '\b(?:flyway-core|liquibase-core|spring-boot-starter-batch)\b'
  versions: { framework.spring: ">=4" }
sources:
  - https://github.com/spring-projects/spring-boot/wiki/Spring-Boot-4.0-Migration-Guide
  - https://github.com/FasterXML/jackson/blob/main/jackson3/MIGRATING_TO_JACKSON_3.md
  - https://github.com/spring-projects/spring-framework/wiki/Spring-Framework-7.0-Release-Notes
---
- **Jackson 2 beans**: Boot 4 auto-configures Jackson 3 (`tools.jackson`); customizing `com.fasterxml.jackson.databind.ObjectMapper`, `Jackson2ObjectMapperBuilderCustomizer` or `@JsonComponent` doesn't affect HTTP (de)serialization → date formats, modules and naming silently lost. Fix: `JsonMapperBuilderCustomizer`, `@JacksonComponent`.
- **Jackson 3 defaults**: enums are read/written via `toString()`, properties sorted alphabetically, `FAIL_ON_NULL_FOR_PRIMITIVES` and `FAIL_ON_TRAILING_TOKENS` enabled → changed API payloads and new 400s. Fix: explicit `@JsonValue`/`@JsonProperty`, or `spring.jackson.use-jackson2-defaults=true` while migrating.
- **javax annotations dropped**: Spring 7 no longer processes `javax.annotation.PostConstruct`/`PreDestroy`/`Resource` or `javax.inject.Inject` → init and cleanup never run, fields stay null. Fix: `jakarta.annotation`/`jakarta.inject`.
- **Migrations not running**: Flyway/Liquibase need `spring-boot-starter-flyway`/`spring-boot-starter-liquibase`; with only `flyway-core`/`liquibase-core` the app starts on an unmigrated schema. Fix: add the starter.
- **Spring Batch in memory**: `spring-boot-starter-batch` no longer keeps job metadata in the database → restarts re-run completed jobs. Fix: `spring-boot-starter-batch-jdbc`.
- **Renamed properties**: `spring.data.mongodb.{host,port,uri,…}` → `spring.mongodb.*`, `spring.session.redis.*` → `spring.session.data.redis.*`, `spring.dao.*` → `spring.persistence.*`; old keys are silently ignored. Fix: rename.
