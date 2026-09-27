---
name: Updates, validation and middleware
description: Mongoose write paths that skip validation or hooks — update validators off by default, save middleware not run by updateOne/findOneAndUpdate/insertMany/bulkWrite, pre-update documents returned, raw request bodies as updates, unique indexes mistaken for validation and Mongoose 9 middleware changes.
priority: 66
tags: [CWE-20, CWE-915]
activation:
  content:
    - "\\.(?:updateOne|updateMany|findOneAndUpdate|findByIdAndUpdate|findOneAndReplace|replaceOne|insertMany|bulkWrite)\\s*\\("
    - "\\b(?:runValidators|returnDocument|setDefaultsOnInsert|updatePipeline|upsert)\\b|\\bnew\\s*:\\s*true\\b"
    - "\\.(?:pre|post)\\s*\\(\\s*['\"]"
    - "\\bunique\\s*:\\s*true\\b"
sources:
  - https://mongoosejs.com/docs/validation.html
  - https://mongoosejs.com/docs/middleware.html
  - https://mongoosejs.com/docs/api/model.html
  - https://mongoosejs.com/docs/migrating_to_9.html
---
- **Validators off for updates**: `updateOne`/`updateMany`/`findOneAndUpdate` skip schema validators unless `runValidators: true`, and then only for updated paths (with `this` being the query). Fix: `runValidators` (globally via plugin) or load, modify, `save()`.
- **Hooks skipped**: `pre('save')` logic (password hashing, slugs, audit) doesn't run for `updateOne`, `findOneAndUpdate`, `insertMany` (own hook) or `bulkWrite` (no middleware). Fix: matching query middleware, or `save()`.
- **Pre-update result**: `findOneAndUpdate`/`findByIdAndUpdate` return the document before the update by default → stale data returned or reused. Fix: `returnDocument: 'after'` (`new: true` is deprecated in Mongoose 9).
- **Body as update**: `updateOne(filter, req.body)` lets clients set any schema path (`role`, `balance`) and, unsanitised, operators such as `$inc`, `$unset` or `$rename`. Fix: build `$set` from allowlisted fields.
- **unique isn't validation**: `unique: true` only declares an index — duplicates surface as E11000 errors (500s) and aren't prevented at all when the index was never built. Fix: handle code 11000; create indexes via migrations.
- **Hook context and v9**: `this` is the query in `pre('updateOne')`/`pre('findOneAndUpdate')`; `pre('deleteOne')` is query middleware unless `{ document: true, query: false }`. Mongoose 9 no longer passes `next` to pre hooks — `function (next) { …; next() }` throws.
