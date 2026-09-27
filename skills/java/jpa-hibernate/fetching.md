---
name: Fetching strategy and N+1 queries
description: Association loading defects — JPA's EAGER to-one default, N+1 loops over lazy associations, collection fetch joins paginated in memory, MultipleBagFetchException and Cartesian products, lazy-loading workarounds and eager inverse one-to-one loads.
priority: 64
tags: [CWE-1073, CWE-400]
activation:
  content:
    - '\bFetchType\.\w+'
    - '@(?:ManyToOne|OneToOne|OneToMany|ManyToMany|EntityGraph|NamedEntityGraph|BatchSize|Fetch)\b'
    - '\b(?:join|JOIN|Join)\s+(?:fetch|FETCH|Fetch)\b'
    - '\.setMaxResults\(|\bPageable\b'
    - '\benable_lazy_load_no_trans\b'
sources:
  - https://docs.hibernate.org/orm/7.0/introduction/html_single/Hibernate_Introduction.html
  - https://docs.hibernate.org/orm/7.0/userguide/html_single/Hibernate_User_Guide.html
  - https://docs.spring.io/spring-boot/reference/data/sql.html
---
- **EAGER to-one default**: `@ManyToOne`/`@OneToOne` without `fetch = LAZY` load eagerly (JPA default) → extra joins or selects on every query, N+1 for JPQL results. Fix: `FetchType.LAZY`, fetch per use case.
- **N+1 loops**: iterating results and touching lazy associations (DTO mapping, Jackson, `toString`, templates) → one query per row. Fix: `JOIN FETCH`, `@EntityGraph`, `@BatchSize` or `hibernate.default_batch_fetch_size`.
- **Paging collection fetches**: a collection `JOIN FETCH`/entity graph combined with `setMaxResults`/`Pageable` → Hibernate loads every row and pages in memory (warning HHH90003004) → OOM. Fix: page ids first, then fetch by ids; `hibernate.query.fail_on_pagination_over_collection_fetch=true`.
- **Several collection fetches**: fetch-joining two `List` (bag) collections → `MultipleBagFetchException`; with `Set`s → Cartesian-product row explosion. Fix: one collection per query, the rest via batch fetching.
- **Lazy-loading workarounds**: `hibernate.enable_lazy_load_no_trans=true` (a session per lazy access) or switching to EAGER to silence `LazyInitializationException`; Boot's default Open-Session-in-View hides N+1 in serialization. Fix: fetch inside the service transaction, return DTOs.
- **Inverse one-to-one**: `@OneToOne(mappedBy = …, fetch = LAZY)` is still loaded eagerly without bytecode enhancement (Hibernate must know if it is null) → hidden query per row. Fix: `@MapsId` shared key or a unidirectional mapping.
