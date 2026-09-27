---
name: Throwing and handling errors
description: Non-Error throws, causes dropped when wrapping, finally overriding results, Error objects that serialize to {}, and catch blocks that throw on unexpected error shapes.
priority: 60
tags: [CWE-755, CWE-390]
activation:
  content:
    - '\bthrow\s'
    - '\bcatch\s*[({]'
    - '\.catch\s*\('
    - '\bnew\s+\w*Error\s*\('
    - '\bfinally\s*\{'
    - '\bPromise\.reject\s*\('
sources:
  - https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error/cause
  - https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/try...catch#the_finally_block
  - https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error#instance_properties
---
- **Throwing non-Errors**: `throw 'failed'`, `throw { code }`, `Promise.reject('x')` → no stack trace, `err.message` undefined downstream, `instanceof Error` branches skip them. Fix: throw `Error` subclasses with `name` set.
- **Cause dropped when wrapping**: `catch (e) { throw new Error('save failed') }` discards the original error and its stack. Fix: `new Error(msg, { cause: e })` (ES2022) and log the cause chain.
- **`finally` overrides**: a `return` in `finally` swallows the exception from `try`/`catch`; a `throw` in `finally` replaces it. Fix: no `return`/`throw` in `finally`.
- **Errors serialize to `{}`**: `message`, `stack` and `cause` are non-enumerable → `JSON.stringify(err)`, `{...err}` and `res.json({ error: err })` produce `{}`. Fix: map `{ name, message, code }` explicitly; never send `stack` to clients.
- **Catch blocks that throw**: handlers dereferencing assumed shapes (`e.response.status`, `e.message.includes(…)`) throw `TypeError` for network errors or non-Error values → the original error is masked and the fallback never runs. Fix: narrow `unknown` first.
