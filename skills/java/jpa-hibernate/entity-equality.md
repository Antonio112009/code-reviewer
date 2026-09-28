---
name: Entity equals, hashCode and toString
description: Entity identity defects — Lombok @Data/@EqualsAndHashCode/@ToString on entities, equality on generated ids that change at persist, getClass() checks failing on Hibernate proxies and final, Kotlin or record entity classes that cannot be proxied.
priority: 60
tags: [CWE-581, CWE-400]
activation:
  content:
    - '@(?:Data|EqualsAndHashCode|ToString|Value)\b'
    - '\bboolean\s+equals\s*\(|\bint\s+hashCode\s*\('
    - '\boverride\s+fun\s+(?:equals|hashCode)\('
    - '\bgetClass\(\)\s*!='
  examples:
    - '@Data'
    - 'public boolean equals(Object o) { return id.equals(((User) o).id); }'
    - 'override fun equals(other: Any?): Boolean {'
    - 'if (getClass() != o.getClass()) return false;'
sources:
  - https://docs.hibernate.org/orm/7.0/introduction/html_single/Hibernate_Introduction.html
  - https://docs.hibernate.org/orm/7.0/userguide/html_single/Hibernate_User_Guide.html
  - https://projectlombok.org/features/Data
---
- **Lombok on entities**: `@Data`, `@EqualsAndHashCode`, `@ToString` (or `@Value`) generate methods over all fields, lazy associations included → lazy loads and `LazyInitializationException` from `toString`/`hashCode`, `StackOverflowError` on bidirectional links, hashes that change on every edit. Fix: `@Getter`/`@Setter` plus explicit equality.
- **Generated-id equality**: `equals`/`hashCode` on a `@GeneratedValue` id → all new entities are equal (null id) and `hashCode` changes after persist → entities vanish from `HashSet`s and map keys. Fix: a business key, or id-based `equals` with a constant `hashCode`.
- **Proxy classes**: `getClass() != o.getClass()` fails for `Entity` vs its Hibernate proxy subclass, and reading `other.field` directly on a proxy sees unloaded (null) fields. Fix: `instanceof` or `Hibernate.getClass()`, and getters.
- **Unproxyable entities**: `final` entity classes or methods, Kotlin entities without the `kotlin-jpa`/all-open plugins, or records as entities → lazy proxies impossible (silently eager) or instantiation errors. Fix: open classes with a no-arg constructor; records only for DTOs.
