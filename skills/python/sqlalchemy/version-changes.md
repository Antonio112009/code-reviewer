---
name: 1.4 → 2.0 → 2.1 behaviour changes
description: SQLAlchemy upgrade traps — 2.0 removal of library autocommit, raw SQL strings and implicit execution, Row results instead of entities, no backref cascade; 2.1 psycopg 3 default driver, autoflush before text() and stricter Select.filter_by().
priority: 66
activation:
  versions: { orm.sqlalchemy: ">=1.4" }
  content:
    - '\.connect\(\)|\.execute\(\s*(?:f?["'']|text\()|\bexecution_options\([^)\n]{0,40}autocommit'
    - '\bsession\.execute\(\s*select\(|\.all\(\)\s*$|\brow\[\s*["'']'
    - '\b(?:backref|back_populates)\s*=|\bcascade_backrefs\b'
    - '\bcreate(?:_async)?_engine\(\s*["''](?:postgresql|postgres)://|\bMappedAsDataclass\b|\.filter_by\('
    - '\b[Ss][Qq][Ll][Aa]lchemy\b[^\n]{0,20}(?:==|>=|~=|<)'
  examples:
    - 'conn.execute("SELECT 1")'
    - 'rows = session.execute(select(User)).all()'
    - 'items = relationship("Item", back_populates="parent")'
    - 'engine = create_engine("postgresql://user:pass@host/db")'
    - 'SQLAlchemy==2.0.25'
sources:
  - https://docs.sqlalchemy.org/en/20/changelog/migration_20.html
  - https://docs.sqlalchemy.org/en/20/orm/cascades.html#save-update
  - https://docs.sqlalchemy.org/en/21/changelog/migration_21.html
---
- **No autocommit (2.0)**: `with engine.connect() as conn: conn.execute(insert/update/text(...))` without `conn.commit()` is rolled back when the block exits → silent data loss. Fix: `engine.begin()` or `conn.commit()`.
- **Raw strings, implicit execution (2.0)**: `conn.execute("SELECT ...")`, `engine.execute()` and bound `MetaData` are gone. Fix: `text()` with bound parameters.
- **Rows, not entities (2.0)**: `session.execute(select(User)).all()` returns `Row` tuples, and `row["col"]` fails. Fix: `session.scalars(...)`, `row._mapping["col"]`.
- **No backref cascade (2.0)**: `item.order = order` no longer adds `item` to the session → it is not inserted (only a warning). Fix: `session.add(item)` or append via `order.items`.
- **psycopg 3 by default (2.1)**: bare `postgresql://` URLs now load `psycopg` (and asyncio needs the `sqlalchemy[asyncio]` extra) → failures where only `psycopg2` is installed. Fix: explicit driver in the URL.
- **Autoflush before text() (2.1)**: pending objects now flush before `text()` queries too → earlier `IntegrityError`s, different raw-query results.
- **Select.filter_by() (2.1)**: names now resolve across all FROM entities; ambiguous ones raise `AmbiguousColumnError`. Fix: `filter()` with qualified columns.
- **Dataclass FK defaults (2.0)**: with `MappedAsDataclass`, `relationship(default=None)` makes `Parent(related_id=5)` insert NULL (fixed in 2.1).
