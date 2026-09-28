---
name: JPQL, HQL and native queries
description: Query defects in JPA/Hibernate — string-built JPQL/HQL/native SQL (injection), getSingleResult exceptions, unbounded result lists and streams, empty or huge IN lists and unescaped LIKE patterns.
priority: 66
tags: [CWE-89, CWE-564, CWE-400, A05:2025]
activation:
  content:
    - '\.create(?:Native|Named|Mutation|Selection)?Query\('
    - '\.(?:getSingleResult|getResultList|getResultStream|getSingleResultOrNull|scroll)\('
    - '@(?:Query|NamedQuery|NamedNativeQuery)\b'
    - '\bCriteriaBuilder\b'
    - '\b(?:LIKE|like)\s'
  examples:
    - 'Query q = em.createQuery("select o from Order o");'
    - 'List<Order> orders = query.getResultList();'
    - '@Query("select o from Order o where o.status = :status")'
    - 'CriteriaBuilder cb = em.getCriteriaBuilder();'
    - 'String jpql = "select u from User u where u.name LIKE :pattern";'
sources:
  - https://docs.hibernate.org/orm/7.0/querylanguage/html_single/Hibernate_Query_Language.html
  - https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html
  - https://jakarta.ee/specifications/persistence/3.2/apidocs/jakarta.persistence/jakarta/persistence/typedquery
---
- **String-built queries**: JPQL/HQL/native SQL assembled with `+`, `String.format`, `formatted()` or `StringBuilder` from input (including `ORDER BY` columns) → HQL/SQL injection. Fix: named or positional parameters; allow-list identifiers.
- **getSingleResult exceptions**: throws `NoResultException`/`NonUniqueResultException` → 500s for ordinary "not found" cases. Fix: `getSingleResultOrNull()` (JPA 3.2, Hibernate 6) or `getResultStream().findFirst()`.
- **Unbounded results**: `getResultList()` on growing tables → OOM and long GC pauses. Fix: `setMaxResults` or keyset pagination; `getResultStream()`/`ScrollableResults` with a fetch size, closed inside the transaction.
- **IN lists**: an empty collection bound to `IN (:ids)` is invalid SQL on some databases; thousands of values exceed limits (Oracle 1000 items, SQL Server 2100 parameters). Fix: short-circuit empty input, chunk large lists.
- **LIKE with raw input**: `%` and `_` in user input act as wildcards (unintended matches, full scans); a leading `%` defeats indexes. Fix: escape them with an `ESCAPE` clause (Spring Data: `escape()` in SpEL).
