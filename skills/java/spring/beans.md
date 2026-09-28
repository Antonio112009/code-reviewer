---
name: Bean scopes and injection
description: Spring bean lifecycle defects — request data in singleton fields, prototype beans injected once, static @Value/@Autowired fields, injected fields read in constructors, lite-mode @Bean calls creating duplicates, unproxied scoped beans and prototype cleanup.
priority: 60
tags: [CWE-362, CWE-488]
activation:
  content:
    - '@(?:Service|Component|Controller|RestController|Repository|Configuration|Bean|Scope|Lookup|RequestScope|SessionScope)\b'
    - '@(?:Value|Autowired|Inject)\b'
    - '\bObjectProvider<'
  examples:
    - '@Service'
    - '@Autowired private UserRepository repository;'
    - 'private final ObjectProvider<Client> clientProvider;'
sources:
  - https://docs.spring.io/spring-framework/reference/core/beans/factory-scopes.html
  - https://docs.spring.io/spring-framework/reference/core/beans/java/basic-concepts.html
  - https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/beans/factory/annotation/AutowiredAnnotationBeanPostProcessor.html
---
- **State in singletons**: `@Service`/`@Controller`/`@Component` beans are shared singletons; storing the current user, request, tenant or intermediate results in instance fields → cross-request data leaks and races. Fix: locals, method parameters or request-scoped beans.
- **Prototype injected once**: a `@Scope("prototype")` bean injected into a singleton is created only once → shared "prototype" state. Fix: `ObjectProvider<T>.getObject()` or `@Lookup` per use.
- **Static injection**: `@Autowired`/`@Value` on `static` fields are not injected → null or default values at runtime. Fix: instance fields or constructor injection.
- **Fields read in constructors**: field-injected dependencies and `@Value` fields are still null inside the constructor. Fix: constructor injection or `@PostConstruct`.
- **Lite-mode @Bean calls**: `@Bean` methods in `@Component` classes or `@Configuration(proxyBeanMethods = false)` calling other `@Bean` methods get a new instance per call → duplicate pools, clients, caches. Fix: take the dependency as a `@Bean` method parameter.
- **Scoped beans in singletons**: `@Scope("request"/"session")` without `proxyMode` injected into a singleton fails or pins one instance (`@RequestScope`/`@SessionScope` proxy by default). Fix: `proxyMode = ScopedProxyMode.TARGET_CLASS`.
- **Prototype cleanup**: Spring never calls destroy callbacks on prototype beans → connections or threads they own leak. Fix: close them explicitly.
