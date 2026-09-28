---
name: Query construction and bulk DML
description: SQLAlchemy query defects — Python and/or/in/is None evaluated outside SQL, injectable literal_column()/text() ordering, client-chosen filter_by() keys, LIKE wildcards from input, ORM bulk UPDATE/DELETE skipping events and cascades, merge() with client primary keys and first() without ORDER BY.
priority: 70
tags: [CWE-89, CWE-639, CWE-697]
activation:
  content:
    - '\.(?:filter|where|filter_by|having)\('
    - '\b(?:literal_column|column|text)\(|\.order_by\(\s*text\('
    - '\.(?:like|ilike|contains|startswith|endswith)\('
    - '\b(?:update|delete)\(\s*\w+\s*\)|\bsynchronize_session\b|\.merge\('
  examples:
    - 'query = session.query(User).filter(User.id == user_id)'
    - 'query = query.order_by(text(request_sort))'
    - 'matches = User.name.like(f"%{term}%")'
    - 'session.execute(update(User).where(User.id == 1).values(name="x"))'
sources:
  - https://docs.sqlalchemy.org/en/20/core/operators.html
  - https://docs.sqlalchemy.org/en/20/orm/queryguide/dml.html#orm-queryguide-update-delete-caveats
  - https://docs.sqlalchemy.org/en/20/core/sqlelement.html
  - https://docs.sqlalchemy.org/en/20/orm/session_state_management.html#merging
---
- **Python operators in criteria**: `a == 1 and b == 2`, `or`, `not`, `x in [...]` or `col is None` inside `filter()`/`where()` are evaluated by Python → one condition silently dropped or a constant `False`. Fix: `and_()`/`&`, `or_()`/`|`, `.in_()`, `.is_(None)`.
- **Injectable identifiers**: `literal_column(user)`, `column(user)` or `order_by(text(request_sort))` embed raw SQL. Fix: map allowed sort keys to column objects.
- **Client-chosen filter_by() keys**: `filter_by(**request.args)` lets callers filter on any column (secrets, tenant ids) and raises 500s on unknown names. Fix: allowlist.
- **LIKE wildcards from input**: `%`/`_` in user text passed to `.like()`, `.contains()` or `.startswith()` broaden matches and force scans. Fix: `autoescape=True` or escape explicitly.
- **ORM bulk UPDATE/DELETE**: `session.execute(update(Model)...)` or `Query.update()` skips mapper events and `@validates`, applies no relationship cascades (orphans unless DB `ON DELETE`) and ignores joined inheritance; `synchronize_session=False` leaves stale objects in the session.
- **merge() with client primary keys**: `session.merge(Model(**payload))` loads the row by the payload's id and overwrites it → callers update any row. Fix: load by an authorised id, copy allowed fields.
- **first() without ORDER BY**: returns an arbitrary row that changes between runs. Fix: explicit `order_by()`, or `one()` when uniqueness is expected.
