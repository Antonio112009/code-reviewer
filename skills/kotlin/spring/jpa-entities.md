---
name: JPA entities in Kotlin
description: Kotlin JPA/Hibernate entity defects — data classes as entities, final classes defeating lazy proxies, no-arg constructors that skip initializers, non-null properties over nullable columns and copy() creating detached duplicates.
priority: 64
tags: [CWE-697, CWE-476]
activation:
  content:
    - '@(?:Entity|MappedSuperclass|Embeddable)\b'
    - '@(?:OneToMany|ManyToOne|OneToOne|ManyToMany)\b'
    - '\bFetchType\.LAZY\b'
    - '\bplugin\.jpa\b|\bkotlin-jpa\b|\ballOpen\s*\{|\bnoArg\s*\{'
    - '@Transient\b'
  examples:
    - '@Entity class User(@Id val id: Long)'
    - '@ManyToOne(fetch = FetchType.LAZY) lateinit var user: User'
    - 'allOpen { annotation("jakarta.persistence.Entity") }'
    - '@Transient val cachedTotal: BigDecimal? = null'
sources:
  - https://kotlinlang.org/docs/no-arg-plugin.html#jpa-support
  - https://kotlinlang.org/docs/all-open-plugin.html
  - https://docs.jboss.org/hibernate/orm/current/userguide/html_single/Hibernate_User_Guide.html
---
- **Data class entities**: generated `equals`/`hashCode`/`toString` use every constructor property (mutable columns, an `id` null until persist, lazy associations) → entities vanish from `HashSet`s, lazy loads or `LazyInitializationException`, `StackOverflowError` on bidirectional links. Fix: regular classes, stable-key equality.
- **Final entities**: `kotlin("plugin.jpa")` only adds no-arg constructors; without all-open configured for `@Entity`, `@MappedSuperclass` and `@Embeddable`, classes stay final → Hibernate can't create lazy proxies, so `LAZY` to-one associations are fetched eagerly. Fix: `allOpen { annotation("jakarta.persistence.Entity") … }`.
- **Skipped initializers**: the generated no-arg constructor doesn't run property initializers (`invokeInitializers` is off) → `@Transient` fields, `by lazy` delegates and unmapped defaults are `null` in loaded entities → NPE on non-null types. Fix: compute on access or enable `invokeInitializers`.
- **Nullability mismatch**: a non-null Kotlin property (`val name: String`) mapped to a nullable column → Hibernate writes `null` via reflection and code fails later with NPE. Fix: match nullability to the schema (`String?`) or add NOT NULL constraints.
- **copy() on entities**: `entity.copy(status = …)` creates a detached instance with the same id → `save()` merges it and overwrites concurrent changes, and lazy state is lost. Fix: mutate the managed entity inside the transaction.
