---
name: Room database
description: Room 2.x/3 defects — schema versions without migrations, destructive fallbacks wiping user data, REPLACE deleting rows and cascading children, main-thread queries, several database instances, multi-step writes without transactions and raw queries built from strings.
priority: 66
tags: [CWE-89, CWE-662, CWE-1284]
activation:
  content:
    - '@Database\s*\('
    - '\bRoom\.(?:databaseBuilder|inMemoryDatabaseBuilder)\b'
    - '\bfallbackToDestructiveMigration\w*\s*\('
    - '\bMigration\s*\(|\bAutoMigration\b'
    - '\bOnConflictStrategy\.REPLACE\b'
    - '\ballowMainThreadQueries\s*\('
    - '@(?:Dao|Insert|Update|Delete|Upsert|Query|RawQuery|Transaction)\b'
    - '\bSimpleSQLiteQuery\s*\('
  examples:
    - '@Database(entities = [User::class], version = 2)'
    - 'Room.databaseBuilder(context, AppDatabase::class.java, "app.db").build()'
    - '.fallbackToDestructiveMigration(dropAllTables = true)'
    - 'val migration1to2 = Migration(1, 2) { db -> db.execSQL("ALTER TABLE users ADD COLUMN age INTEGER") }'
    - '@Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun upsert(user: User)'
    - '.allowMainThreadQueries().build()'
    - '@Dao interface UserDao {'
    - 'val query = SimpleSQLiteQuery("SELECT * FROM users WHERE name = ''$name''")'
sources:
  - https://developer.android.com/training/data-storage/room/migrating-db-versions
  - https://developer.android.com/training/data-storage/room/accessing-data
  - https://www.sqlite.org/lang_conflict.html
  - https://developer.android.com/jetpack/androidx/releases/room3
---
- **Version bump without migration**: raising `@Database(version = …)` without a `Migration`/`AutoMigration` path → `IllegalStateException` on the first open after the update. Fix: add migrations (keep `exportSchema = true`) and test them with `MigrationTestHelper`.
- **Destructive fallback**: `fallbackToDestructiveMigration(…)` or `…OnDowngrade()` in release builds → every schema change without a migration path silently wipes user data. Fix: real migrations; limit with `fallbackToDestructiveMigrationFrom(...)`.
- **REPLACE deletes**: `@Insert(onConflict = REPLACE)` on an existing key deletes the row first → `ON DELETE CASCADE` children removed and the rowid changes. Fix: `@Upsert` (Room 2.5+) or `@Update`.
- **Main-thread queries**: blocking DAO calls on the main thread throw `IllegalStateException`; `allowMainThreadQueries()` hides it → jank and ANR (the option is gone in Room 3). Fix: `suspend`/`Flow` DAO functions.
- **Several instances**: building the database per repository or screen → separate invalidation trackers (observers miss other instances' writes), extra connections, `database is locked`. Fix: one singleton instance.
- **Unguarded multi-step writes**: delete-then-insert or read-modify-write across several DAO calls without `@Transaction`/`withTransaction` (Room 3 `withWriteTransaction`) → partial updates on failure, readers see intermediate state. Fix: one transaction.
- **String-built queries**: `SimpleSQLiteQuery("… WHERE name = '$name'")` or `@RawQuery` with interpolated input → SQL injection. Fix: `?` placeholders with bind args.
