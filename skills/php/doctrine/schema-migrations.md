---
name: Mapping types and migrations
description: Doctrine mapping and migration traps — decimal as string, time zones in datetime columns, nullable/length mismatches, enumType hydration errors, uniqueness without constraints, rename diffs dropping data, transactional MySQL migrations and AUTO identity on PostgreSQL (ORM 3 + DBAL 4).
priority: 64
tags: [CWE-681, CWE-1066, CWE-362]
activation:
  files: ["**/migrations/**/*.php", "**/Migrations/**/*.php", "**/*.orm.xml"]
  content:
    - '#\[ORM\\(?:Column|Id|GeneratedValue|UniqueConstraint|Index)\b|\bUniqueEntity\b|\benumType\b'
    - '->addSql\s*\(|\bfunction\s+(?:up|down|isTransactional)\s*\(|doctrine:schema:update'
  examples:
    - '#[ORM\Column(type: ''decimal'', precision: 10, scale: 2)]'
    - 'public function up(Schema $schema): void { $this->addSql(''ALTER TABLE users ADD status VARCHAR(20) NOT NULL''); }'
sources:
  - https://www.doctrine-project.org/projects/doctrine-orm/en/current/reference/basic-mapping.html
  - https://www.doctrine-project.org/projects/doctrine-migrations/en/current/explanation/implicit-commits.html
  - https://github.com/doctrine/orm/blob/3.7.x/UPGRADE.md
  - https://www.doctrine-project.org/projects/doctrine-orm/en/current/cookbook/working-with-datetime.html
---
- **decimal is a string**: `decimal` columns hydrate as PHP strings → casting to `float` for money loses precision and `'10.50' === 10.5` is false.
- **Time zones**: `datetime` stores no zone and values are read in PHP's default time zone → servers with different `date.timezone` shift times. Fix: store UTC, convert on output.
- **Nullable and length mismatches**: `nullable: true` columns on non-nullable typed properties throw `TypeError` on hydration; strings default to length 255 → longer values fail or are truncated.
- **enumType**: an unknown database value (removed case, manual edit) throws `ValueError` while hydrating → every page loading that row crashes. Fix: migrate data before removing cases.
- **Uniqueness without a constraint**: `UniqueEntity` or "find then insert" checks race → duplicates. Fix: a database unique constraint and handling `UniqueConstraintViolationException` (which also closes the EntityManager).
- **Generated diffs**: `doctrine:migrations:diff` turns a renamed property or column into DROP + ADD → data loss; never run `doctrine:schema:update --force` in production. Review generated SQL.
- **Transactional MySQL migrations**: migrations are transactional by default, but MySQL DDL commits implicitly → earlier DML is committed and a failure leaves partial changes. Fix: split DML and DDL, `isTransactional(): false`.
- **AUTO identity (ORM 3 + DBAL 4)**: `GeneratedValue(strategy: 'AUTO')` now means IDENTITY on PostgreSQL (was SEQUENCE/SERIAL) → schema diffs rewrite id columns. Fix: migrate deliberately or pin `SEQUENCE`.
