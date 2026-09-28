---
name: Request context and shared state
description: Per-request data kept in module scope, singletons or implicit globals, AsyncLocalStorage enterWith leaks, context lost through callbacks, pools and emitters, and mutable stores shared by parallel branches.
priority: 60
tags: [CWE-362, CWE-488]
activation:
  content:
    - '\bAsyncLocalStorage\b|\bAsyncResource\b|\basync_hooks\b'
    - '\.(?:getStore|enterWith)\s*\('
    - '^(?:export\s+)?let\s+(?:current|active|request|req|user|tenant|session|ctx|context)[A-Z]?\w*\b'
    - '\bglobal(?:This)?\.(?:user|currentUser|tenant|request|req|session|ctx|context)\s*='
    - '^\s*(?:this\.)?(?:current|active)(?:User|Tenant|Request|Session|Transaction)\s*='
  examples:
    - 'const als = new AsyncLocalStorage();'
    - 'const store = als.getStore();'
    - 'let currentUser = null;'
    - 'globalThis.currentUser = user;'
    - 'this.currentUser = user;'
sources:
  - https://nodejs.org/api/async_context.html#class-asynclocalstorage
  - https://nodejs.org/api/async_context.html#asynclocalstorageenterwithstore
  - https://nodejs.org/api/async_context.html#troubleshooting-context-loss
---
- **Request data in shared scope**: current user, tenant or transaction kept in module variables, singleton fields, `globalThis` or an undeclared (sloppy-mode global) assignment → concurrent requests overwrite each other and leak data across users. Fix: pass it explicitly or `AsyncLocalStorage.run`.
- **`enterWith` leaks**: `als.enterWith(store)` applies to the rest of the synchronous execution and everything scheduled from it - set in middleware or an event handler, it bleeds into later listeners or requests. Fix: `als.run(store, fn)`.
- **Context loss**: callback APIs, custom thenables, connection pools, batching loaders (DataLoader) or emitters created outside the request run callbacks in the creator's context → `getStore()` is `undefined` or another request's store. Fix: `AsyncLocalStorage.bind`/`AsyncResource.bind`, promisified APIs.
- **Mutable shared store**: parallel branches (`Promise.all`) mutating the same store object (`store.step = …`) overwrite each other's values. Fix: immutable stores; a nested `run()` per branch.
