---
name: Query selector injection
description: Mongoose NoSQL injection and filter-scope defects — request objects in filters ($ne/$gt/$regex), sanitizeFilter and its $nor gap, $where and populate-match CVEs, regexes built from input, strictQuery true dropping unknown keys and CastErrors from malformed ids.
priority: 70
tags: [CWE-943, CWE-1333, CWE-94]
activation:
  content:
    - "\\.(?:find|findOne|findById|findOneAndUpdate|findOneAndDelete|updateOne|updateMany|deleteOne|deleteMany|countDocuments|exists|aggregate)\\s*\\("
    - "['\"]?\\$(?:where|regex|expr|function|accumulator|nor)\\b"
    - "\\bsanitizeFilter\\b|\\bmongoose\\.trusted\\s*\\(|\\bstrictQuery\\b|\\bnew\\s+RegExp\\s*\\("
    - "\\bpopulate\\s*\\(\\s*\\{|\\bmatch\\s*:"
  examples:
    - 'const user = await User.findOne({ email, password: req.body.password });'
    - 'const users = await User.find({ $where: "this.credits > this.debits" });'
    - 'const re = new RegExp(req.query.q);'
    - 'await Order.find({ userId }).populate({ path: "items", match: { active: true } });'
sources:
  - https://mongoosejs.com/docs/tutorials/query_casting.html
  - https://mongoosejs.com/docs/migrating_to_6.html
  - https://github.com/advisories/GHSA-wpg9-53fq-2r8h
  - https://www.opswat.com/blog/technical-discovery-mongoose-cve-2025-23061-cve-2024-53900
---
- **Objects as values**: `User.findOne({ email, password: req.body.password })` with JSON or qs input `{ "$ne": null }` matches any user; `$gt`, `$regex` and `$in` work alike. Fix: coerce to primitives, or `sanitizeFilter: true` plus `mongoose.trusted()` for intended operators.
- **sanitizeFilter gaps**: it didn't neutralise operators nested in `$nor` before 6.13.9/7.8.9/8.22.1/9.1.6 (CVE-2026-42334) and never covers `aggregate()` `$match` stages. Fix: upgrade; validate pipeline inputs.
- **JavaScript execution**: `$where`, `$function` or `$accumulator` with input run code on the server; `populate({ match })` accepted `$where` until 8.9.5/7.8.4/6.13.6 (CVE-2024-53900, CVE-2025-23061).
- **Regex from input**: `new RegExp(req.query.q)` or `{ $regex: input }` enables ReDoS on the database and wildcard enumeration. Fix: escape input, anchored prefixes, text indexes.
- **strictQuery: true**: `mongoose.set('strictQuery', true)` (common since the v6 warning) strips filter keys missing from the schema — a typo turns `deleteMany({ userID })` into `deleteMany({})`. Fix: `strictQuery: 'throw'`.
- **Malformed ids**: `findById(req.params.id)` with an invalid ObjectId throws `CastError` (500s); Mongoose 9's `isValidObjectId()` returns `false` for numbers. Fix: validate ids (`isObjectIdOrHexString`) → 400/404.
