---
name: Relationship loading and N+1
description: SQLAlchemy loading defects — lazy-load N+1 in loops and serializers, joinedload on collections (unique() requirement, row explosion, LIMIT), dynamic and large collections loaded into memory, cascades that delete too much and loader options applied inconsistently.
priority: 62
tags: [CWE-400]
activation:
  content:
    - '\b(?:relationship|joinedload|selectinload|subqueryload|lazyload|raiseload|noload|contains_eager|defaultload|immediateload)\('
    - '\blazy\s*=\s*["''](?:select|joined|selectin|subquery|dynamic|raise|noload|write_only)["'']'
    - '\b(?:WriteOnlyMapped|DynamicMapped|AppenderQuery)\b|\.unique\(\)'
    - '\bcascade\s*=\s*["''][^"''\n]{0,60}delete'
  examples:
    - 'children = relationship("Child", back_populates="parent")'
    - 'items = relationship("Item", lazy="dynamic")'
    - 'rows = session.execute(stmt).unique().all()'
    - 'children = relationship("Child", cascade="all, delete-orphan")'
sources:
  - https://docs.sqlalchemy.org/en/20/orm/queryguide/relationships.html
  - https://docs.sqlalchemy.org/en/20/orm/large_collections.html
  - https://docs.sqlalchemy.org/en/20/orm/cascades.html
---
- **Lazy-load N+1**: relationships default to `lazy="select"`, so touching `obj.children` or `obj.parent` for every row in a loop, template or response model issues one query per row. Fix: `selectinload()` for collections, `joinedload()` for many-to-one; `raiseload("*")` to catch misses.
- **joinedload on collections**: needs `.unique()` on 2.0-style results (else an error), multiplies rows per child and wraps `LIMIT` in a subquery. Fix: `selectinload()` for collections.
- **Large collections in memory**: `obj.items.append(x)`, `len(obj.items)` or iterating a big collection loads all rows; `lazy="dynamic"` is legacy in 2.0. Fix: `WriteOnlyMapped` and explicit paged queries.
- **Cascades delete too much**: `cascade="all, delete-orphan"` on the wrong side, or reassigning a collection, deletes children and history; `delete-orphan` removes rows merely detached from the parent. Fix: cascade only on true ownership, `passive_deletes` with DB `ON DELETE`.
- **Stale or partial collections**: eager options never overwrite collections already loaded in the identity map, and `contains_eager()` over a filtered join stores only the matching children in `obj.children` for the rest of the session. Fix: `execution_options(populate_existing=True)` or a separate query.
