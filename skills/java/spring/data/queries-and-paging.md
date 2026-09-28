---
name: Spring Data queries, sorting and paging
description: Request-driven query building in Spring Data — unvalidated Sort/Pageable input, JpaSort.unsafe and native ORDER BY injection, native queries without countQuery, unbounded page sizes, Page/PageImpl serialized as JSON and filters from raw parameters.
priority: 64
tags: [CWE-89, CWE-400, A05:2025]
activation:
  content:
    - '@(?:Query|NativeQuery)\b'
    - '\b(?:Sort|Pageable|PageRequest|JpaSort|PagedModel|Specification|ExampleMatcher|PageImpl)\b'
    - '\bPage<'
    - '\bspring\.data\.web\.'
  examples:
    - '@Query("select o from Order o")'
    - 'Pageable pageable = PageRequest.of(page, size, sort);'
    - 'Page<Order> orders = repository.findAll(pageable);'
    - 'spring.data.web.pageable.max-page-size=100'
sources:
  - https://docs.spring.io/spring-data/jpa/reference/jpa/query-methods.html
  - https://docs.spring.io/spring-data/commons/reference/repositories/core-extensions.html
---
- **Unvalidated sort input**: `Sort`/`Pageable` resolved from request parameters carry property names as-is; with native queries or `JpaSort.unsafe(...)` they are appended to the SQL → injection, and sorting by hidden fields (`?sort=passwordHash`) leaks values through ordering. Fix: allow-list sortable properties.
- **Native paging**: `nativeQuery = true`/`@NativeQuery` with `Pageable` needs an explicit `countQuery` unless the SQL is trivial → wrong totals or failing count derivation. Fix: provide `countQuery`.
- **Unbounded page size**: `PageRequest.of(page, size)` built from raw parameters bypasses the resolver's 2000 cap (`spring.data.web.pageable.max-page-size`) → huge pages, DoS. Fix: clamp `size` or bind `Pageable`.
- **Serializing Page**: returning `Page`/`PageImpl` from controllers produces an unstable JSON shape (Spring Data 3.3+ warns) and usually exposes entities. Fix: `PagedModel` or `@EnableSpringDataWebSupport(pageSerializationMode = VIA_DTO)` with DTO content.
- **Filters from raw parameters**: `Specification`s/`Example`s built from every request parameter let clients filter on internal fields (tenant, role, deleted) and infer hidden data. Fix: allow-list filterable fields; add tenant/ownership predicates server-side.
