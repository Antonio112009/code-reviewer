---
name: UnitOfWork, flush and locking
description: Doctrine ORM persistence traps — flush() saving every managed change, flush($entity) ignored in ORM 3, in-place DateTime changes not detected, stale identity map, closed EntityManager, optimistic and pessimistic locking, batch clear() and detached references.
priority: 66
tags: [CWE-362, CWE-664, CWE-400]
activation:
  content:
    - '->(?:flush|persist|clear|detach|merge|refresh|lock|wrapInTransaction|transactional)\s*\('
    - '\bLockMode::|#\[ORM\\Version\b|\bresetManager\s*\(|->isOpen\s*\('
sources:
  - https://www.doctrine-project.org/projects/doctrine-orm/en/current/reference/working-with-objects.html
  - https://www.doctrine-project.org/projects/doctrine-orm/en/current/reference/transactions-and-concurrency.html
  - https://www.doctrine-project.org/projects/doctrine-orm/en/current/cookbook/working-with-datetime.html
  - https://github.com/doctrine/orm/blob/3.7.x/UPGRADE.md
---
- **flush() saves everything**: any managed entity mutated for display, formatting or a failed validation is written by the next `flush()` anywhere in the request. Fix: DTOs or `refresh()`/`detach()` before unrelated flushes.
- **ORM 3 partial flush removed**: `flush($entity)` ignores its argument and flushes all dirty entities; `clear($class)` throws and `merge()` is gone.
- **In-place DateTime changes**: `$e->getStartsAt()->modify('+1 day')` is not detected (objects are compared by reference) → the change is lost. Fix: assign a new instance, map `datetime_immutable`.
- **Stale identity map**: `find()` returns the already managed instance without re-reading, so changes by other processes or DQL updates are invisible; since 3.7 `LockMode::NONE` no longer refreshes. Fix: `refresh()`.
- **Closed EntityManager**: an exception during flush closes it → every later operation in the same worker or message consumer fails. Fix: `ManagerRegistry::resetManager()`, or restart the worker.
- **Optimistic locking**: `#[ORM\Version]` only catches conflicts within one request; edit forms must send the version and check it via `find($id, LockMode::OPTIMISTIC, $version)` or `lock()`, otherwise lost updates.
- **Pessimistic locks**: `PESSIMISTIC_WRITE` needs an active transaction (`TransactionRequiredException`) and holds until commit.
- **Batches and clear()**: large imports without periodic `flush()` + `clear()` exhaust memory; after `clear()` previously loaded entities are detached, so reusing them in new relations fails with "A new entity was found through the relationship".
