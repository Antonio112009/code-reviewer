---
name: Proxy-based annotations silently not applied
description: Spring AOP proxy limits that silently disable @Transactional, @Async, @Cacheable, @Retryable and method security — self-invocation, private/final methods, Kotlin final classes, non-bean objects, lifecycle callbacks and missing @Enable* switches.
priority: 70
tags: [CWE-670]
activation:
  content:
    - '@(?:Transactional|Async|Cacheable|CacheEvict|CachePut|Caching|Retryable|ConcurrencyLimit|PreAuthorize|PostAuthorize|PreFilter|PostFilter|Secured|RolesAllowed|Validated)\b'
    - '@Enable(?:Async|Caching|Scheduling|MethodSecurity|GlobalMethodSecurity|Retry|ResilientMethods|TransactionManagement)\b'
  examples:
    - '@Transactional'
    - '@EnableAsync'
sources:
  - https://docs.spring.io/spring-framework/reference/core/aop/proxying.html
  - https://docs.spring.io/spring-framework/reference/data-access/transaction/declarative/annotations.html
  - https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/scheduling/annotation/EnableAsync.html
---
- **Self-invocation**: calling an annotated method from the same bean (`this.save()` or plain `save()`) bypasses the proxy → no transaction, async execution, caching, retry or security check. Fix: move it to another bean, self-inject, or AspectJ mode.
- **Non-proxyable methods**: `private` methods are never advised; `final` methods — and every method of a Kotlin class without the `kotlin-spring` (all-open) plugin — are silently skipped. JDK interface proxies advise interface methods only. Fix: public, non-final methods.
- **Not a Spring bean**: annotations on objects created with `new`, on static methods or on entities/DTOs are never intercepted. Fix: get the object from the context.
- **Lifecycle callbacks**: `@Transactional`/`@Async` on `@PostConstruct` methods or constructor logic run outside the proxy → no transaction, synchronous execution. Fix: an `ApplicationReadyEvent` listener calling a proxied bean.
- **Missing enable switch**: without `@EnableAsync`, `@EnableScheduling`, `@EnableCaching`, `@EnableMethodSecurity`, `@EnableRetry` (Spring Retry) or `@EnableResilientMethods` (Spring 7 `@Retryable`) the annotations are silently ignored. Fix: enable them once.
