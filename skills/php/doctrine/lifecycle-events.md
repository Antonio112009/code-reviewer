---
name: Lifecycle callbacks and listeners
description: Doctrine event traps — flush() inside listeners, preUpdate changes ignored, onFlush changes without recomputed change sets, side effects in post* events before commit, events skipped by DQL and database cascades, heavy postLoad work.
priority: 62
tags: [CWE-696, CWE-362, CWE-400]
activation:
  content:
    - '#\[(?:ORM\\(?:PrePersist|PostPersist|PreUpdate|PostUpdate|PreRemove|PostRemove|PostLoad|PreFlush|HasLifecycleCallbacks)|AsDoctrineListener|AsEntityListener)\b'
    - '\b(?:PreUpdate|OnFlush|PostFlush|PrePersist|PostPersist|PostUpdate|PostRemove|Lifecycle)EventArgs\b'
    - '\bfunction\s+(?:prePersist|postPersist|preUpdate|postUpdate|preRemove|postRemove|onFlush|preFlush|postLoad)\s*\('
  examples:
    - '#[ORM\HasLifecycleCallbacks]'
    - 'public function preUpdate(PreUpdateEventArgs $event): void'
sources:
  - https://www.doctrine-project.org/projects/doctrine-orm/en/current/reference/events.html
  - https://www.doctrine-project.org/projects/doctrine-orm/en/current/reference/events.html#implementing-event-listeners
---
- **flush() in listeners**: calling `flush()` from `postPersist`, `postUpdate`, `onFlush` or `postFlush` re-enters the UnitOfWork mid-commit → updates lost or applied partially (unsupported per the docs); in `preFlush` it loops forever.
- **preUpdate changes ignored**: assigning properties in `preUpdate` is not saved and association changes are never allowed there. Fix: `$args->setNewValue($field, $value)` or `prePersist`/`onFlush`.
- **onFlush bookkeeping**: entities persisted in `onFlush` need `computeChangeSet()`, and modified ones `recomputeSingleEntityChangeSet()` → otherwise silently not written.
- **Side effects before commit**: `postPersist`/`postUpdate`/`postRemove` run inside the flush before the transaction commits → e-mails, HTTP calls or queued messages happen even if the commit fails, and consumers may not see the rows yet. Fix: collect, then act after commit (`postFlush`).
- **Events skipped**: DQL `UPDATE`/`DELETE` and database-level cascades fire no `preUpdate`/`preRemove`/`post*` events → audit logs, search indexing and file cleanup silently skipped.
- **postLoad cost**: queries or service calls inside `postLoad` run once per hydrated entity → listing pages issue N extra queries.
