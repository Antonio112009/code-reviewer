---
name: Spring Boot 3 and Jakarta EE upgrade traps
description: Spring Boot 3 (Spring Framework 6) changes that fail silently — javax.* EE annotations and servlet components ignored, trailing-slash URLs no longer matching, renamed properties and auto-configurations registered only in spring.factories.
priority: 66
activation:
  content:
    - '^[ \t]*import[ \t]+javax\.(?:persistence|validation|servlet|transaction|inject|annotation|ws\.rs|jms|mail|xml\.bind|websocket)\.'
    - '\bspring\.(?:redis|data\.cassandra)\.'
    - '\bmax-http-header-size\b'
    - 'EnableAutoConfiguration='
    - '\bsetUseTrailingSlashMatch\('
  versions: { framework.spring: ">=3" }
sources:
  - https://github.com/spring-projects/spring-boot/wiki/Spring-Boot-3.0-Migration-Guide
  - https://github.com/spring-projects/spring-framework/wiki/Upgrading-to-Spring-Framework-6.x
---
- **javax validation/persistence**: `javax.validation.constraints.*` and `javax.persistence.*` still compile when an old API jar is on the classpath, but Hibernate Validator 8 and Hibernate 6 read only `jakarta.*` → constraints and mappings silently ignored. Fix: `jakarta.*` imports; remove the javax jars.
- **javax servlet components**: `javax.servlet.Filter`s, listeners and `@WebServlet`s aren't registered by Servlet 6 containers → security or logging filters silently absent. Fix: `jakarta.servlet`.
- **What stays javax**: `javax.sql`, `javax.crypto`, `javax.net`, `javax.naming` are JDK APIs and stay; `javax.annotation.PostConstruct` works on Spring 6 only if the javax jar is present (ignored by Spring 7). Fix: `jakarta.annotation`.
- **Trailing slash**: Spring MVC/WebFlux 6 no longer match `/users/` to `/users` → 404 for clients using the slash; `setUseTrailingSlashMatch(true)` is deprecated and removed in 7. Fix: declare both paths or redirect.
- **Renamed properties**: `spring.redis.*` → `spring.data.redis.*`, `spring.data.cassandra.*` → `spring.cassandra.*`, `server.max-http-header-size` → `server.max-http-request-header-size`; old keys are silently ignored. Fix: rename.
- **Auto-configuration registration**: `EnableAutoConfiguration=` entries in `META-INF/spring.factories` are no longer read → custom starters silently don't load. Fix: `META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports`.
