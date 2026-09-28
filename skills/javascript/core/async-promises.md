---
name: Floating promises and async misuse
description: Promises used as values, async callbacks handed to sync iterators, rejection handlers attached too late, return vs return await inside try, async Promise executors and broken then-chains.
priority: 70
tags: [CWE-252, CWE-755]
activation:
  content:
    - '\basync\b'
    - '\bawait\b'
    - '\.then\s*\('
    - '\bnew\s+Promise\s*\('
  examples:
    - 'async function loadUser(id) { return db.find(id); }'
    - 'const user = await loadUser(id);'
    - 'fetchData().then(data => render(data));'
    - 'const p = new Promise((resolve, reject) => { resolve(42); });'
checks:
  - id: async-foreach
    language: [TypeScript, Tsx, JavaScript]
    message: async callback passed to forEach — forEach does not await it, so the loop finishes before the work and its rejections go unhandled
    severity: major
    confidence: 0.6
    rule:
      any:
        - pattern: $A.forEach(async ($$$P) => $$$B)
        - pattern: $A.forEach(async $P => $$$B)
        - pattern: $A.forEach(async function ($$$P) { $$$B })
    examples:
      - 'items.forEach(async (item) => { await save(item); });'
      - 'ids.forEach(async id => remove(id));'
  - id: async-promise-executor
    language: [TypeScript, Tsx, JavaScript]
    message: async Promise executor — an error thrown inside becomes a separate unhandled rejection and the outer promise never settles
    severity: major
    confidence: 0.7
    rule:
      any:
        - pattern: new Promise(async ($$$P) => $$$B)
        - pattern: new Promise(async function ($$$P) { $$$B })
    examples:
      - 'const p = new Promise(async (resolve) => { resolve(await load()); });'
sources:
  - https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise
  - https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/async_function
  - https://nodejs.org/api/cli.html#--unhandled-rejectionsmode
---
- **Promise used as a value**: an async call without `await` in a condition, comparison, return or payload (`if (canEdit(u))`, `JSON.stringify(load())`) → always truthy / serialized as `{}`; its rejection goes unhandled (Node ≥15 exits by default). Fix: `await` it.
- **Async callback in a sync iterator**: `forEach`, `filter`, `some`, `find`, `reduce` never await; `filter(async …)` keeps every item (a Promise is truthy) → code continues before the work ends, errors unhandled. Fix: `for…of` + `await` or `Promise.all(items.map(…))`.
- **Handler attached too late**: `const p = a(); await b(); await p;` → if `p` rejects while `b()` is pending it is reported as unhandled (crashes Node) although awaited later. Fix: `await Promise.all([a(), b()])`.
- **`return promise` inside `try`**: returning without `await` from `try`/`catch` → the rejection bypasses `catch`, and `finally` (release lock, close connection) runs before the operation completes. Fix: `return await` inside try blocks.
- **Async Promise executor**: `new Promise(async (resolve, reject) => …)` → an error thrown inside becomes a separate unhandled rejection and the outer promise never settles (hang). Fix: a plain async function, or try/catch calling `reject`.
- **Broken chains**: `.then(() => { save(); })` without `return` doesn't wait for `save()` and loses its error; a `.catch` before later `.then`s turns failures into success. Fix: return inner promises, put `.catch` last.
