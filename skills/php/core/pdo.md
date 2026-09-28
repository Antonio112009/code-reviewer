---
name: PDO and mysqli usage
description: PDO/mysqli correctness — exception error modes (8.0/8.1), bindParam by reference, native int/float fetches (8.1), fetch() false, rowCount semantics, MySQL implicit commits, lastInsertId on PostgreSQL, buffered results and persistent connections.
priority: 60
tags: [CWE-252, CWE-662, CWE-400]
activation:
  content:
    - '\bnew\s+\\?(?:PDO|mysqli)\s*\(|\bPDO::(?:ATTR_|FETCH_|PARAM_|MYSQL_)'
    - '->(?:bindParam|bindValue|rowCount|lastInsertId|fetchColumn|beginTransaction|inTransaction)\s*\('
    - '\bmysqli_(?:query|prepare|report|fetch_\w+|connect)\s*\('
  examples:
    - '$pdo = new PDO($dsn, $user, $pass, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);'
    - '$stmt->bindValue('':id'', $id, PDO::PARAM_INT);'
    - '$result = mysqli_query($conn, $sql);'
sources:
  - https://www.php.net/manual/en/pdostatement.bindparam.php
  - https://www.php.net/manual/en/migration81.incompatible.php
  - https://www.php.net/manual/en/migration80.incompatible.php
  - https://www.php.net/manual/en/pdostatement.rowcount.php
---
- **Exception modes**: PDO throws by default since 8.0 and mysqli since 8.1 → `if (!$stmt->execute())` branches are dead and exceptions escape before `rollBack()`. Fix: try/catch with rollback.
- **bindParam by reference**: values are read at `execute()`, so `foreach ($params as $k => $v) $stmt->bindParam($k, $v)` binds every placeholder to the last value. Fix: `bindValue()` or `execute($params)`.
- **Native types (8.1)**: MySQL (emulated prepares) and SQLite fetch ints/floats instead of strings → `$row['id'] === '5'` checks break after upgrading. Fix: compare with casts.
- **No row**: `fetch()` and `fetchColumn()` return `false` → `$row['x']` becomes null with a warning; `fetchColumn()` `false` vs `0` is easy to confuse. Fix: check `=== false`.
- **rowCount**: unreliable for SELECT; for MySQL UPDATE it counts changed rows, so re-saving identical values returns 0 → misread as "not found". Fix: `SELECT` first or `MYSQL_ATTR_FOUND_ROWS`.
- **Implicit commits**: MySQL DDL and `TRUNCATE` inside a transaction commit it; since 8.0 `inTransaction()` is false and `commit()`/`rollBack()` throw "There is no active transaction".
- **lastInsertId**: PostgreSQL needs the sequence name → wrong or missing ids. Fix: `INSERT … RETURNING id`.
- **Buffered results and persistence**: MySQL buffers whole result sets in memory (large exports OOM); `ATTR_PERSISTENT` reuses connections with open transactions, locks and session variables from earlier requests.
