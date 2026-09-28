---
name: Method security annotations
description: '@PreAuthorize/@PostAuthorize/@Secured/@RolesAllowed that silently do not protect — missing @EnableMethodSecurity flags, @PostAuthorize after side effects, SpEL parameter names without -parameters and in-memory @PreFilter/@PostFilter (proxy limits: see proxy-annotations).'
priority: 76
tags: [CWE-862, CWE-285, A01:2025]
activation:
  content:
    - '@(?:PreAuthorize|PostAuthorize|PreFilter|PostFilter|Secured|RolesAllowed|EnableMethodSecurity|EnableGlobalMethodSecurity)\b'
  examples:
    - '@PreAuthorize("#id == authentication.name")'
sources:
  - https://docs.spring.io/spring-security/reference/servlet/authorization/method-security.html
  - https://github.com/spring-projects/spring-framework/wiki/Spring-Framework-6.1-Release-Notes
---
- **Not enabled**: `@PreAuthorize`/`@PostAuthorize`/`@PreFilter`/`@PostFilter` are ignored without `@EnableMethodSecurity` (or legacy `@EnableGlobalMethodSecurity(prePostEnabled = true)`); `@Secured`/`@RolesAllowed` also need `securedEnabled`/`jsr250Enabled = true` → silently unprotected methods. Fix: enable the matching flags.
- **@PostAuthorize after side effects**: the method runs before the check → writes, emails or external calls happen even when access is then denied. Fix: `@PreAuthorize`, or read → authorize → write.
- **Parameter names in SpEL**: `@PreAuthorize("#id == authentication.name")` needs parameter names — the `-parameters` flag since Spring 6.1, or `@P`/`@Param` → otherwise `#id` is null and the rule changes meaning. Fix: compiler flag or `@P("id")`.
- **In-memory filtering**: `@PostFilter`/`@PreFilter` load everything and filter afterwards → slow, and unauthorized rows are still fetched and can leak through counts or paging. Fix: filter in the query.
