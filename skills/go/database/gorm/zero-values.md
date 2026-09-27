---
name: GORM zero values in conditions, updates and creates
description: GORM ignoring zero-valued fields in struct conditions and Updates, Save overwriting and upserting, default tags swallowing false/0 on Create, and global updates/deletes in jinzhu/gorm v1.
priority: 70
tags: [CWE-639, CWE-284, CWE-915]
activation:
  content:
    - '\.(?:Where|Not|Or|First|Find|Take|Last|FirstOrCreate|FirstOrInit|Updates|Assign|Attrs|Delete)\(\s*&?[A-Z]\w{0,40}\{'
    - '\.(?:Updates|Save|Create|Update)\('
    - 'gorm:"[^"\n]{0,80}default:'
sources:
  - https://gorm.io/docs/query.html
  - https://gorm.io/docs/update.html
  - https://gorm.io/docs/create.html
---
- **Struct conditions drop zero fields**: `db.Where(&User{Email: in.Email}).First(&u)` ignores `""`/`0`/`false` fields → an empty email or zero tenant removes the filter and returns another user's row. Fix: `Where("email = ?", v)` or map conditions; reject empty input.
- **Updates(struct) skips zeros**: `Updates(User{Active: false, Credits: 0})` silently leaves those columns unchanged → flags and balances can't be cleared; `Select("*")` plus Updates writes every column, including ones the request never sent. Fix: `map[string]any` or `Select` explicit columns.
- **Save overwrites and upserts**: `Save(&u)` writes all columns (zeroing fields a partial request omitted) and inserts when no row matches the primary key → client-chosen IDs create rows; concurrent edits are lost. Fix: `Updates` with `Select`, check `RowsAffected`.
- **default tags**: fields tagged `gorm:"default:…"` skip zero values on Create (`Active: false` stored as the default `true`). Fix: pointer fields or `sql.NullBool`.
- **Global writes (v1)**: jinzhu/gorm v1 ran `Delete`/`Updates` without conditions on the whole table; v2 returns `ErrMissingWhereClause` unless `AllowGlobalUpdate`. Fix: check primary keys/conditions before writes; never enable AllowGlobalUpdate in request paths.
