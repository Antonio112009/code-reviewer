---
name: Quarkus ArC dependency injection
description: ArC (build-time CDI) surprises — unused beans removed despite programmatic lookups, classes without bean-defining annotations, @Singleton vs @ApplicationScoped proxies and mocking, private members, lazy startup and self-interception unlike Spring.
priority: 60
activation:
  content:
    - '@(?:ApplicationScoped|Singleton|RequestScoped|Dependent|Startup|Unremovable|Produces|InjectMock)\b'
    - '\bCDI\.current\(\)|\bArc\.container\(\)|\bInstance<'
    - '@Inject\b'
    - '\bquarkus\.arc\.'
sources:
  - https://quarkus.io/guides/cdi-reference
  - https://quarkus.io/guides/cdi
---
- **Removed "unused" beans**: `quarkus.arc.remove-unused-beans` (default `all`) drops beans that are only looked up programmatically (`CDI.current().select`, `Arc.container()`, reflection) → unsatisfied lookups at runtime. Fix: `@Unremovable` or inject them.
- **Not a bean**: classes without a bean-defining annotation (scope or stereotype) aren't discovered, and objects created with `new` never get `@Inject` fields. Fix: add a scope; never instantiate beans manually.
- **@Singleton vs @ApplicationScoped**: `@Singleton` has no client proxy — it is created at injection time and can't be replaced with `@InjectMock`; `@ApplicationScoped` is proxied and lazy. Fix: prefer `@ApplicationScoped` for mockable services.
- **Private members**: private injection fields, constructors, observers or producers force reflection (native-image cost); interceptor bindings such as `@Transactional` on private methods fail the build by default. Fix: package-private members.
- **Lazy startup**: `@ApplicationScoped` beans are created on first method call → constructor/`@PostConstruct` work (warm-up, schedulers, validation) doesn't run at boot. Fix: `@Startup` or `@Observes StartupEvent`.
- **Self-invocation is intercepted**: unlike Spring AOP, ArC applies interceptors to a bean's calls to its own intercepted methods (non-standard). Fix: don't port Spring self-injection workarounds or assume internal calls skip `@Transactional`.
