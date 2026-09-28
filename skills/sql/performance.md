---
name: SQL performance
description: Query and write patterns that degrade with data volume, such as hidden N+1 queries, unindexed new predicates and foreign keys, unbounded reads, OFFSET paging, badly sized batches, slow work inside transactions and hot rows.
category: database
priority: 54
tier: essential
tags:
  - CWE-400
  - CWE-1049
  - CWE-1073
activation:
  stack:
    - db.postgresql
    - db.mysql
    - db.sqlite
    - db.sqlserver
    - db.oracle
    - db.mongodb
    - db.redis
    - db.elasticsearch
    - db.clickhouse
    - db.cassandra
    - db.dynamodb
    - db.neo4j
    - db.cockroachdb
    - orm.prisma
    - orm.typeorm
    - orm.sequelize
    - orm.drizzle
    - orm.knex
    - orm.mongoose
    - orm.sqlalchemy
    - orm.django
    - orm.hibernate
    - orm.eloquent
    - orm.doctrine
    - orm.activerecord
    - orm.efcore
    - orm.gorm
    - orm.sqlx
    - orm.diesel
  languages:
    - sql
    - typescript
    - javascript
    - python
    - go
    - java
    - kotlin
    - scala
    - csharp
    - ruby
    - php
    - rust
    - elixir
  content:
    - \b(?:SELECT|UPDATE|DELETE)\b[\s\S]{0,200}?\b(?:FROM|SET|WHERE)\b|\bINSERT\s+INTO\b|\b(?:ALTER|CREATE)\s+(?:TABLE|(?:UNIQUE\s+)?INDEX)\b
    - "['\"`]\\s*(?:select\\s+(?:\\*|distinct\\b|count\\(|[\\w.\"`\\[\\]]+\\s*(?:,|\\bfrom\\b|\\bas\\b))|update\\s+[\\w.\"`\\[\\]]+\\s+set\\b|delete\\s+from\\b|insert\\s+into\\b)"
    - \b(?:prisma|tx)\.\w+\.(?:findMany|findFirst|findUnique|count|aggregate|groupBy|updateMany|deleteMany|createMany)\(|\.(?:findAll|findAndCountAll|bulkCreate|createQueryBuilder|getMany|getRawMany|leftJoinAndSelect|findAndCount)\(|\bdb\.(?:select|insert|update|delete|query)\b|\b(?:knex|trx)\(\s*['"]\w
    - \.objects\.(?:filter|all|exclude|get|annotate|values|select_related|prefetch_related|bulk_create|bulk_update|update|iterator)\(|\bsession\.(?:query|execute|scalars)\(|\bselect\(\s*[A-Z]\w*\s*[),]|\b(?:joinedload|selectinload|subqueryload)\(|\bcursor\.(?:execute|executemany)\(
    - '@Query\(\s*(?:value\s*=\s*)?"{1,3}\s*(?:select|SELECT|update|UPDATE|delete|DELETE|from|FROM|with|WITH)\b|@(?:OneToMany|ManyToOne|ManyToMany|EntityGraph|BatchSize)\b|\b(?:JpaRepository|CrudRepository|EntityManager|JdbcTemplate|NamedParameterJdbcTemplate|prepareStatement|executeQuery|executeUpdate)\b|\bJOIN\s+FETCH\b|\.(?:Include|ThenInclude|AsNoTracking|ToListAsync|FromSql\w*|ExecuteUpdate\w*|ExecuteDelete\w*)\('
    - \bdb\.(?:Preload|Joins|Find|First|Where|Raw|Exec|Model)\(|\.(?:QueryContext|QueryRowContext|ExecContext)\(|\.(?:includes|preload|eager_load)\(:|\.(?:find_each|find_in_batches|in_batches|update_all|delete_all|insert_all)\b|::(?:where|with|whereIn)\(|->(?:whereHas|whereIn|chunkById|cursor|lazy|paginate)\(|\bDB::(?:table|select|statement)\(|\bsqlx::query
  examples:
    - 'CREATE INDEX idx_users_email ON users (email);'
    - 'const q = "select * from users where id = $1";'
    - 'const users = await prisma.user.findMany({ where: { active: true } })'
    - 'User.objects.filter(is_active=True).select_related("profile")'
    - '@Query("SELECT o FROM Order o JOIN FETCH o.items WHERE o.userId = :userId")'
    - 'db.Where("active = ?", true).Find(&users)'
---
- **N+1 queries**: per-row queries hidden in loops, serializers, `__str__`, templates or GraphQL resolvers, or per-row `count()`/`exists()` → one round trip per item. Fix: one `IN`/`= ANY` batch, `prefetch_related`, `include`, `Preload`, `JOIN FETCH`, DataLoader.
- **Unindexed predicates**: new `WHERE`, `JOIN` or `ORDER BY` columns without an index whose leading columns match (equalities, then range/sort), or not matching a partial/expression index → full scans. Fix: ship the index with the query.
- **Unindexed foreign keys**: PostgreSQL, SQL Server, SQLite and Oracle don't index referencing columns (MySQL does) → joins and parent deletes or cascades scan the child table under lock. Fix: index each new FK column.
- **Unbounded reads**: list endpoints without `LIMIT`, `SELECT *` or full entities dragging large JSON/BLOB columns, and `COUNT(*)`/`len(qs)` used as existence checks → I/O and memory grow with data. Fix: `LIMIT`, projections, `EXISTS`.
- **OFFSET paging**: `OFFSET`/`skip` rescans all earlier rows and exact `COUNT(*)` totals per page scan everything → deep pages time out. Fix: keyset `WHERE (created_at, id) < (?, ?)` plus a matching index; capped totals.
- **Batch sizing**: per-row inserts/updates (psycopg2 `executemany` also loops) or one giant `UPDATE`/`DELETE`/`IN` list → round-trip storms, long locks, replica lag, bind-limit errors (SQL Server 2,100; SQLite 32,766; PostgreSQL 65,535). Fix: chunked bulk statements.
- **Slow work in transactions**: HTTP calls, publishes, file I/O or sleeps inside open transactions (`@Transactional` service methods, `atomic()` blocks) hold locks and pooled connections → contention, pool exhaustion. Fix: do I/O outside; keep transactions short.
- **Hot rows**: every request updating one counter or balance row (or locking it `FOR UPDATE`) → lock queues and deadlocks under load. Fix: atomic `SET n = n + ?`, sharded counters, async rollups.
