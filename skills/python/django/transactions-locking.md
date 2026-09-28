---
name: Transactions and row locking
description: Django transaction.atomic, on_commit and select_for_update pitfalls — swallowed IntegrityError, side effects before commit, locks outside transactions, lost updates and get_or_create races.
priority: 66
tags: [CWE-362, CWE-367]
activation:
  content:
    - '\b(?:atomic|on_commit|select_for_update|get_or_create|update_or_create|aget_or_create|aupdate_or_create|non_atomic_requests)\b'
    - '\bATOMIC_REQUESTS\b'
    - '\bIntegrityError\b'
    - '\.\w+\s*[-+]=\s*[^\n]{1,80}\n[^\n]{0,80}\.save\('
  examples:
    - 'with transaction.atomic():'
    - 'ATOMIC_REQUESTS = True'
    - 'except IntegrityError:'
    - "order.stock -= 1\norder.save()"
sources:
  - https://docs.djangoproject.com/en/stable/topics/db/transactions/
  - https://docs.djangoproject.com/en/stable/ref/models/querysets/#select-for-update
  - https://docs.djangoproject.com/en/stable/ref/models/querysets/#get-or-create
---
- **Error caught inside atomic**: `except IntegrityError` inside an `atomic()` block (or an `ATOMIC_REQUESTS` view) leaves the transaction broken → `TransactionManagementError` on the next query. Fix: wrap only the risky statement in a nested `atomic()` and catch outside it.
- **Side effects before commit**: emails, webhooks, cache writes or external API calls inside `atomic()` happen even on rollback, and consumers may not see the rows yet. Fix: `transaction.on_commit(...)`, `robust=True` for independent callbacks.
- **Commit assumed but nested**: a helper's `atomic()` inside a caller's transaction is only a savepoint; the outer rollback discards it. Fix: `atomic(durable=True)` where commit is required.
- **Lock outside a transaction**: `select_for_update()` evaluated in autocommit raises `TransactionManagementError` (tests in `TestCase` still pass); SQLite ignores it; nullable `select_related` joins raise `NotSupportedError`. Fix: evaluate inside `atomic()`, use `of=("self",)`.
- **Lost update**: read-modify-write (`obj.stock -= n; obj.save()`) from concurrent requests overwrites. Fix: `update(stock=F("stock") - n)` with a filter guard, or `select_for_update()`.
- **get_or_create race**: without a unique constraint on the lookup fields, concurrent calls insert duplicates → later `MultipleObjectsReturned`. Fix: `UniqueConstraint`; `defaults` are not part of the lookup.
- **Streaming under ATOMIC_REQUESTS**: `StreamingHttpResponse` generators run after the view's transaction ended → their writes are not atomic.
