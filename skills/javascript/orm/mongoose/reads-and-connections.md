---
name: Reads, population and connections
description: Mongoose read and connection pitfalls — lean() skipping toJSON transforms and getters, unselected or unbounded populate, syncIndexes dropping indexes, autoIndex and command buffering in production, transactions without sessions and reconnects in serverless or hot reload.
priority: 62
tags: [CWE-200, CWE-400]
activation:
  content:
    - "\\.(?:lean|populate|cursor)\\s*\\("
    - "\\bsyncIndexes\\s*\\(|\\bautoIndex\\b|\\bbufferCommands\\b|\\bbufferTimeoutMS\\b|\\bmaxPoolSize\\b"
    - "\\bmongoose\\.(?:connect|createConnection|startSession|set|model)\\s*\\(|\\bstartSession\\s*\\(|\\bwithTransaction\\s*\\(|\\bsession\\s*:"
    - "\\btoJSON\\b|\\btransform\\s*:"
  examples:
    - 'const users = await User.find().lean();'
    - 'await mongoose.connect(uri, { autoIndex: false, maxPoolSize: 10 });'
    - 'userSchema.set("toJSON", { transform: (doc, ret) => { delete ret.password; } });'
sources:
  - https://mongoosejs.com/docs/tutorials/lean.html
  - https://mongoosejs.com/docs/api/model.html
  - https://mongoosejs.com/docs/connections.html
  - https://mongoosejs.com/docs/transactions.html
---
- **lean() skips transforms**: lean results are plain objects — `toJSON` transforms, getters, virtuals and defaults don't apply, so fields hidden only by a transform (password, tokens) are sent. Fix: `select: false` in the schema or `.select('-password')`.
- **populate**: `populate('author')` without `select` copies whole referenced documents (e-mails, hashes) into responses; populating large arrays without `perDocumentLimit`/`limit` loads unbounded data. Fix: `populate({ path, select, perDocumentLimit })`.
- **Index management**: `Model.syncIndexes()` drops every index not declared in the schema (including ones added by DBAs), and `autoIndex` (default on) builds indexes at startup, degrading production. Fix: `autoIndex: false` in prod; indexes via migrations.
- **Buffering hides outages**: by default operations issued while disconnected are buffered and fail only after `bufferTimeoutMS` (10 s), so requests hang instead of failing fast; initial `connect()` errors must be handled. Fix: `bufferCommands: false`, readiness checks.
- **Transactions**: every operation inside `withTransaction`/`connection.transaction()` needs `{ session }` (unless `transactionAsyncLocalStorage`, 8.4+); parallel operations (`Promise.all`) aren't supported, and callbacks may retry, repeating side effects.
- **Reconnects and re-registration**: `mongoose.connect()` per serverless invocation or `mongoose.model('User', schema)` on every hot reload → connection storms or `OverwriteModelError`. Fix: cache the connection on `globalThis`; `models.User ?? model('User', schema)`.
