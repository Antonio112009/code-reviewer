---
name: Bulk operations, hooks and counts
description: Sequelize operations that skip hooks or validation or return misleading data — static update/destroy, bulkCreate validate:false, empty where objects, findAndCountAll with includes, raw results and DECIMAL/BIGINT strings, and findOrCreate transactions.
priority: 64
tags: [CWE-20, CWE-1284]
activation:
  content:
    - "\\.(?:bulkCreate|update|destroy|findAndCountAll|findOrCreate|upsert|increment|decrement|findAll)\\s*\\("
    - "\\bindividualHooks\\b|\\braw\\s*:\\s*true\\b|\\bparanoid\\b|\\bdistinct\\s*:|\\bvalidate\\s*:\\s*(?:true|false)\\b|\\btruncate\\s*:"
    - "\\b(?:before|after)(?:Create|Update|Destroy|Save|BulkCreate|BulkUpdate|BulkDestroy|Validate)\\b"
  examples:
    - 'await User.bulkCreate(rows, { validate: true, individualHooks: true })'
    - 'User.beforeBulkCreate((users, options) => { options.individualHooks = true })'
sources:
  - https://sequelize.org/docs/v6/other-topics/hooks/
  - https://sequelize.org/api/v6/class/src/model.js~model
  - https://sequelize.org/docs/v6/core-concepts/model-querying-finders/
---
- **Bulk hooks**: static `Model.update()`/`destroy()` run only bulk hooks — per-row `beforeUpdate`/`beforeSave` (password hashing, audit) are skipped unless `individualHooks: true`, and raw queries skip hooks entirely. Fix: instance saves, or `individualHooks` for small sets.
- **bulkCreate validation**: `bulkCreate` defaults to `validate: false` with per-row hooks off → invalid or unhashed rows are inserted. Fix: `validate: true, individualHooks: true`, or validate first.
- **Empty where**: `destroy({ where: {} })`/`update(values, { where: {} })` affect every row, and where objects assembled from optional input easily end up empty; `truncate: true` or `force: true` on paranoid models hard-delete. Fix: require scoping keys.
- **findAndCountAll with include**: `count` counts joined rows (inflated totals, broken pagination) unless `distinct: true`; with `limit`, filters on included models apply after the parent subquery is limited → short pages. Fix: `distinct: true`, filter on the parent.
- **raw results and numbers**: `raw: true` returns flat `'assoc.field'` keys (unless `nest: true`) and skips getters and virtual fields; `DECIMAL`/`BIGINT` values arrive as strings on PostgreSQL and MySQL. Fix: `nest`, explicit numeric conversion.
- **findOrCreate**: it opens its own transaction unless you pass one — inside another transaction without `transaction: t` it runs outside and can block on that transaction's locks; concurrent calls still race on non-unique columns. Fix: pass `t`, unique index.
