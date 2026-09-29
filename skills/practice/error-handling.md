---
name: Error handling
description: Failure-path defects — swallowed errors, over-broad catches, lost causes, unchecked failure results, escaping rejections, partial writes, masked errors, fragile handlers and unsafe retries.
category: practice
priority: 60
tier: essential
tags:
  - CWE-390
  - CWE-391
  - CWE-252
  - CWE-755
  - OWASP-A10
activation:
  languages:
    - typescript
    - javascript
    - python
    - php
    - java
    - kotlin
    - csharp
    - go
    - rust
    - c
    - cpp
    - ruby
    - swift
    - scala
    - dart
    - elixir
    - objective-c
    - vue
    - svelte
    - groovy
  content:
    - \bcatch\s*(?:[({]|let\b|is\b)|\.catch\(|\bexcept\s*(?:[(*:]|[A-Za-z_][\w.]*\s*(?:[,:]|as\b))|\brescue\b|\bfinally\s*[{:]|\bensure\s*\n|\bon\s+\w*(?:Exception|Error)\b
    - \berr\s*!=\s*nil\b|\berrors\.(?:Is|As|Join)\(|\bfmt\.Errorf\(|\brecover\(\)|\bpanic\(
    - \bmap_err\(|\.ok\(\)|\blet\s+_\s*=|\banyhow::|\bthiserror\b|\bunwrap_or(?:_default|_else)?\(
    - \bretr(?:y|ies|ying)\b|\bbackoff\b|\bRetry-After\b|\.on\(\s*['"]error['"]|\.pipe\(\s*[\w.$]+\s*[,)]|\bPromise\.allSettled\(|\b(?:next|callback|cb|done)\(\s*err\b
  examples:
    - 'try { risky(); } catch (err) { logger.warn(err); }'
    - 'if err != nil { return fmt.Errorf("save: %w", err) }'
    - 'let value = result.map_err(|e| AppError::from(e))?;'
    - 'await retry(() => fetchWithBackoff(url), { retries: 3 });'
checks:
  - id: empty-catch
    language: [Java, TypeScript, Tsx, JavaScript, CSharp]
    message: empty catch block — the error disappears without a trace and the code continues as if the call succeeded (a comment saying why would make the intent visible)
    severity: minor
    category: error-handling
    confidence: 0.5
    rule:
      kind: catch_clause
      has:
        field: body
        regex: '^\{\s*\}$'
    examples:
      - "class Sync { void run() { try { upload(); } catch (IOException e) {} } }"
    counterexamples:
      - "class Sync { void run() { try { upload(); } catch (IOException e) { /* best effort: retried next tick */ } } }"
      - "class Sync { void run() { try { upload(); } catch (IOException e) { log.warn(e); } } }"
---
- **Swallowed error**: empty `catch`, `except: pass`, `_ = err`, or a handler that only logs and returns `null`/`[]`/defaults → callers continue on bad data; outages look like "no results". Fix: handle or rethrow.
- **Over-broad catch**: `except Exception`, `rescue => e` or `catch (Throwable)` around large blocks, mapping every failure to one outcome ("not found", retry, 400) → bugs misreported, retried or hidden. Fix: narrow types near the call.
- **Lost cause**: new error without `cause` or inner exception, C# `throw ex;` resetting the stack, Go `%v` instead of `%w`, `map_err(|_| …)` → root cause lost, `errors.Is`/`As` stop matching. Fix: wrap the original.
- **Unchecked results**: status or exit codes, `ok` flags, affected-row counts, per-item `errors` in bulk or GraphQL responses, `allSettled` rejections never inspected → failures counted as success. Fix: check each result, fail loudly.
- **Escaping rejection**: `return promise` without `await` inside `try`, `.then()` without `.catch`, streams or emitters without `'error'` handlers, `.pipe()` instead of `pipeline()` → catch and cleanup bypassed, process crash. Fix: `return await`, `pipeline`.
- **Partial failure**: multi-step writes (DB + file + API + message) or batch loops without transaction, compensation or resumable steps → half-applied state after the first error. Fix: transaction, outbox, idempotent resume.
- **Masked error**: `return`/`throw` inside `finally`, or cleanup and rollback code that throws while handling an error → original exception replaced, root cause lost. Fix: no control flow in `finally`; guard cleanup.
- **Fragile handlers**: catch blocks assuming an error shape (`e.response.status` on axios network errors, `e.message` on thrown strings, `e.code` on unknown values) → a TypeError replaces the real error. Fix: narrow `unknown` first.
- **Bad retries**: retrying 4xx errors, non-idempotent calls or timed-out writes that may have succeeded; no cap, backoff, jitter or `Retry-After`; retries stacked across layers → duplicates, retry storms. Fix: classify errors; one capped layer.
