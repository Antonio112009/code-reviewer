---
name: MongoDB
description: MongoDB and Mongoose defects such as operator and server-side JS injection, skipped middleware and validators, pre-update return values, sessions not passed to transactions, upsert races, dropped undefined filters, ObjectId mix-ups and 16 MB document growth.
category: database
priority: 62
tier: essential
tags:
  - CWE-943
  - CWE-362
  - CWE-400
  - OWASP-A05
activation:
  stack:
    - db.mongodb
    - orm.mongoose
  languages:
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
    - (?:from\s+|require\(\s*)['"](?:mongodb|mongoose|@typegoose/typegoose|@nestjs/mongoose)['"]
    - "\\b(?:import|from)\\s+(?:pymongo|motor|mongoengine|beanie|bson)\\b|go\\.mongodb\\.org/mongo-driver|\\bMongoDB\\.Driver\\b|\\bIMongo(?:Collection|Database|Client)\\b|\\bcom\\.mongodb\\b|\\bMongo(?:Template|Repository|Client|Collection)\\b|\\bMongoid::Document\\b|\\bMongoDB\\\\(?:Client|Collection)\\b|\\bmongodb::"
    - \bnew\s+(?:mongoose\.)?Schema\s*[(<]|\bmongoose\.(?:model|connect|startSession|Types)\b|\bSchema\.Types\.ObjectId\b|\bObjectId\(|\.(?:findByIdAndUpdate|findOneAndUpdate|findOneAndReplace|countDocuments|insertMany|bulkWrite|withTransaction)\(
    - "[{,]\\s*['\"]?\\$(?:set|setOnInsert|unset|inc|push|addToSet|pull|match|lookup|group|project|unwind|facet|in|nin|ne|gt|gte|lt|lte|regex|where|expr|elemMatch|or|and|exists)['\"]?\\s*:|['\"]\\$(?:set|push|inc|match|in|ne|or|regex|where)['\"]\\s*=>"
---
- **Query injection**: request values used directly as filter values accept objects (`{"$ne": null}`, PHP `x[$ne]=`, Python dicts); input reaching `$where`/`$function` or unescaped `$regex` → auth bypass, JS execution, ReDoS. Fix: coerce types, `sanitizeFilter`, escape regexes.
- **Mongoose bypasses**: `updateOne`/`findOneAndUpdate`, `insertMany` and `bulkWrite` skip `save` middleware, and updates skip validators unless `runValidators: true` → unhashed passwords, missing audit, invalid data. Fix: load and `save()`, or query middleware.
- **Pre-update results**: `findOneAndUpdate` returns the old document unless `returnDocument: 'after'` (Mongoose: `new: true`); Node driver 6+ returns the document, not `{ value }` → stale data, `undefined` after upgrades. Fix: set the option explicitly.
- **Transactions**: operations inside `withTransaction` without `{ session }` run outside it and survive aborts; the callback is retried on transient errors → duplicated side effects. Fix: pass the session (Mongoose `transactionAsyncLocalStorage`), act after commit.
- **Upsert races**: `upsert: true` or find-then-insert without a unique index on the filter keys → concurrent duplicates; with one, E11000 surfaces unless the filter is equality on exactly those keys. Fix: unique index, retry 11000.
- **Missing filter values**: Mongoose drops `undefined` filter keys (`findOne({ _id: undefined })` returns the first document) and the driver sends `null`, matching absent fields → other users' data, `deleteMany` on everything. Fix: validate ids first.
- **ObjectId vs string**: drivers never cast (`{ _id: "65f…" }` and `$lookup` between string and ObjectId fields match nothing); `===` compares references; `new ObjectId(bad)` throws → empty results, 500s. Fix: validate and convert once, `.equals()`.
- **16 MB documents**: unbounded `$push` arrays, embedded logs, or `$group`/`$lookup` building arrays grow documents toward the 16 MB cap → failed writes and pipelines. Fix: `$slice`, bucketing, separate collections.
