---
name: Associations, cascades and collections
description: Doctrine association traps — inverse-side changes ignored, cascade remove on shared entities, database cascades bypassing events, orphanRemoval deleting moved children, bidirectional ManyToMany defeating RESTRICT, and collections loaded in full.
priority: 64
tags: [CWE-459, CWE-400, CWE-1321]
activation:
  content:
    - '#\[ORM\\(?:OneToMany|ManyToOne|ManyToMany|OneToOne|JoinColumn|JoinTable)\b|<(?:one-to-many|many-to-one|many-to-many|one-to-one)\b'
    - '\b(?:mappedBy|inversedBy|orphanRemoval|cascade|onDelete)\b|\bEXTRA_LAZY\b|fetch:\s*[''"]EAGER'
    - '->(?:matching|removeElement)\s*\(|\bCriteria::create\s*\('
  examples:
    - '#[ORM\OneToMany(mappedBy: ''post'', targetEntity: Comment::class, cascade: [''persist''], orphanRemoval: true)]'
    - '$approved = $post->getComments()->matching(Criteria::create()->where(Criteria::expr()->eq(''approved'', true)));'
sources:
  - https://www.doctrine-project.org/projects/doctrine-orm/en/current/reference/unitofwork-associations.html
  - https://www.doctrine-project.org/projects/doctrine-orm/en/current/reference/working-with-associations.html
  - https://www.doctrine-project.org/projects/doctrine-orm/en/current/reference/working-with-objects.html
  - https://www.doctrine-project.org/projects/doctrine-orm/en/current/tutorials/extra-lazy-associations.html
---
- **Owning side only**: Doctrine persists only the owning side (the `inversedBy`/ManyToOne side); `$post->getComments()->add($c)` without `$c->setPost($post)` saves nothing. Fix: update both sides in adder methods.
- **cascade remove**: `cascade: ['remove']` loads every related entity and deletes them one query at a time; on ManyToOne/ManyToMany it deletes shared parents or other owners' rows. Fix: DB `onDelete: 'CASCADE'` for owned children only.
- **Database cascades**: `onDelete: 'CASCADE'` deletes rows without lifecycle events and leaves them in already loaded collections → audit hooks skipped, stale objects re-used.
- **orphanRemoval**: removing a child from the collection deletes it, including when it is moved to another parent → data loss. Use only for privately owned children.
- **Bidirectional ManyToMany**: the ORM deletes join-table rows before removing the entity, so `ON DELETE RESTRICT` on the join table no longer protects anything.
- **Collections loaded in full**: `count($collection)`, `contains()` or `filter()` on a lazy collection load every element; `fetch: 'EAGER'` on collections loads them for each parent. Fix: `EXTRA_LAZY`, `matching(Criteria)`, or a JOIN FETCH query.
