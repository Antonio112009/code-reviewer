---
name: ORM pitfalls
description: ORM defects (Prisma, TypeORM, Sequelize, Drizzle, Knex, SQLAlchemy, GORM, plus Hibernate, Doctrine, EF Core and Django gaps) such as escaped transactions, vanishing filters, skipped hooks, implicit flushes, cascade scope, schema auto-sync, Python-evaluated operators and raw-SQL injection.
category: database
priority: 58
tier: essential
tags:
  - CWE-89
  - CWE-362
  - CWE-639
  - OWASP-A01
  - OWASP-A05
activation:
  stack:
    - orm.prisma
    - orm.typeorm
    - orm.sequelize
    - orm.drizzle
    - orm.knex
    - orm.sqlalchemy
    - orm.django
    - orm.hibernate
    - orm.eloquent
    - orm.doctrine
    - orm.activerecord
    - orm.efcore
    - orm.gorm
  languages:
    - typescript
    - javascript
    - python
    - java
    - kotlin
    - scala
    - csharp
    - php
    - ruby
    - go
    - yaml
    - json
    - text
  files:
    - "**/schema.prisma"
    - "**/prisma/schema/*.prisma"
    - "**/*.entity.ts"
    - "**/{data-source,ormconfig}.{ts,js,json}"
  content:
    - "@prisma/client|\\bprisma\\.\\$(?:transaction|queryRaw\\w*|executeRaw\\w*|extends)\\b|\\b(?:prisma|tx)\\.\\w+\\.(?:find\\w*|create\\w*|update\\w*|upsert|delete\\w*)\\(|from\\s+['\"](?:typeorm|sequelize|sequelize-typescript|drizzle-orm[\\w/-]*|knex)['\"]|\\b(?:getRepository|createQueryBuilder|InjectRepository)\\b|\\b(?:findAll|findAndCountAll|bulkCreate|findOrCreate|findOneBy)\\(|\\b(?:pgTable|mysqlTable|sqliteTable)\\(|@relation\\(|@@(?:index|unique|map|id)\\("
    - \b(?:from|import)\s+sqlalchemy\b|\b(?:AsyncSession|sessionmaker|scoped_session)\b|\bsession\.(?:query|execute|scalars|add_all|merge|commit|flush|refresh)\(|\bmapped_column\(|\brelationship\(|\.(?:filter|where)\([^)\n]{0,200}\bis\s+(?:not\s+)?None\b|\bQ\(\s*\w+=[^)\n]{0,200}\)\s+(?:and|or)\s+Q\(
    - "@(?:Entity|OneToMany|ManyToOne|ManyToMany|OneToOne|Version|EntityGraph)\\b|\\b(?:jakarta|javax)\\.persistence\\b|\\borg\\.hibernate\\b|\\b(?:EntityManager|FetchType|CascadeType)\\b|\\bDoctrine\\\\(?:ORM|DBAL)|#\\[ORM\\\\|->(?:persist|flush)\\(\\)"
    - \bDbContext\b|\bDbSet<|\bSaveChanges(?:Async)?\(|\b(?:AsNoTracking|IgnoreQueryFilters|OnDelete)\b|gorm\.io/gorm|\bgorm\.(?:Model|DB|Expr)\b|\.(?:Preload|FirstOrCreate|Updates|UpdateColumns?|Unscoped|AutoMigrate)\(
    - \bsynchronize\s*:\s*true\b|\.sync\(\s*\{\s*(?:alter|force)\b|\bddl-auto\b|\bhbm2ddl\b|\bprisma\s+db\s+push\b|\bcascade\s*:\s*(?:true|\[)|\bonDelete\s*:\s*['"]?(?:Cascade|CASCADE)\b|\bon_delete\s*=\s*(?:models\.)?CASCADE\b|\bdependent:\s*:(?:destroy|delete_all)\b|->cascadeOnDelete\(|\borphanRemoval\b
  examples:
    - 'await prisma.$transaction(async (tx) => { await tx.user.update({ where: { id }, data }) })'
    - 'session.query(User).filter(User.id == user_id).first()'
    - '@OneToMany(mappedBy = "user", cascade = CascadeType.ALL) private List<Order> orders;'
    - 'db.Preload("Orders").Where("active = ?", true).Find(&users)'
    - 'new DataSource({ type: ''postgres'', synchronize: true })'
---
- **Escaped transactions**: inside Prisma `$transaction`, TypeORM `manager.transaction`, Drizzle or Knex callbacks, calls on the global client or repositories (or Sequelize calls without `transaction: t`) run outside it → partial writes. Fix: use `tx` everywhere.
- **Vanishing filters**: `undefined` where-values are dropped by Prisma (no `strictUndefinedChecks`) and TypeORM 0.3 → lookups return another user's row, `deleteMany` hits every row; GORM skips zero-valued struct conditions and `Updates` fields. Fix: validate inputs.
- **Hooks skipped**: TypeORM `update()`/`insert()`/query builders skip entity listeners; Sequelize `bulkCreate` skips validation and static `update`/`destroy` skip per-row hooks (`validate`, `individualHooks`); GORM `UpdateColumns` skips hooks → unhashed passwords, missing audit. Fix: entity APIs.
- **Implicit flushes**: managed entities (Hibernate/JPA, Doctrine, EF Core, SQLAlchemy) mutated for display or validation are written on flush/commit; merging request-built entities writes every column → masked or nulled data persisted. Fix: DTO copies, `@Version`.
- **Cascade scope**: `CascadeType.REMOVE`/`ALL` on `@ManyToOne`, `orphanRemoval` on replaced collections, EF Core's default cascade on required relations, or new cascades reaching orders or audit rows → one delete erases history. Fix: `RESTRICT`, soft deletes.
- **Schema auto-sync**: TypeORM `synchronize: true`, Sequelize `sync({ alter })`, Hibernate `ddl-auto=update` or `prisma db push` against production → unreviewed DDL; renames can drop columns with their data. Fix: versioned migrations.
- **Python operators**: `is None`, `and`/`or` or `in` in SQLAlchemy `filter()`/`where()`, or `and`/`or` between Django `Q` objects evaluate in Python → constant or dropped conditions. Fix: `.is_(None)`, `&`, `|`, `.in_()`.
- **Raw SQL hatches**: interpolated `$queryRawUnsafe`/`Prisma.raw`, TypeORM `where()`/`orderBy()` strings, Sequelize `literal` or `query` without `replacements`, Knex `raw`, Drizzle `sql.raw` → injection. Fix: tagged `$queryRaw`, bindings.
