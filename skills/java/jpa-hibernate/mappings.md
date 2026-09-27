---
name: Association and enum mappings
description: Mapping defects — cascade REMOVE/ALL towards shared parents, orphanRemoval with replaced collections, one-sided bidirectional updates, unidirectional @OneToMany, @ManyToMany lists re-inserting join rows and ORDINAL enums.
priority: 62
activation:
  content:
    - '\bCascadeType\.\w+'
    - '\borphanRemoval\b'
    - '\bmappedBy\b'
    - '@(?:OneToMany|ManyToMany|ManyToOne|OneToOne|Enumerated|ElementCollection|JoinTable|OrderColumn)\b'
sources:
  - https://docs.hibernate.org/orm/7.0/userguide/html_single/Hibernate_User_Guide.html
  - https://jakarta.ee/specifications/persistence/3.2/apidocs/jakarta.persistence/jakarta/persistence/enumerated
---
- **Cascading removal to shared data**: `CascadeType.REMOVE`/`ALL` on `@ManyToOne` or `@ManyToMany` → deleting one entity deletes a shared parent or unrelated rows. Fix: cascade only from an aggregate root to children it owns.
- **Replaced orphan collections**: with `orphanRemoval = true`, assigning a new collection (`setItems(newList)`) → `HibernateException` ("collection with cascade=all-delete-orphan was no longer referenced"). Fix: mutate the managed collection (`clear()` + `addAll`).
- **One-sided bidirectional updates**: changing only the inverse (`mappedBy`) side isn't persisted, and the in-memory graph disagrees with the database. Fix: helper methods that set both sides.
- **Unidirectional @OneToMany**: without `mappedBy` or `@JoinColumn`, Hibernate uses a join table and issues extra statements per child. Fix: a bidirectional mapping owned by `@ManyToOne`, or `@JoinColumn`.
- **@ManyToMany List**: removing one element from a `List` (bag) deletes all join rows and re-inserts the rest. Fix: a `Set` with stable `equals`/`hashCode`.
- **ORDINAL enums**: `@Enumerated` defaults to `ORDINAL` (unless a converter or `@EnumeratedValue` is present) → adding or reordering constants silently remaps stored rows. Fix: `EnumType.STRING` or a converter with explicit codes.
