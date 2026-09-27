---
name: Persistence context, flushing and locking
description: Unit-of-work defects — unintended dirty-checking writes, merge returning a copy, errors surfacing only at flush or commit, missing or bypassed @Version checks, bulk updates bypassing the context and pessimistic locks without timeouts.
priority: 64
tags: [CWE-362, CWE-367]
activation:
  content:
    - '\b(?:EntityManager|Session)\b'
    - '\.(?:persist|merge|flush|detach|refresh|lock|executeUpdate)\('
    - '@(?:Version|Lock|Modifying)\b'
    - '\bLockModeType\.'
sources:
  - https://docs.hibernate.org/orm/7.0/introduction/html_single/Hibernate_Introduction.html
  - https://docs.hibernate.org/orm/7.0/userguide/html_single/Hibernate_User_Guide.html
  - https://github.com/hibernate/hibernate-orm/blob/main/documentation/src/main/asciidoc/userguide/chapters/batch/Batching.adoc
---
- **Accidental writes**: changing a managed entity (masking fields for a response, normalizing input, "temporary" edits) inside a transaction is flushed at commit without any `save()`. Fix: map to DTOs or `detach` first.
- **merge returns a copy**: `merge(detached)` returns the managed instance and ignores later changes to the argument; merging request-built entities overwrites unsent columns with null. Fix: use the returned entity; load and copy allowed fields.
- **Late failures**: constraint violations and optimistic-lock conflicts are raised at flush or commit, outside a `try` around `persist()` → wrong error handling. Fix: `flush()` inside the `try`, or handle at the transaction boundary.
- **Lost updates**: concurrently edited entities without `@Version` → last write wins silently; loading the entity and copying DTO fields without comparing the client's version bypasses optimistic locking. Fix: `@Version` and check the submitted version.
- **Bulk statements**: JPQL/Criteria `update`/`delete` bypass the persistence context, callbacks, cascades and version increments (unless `versioned`) → stale managed entities later overwrite the new values. Fix: clear the context afterwards.
- **Unbounded pessimistic locks**: `LockModeType.PESSIMISTIC_WRITE`/`@Lock` without a lock timeout hint (`jakarta.persistence.lock.timeout`) → threads wait indefinitely; inconsistent lock order deadlocks. Fix: timeout hints and a fixed order.
