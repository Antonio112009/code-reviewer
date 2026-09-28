---
name: Async views and ORM
description: Django async-view defects — sync ORM and lazy relation access raising SynchronousOnlyOperation, transactions in async code, sync_to_async misuse, persistent connections under ASGI and iterator types for streaming responses.
priority: 64
activation:
  content:
    - '\basync\s+def\s+(?:get|post|put|patch|delete|dispatch|\w*view\w*)\s*\('
    - '\b(?:sync_to_async|async_to_sync|SynchronousOnlyOperation|DJANGO_ALLOW_ASYNC_UNSAFE)\b'
    - '\bawait\s+\w+(?:\.\w+)*\.a(?:get|create|save|delete|update|count|exists|first|last|filter)\w*\('
    - '\brequest\.auser\(|\bStreamingHttpResponse\(|\bCONN_MAX_AGE\b'
  examples:
    - 'async def get(self, request):'
    - 'result = await sync_to_async(compute)()'
    - 'order = await Order.objects.aget(pk=pk)'
    - 'user = await request.auser()'
sources:
  - https://docs.djangoproject.com/en/stable/topics/async/
  - https://docs.djangoproject.com/en/stable/ref/request-response/#streaminghttpresponse-objects
  - https://docs.djangoproject.com/en/stable/ref/databases/#connection-pool
---
- **Sync ORM in async code**: `Model.objects.get()`, iterating a queryset or `obj.save()` inside `async def` raises `SynchronousOnlyOperation`. Fix: `aget()`, `async for`, `asave()`, or one `sync_to_async` call.
- **Lazy loads in async code**: `obj.author.name`, iterating `obj.tags.all()` or reading `request.user` fire sync queries. Fix: `select_related`/`prefetch_related` up front, `await request.auser()` (5.0+).
- **Transactions**: `transaction.atomic()` does not work in async mode. Fix: put the transactional unit in one sync function called via `sync_to_async`.
- **thread_sensitive=False with the ORM**: runs in a new thread with its own connection, outside the request's transaction and connection cleanup. Fix: keep the default `thread_sensitive=True`.
- **Chatty adapters**: `sync_to_async` wrapped around each row or call in a loop multiplies context switches. Fix: wrap the whole loop once.
- **Persistent connections under ASGI**: docs require `CONN_MAX_AGE = 0` in async mode (persistent per-thread connections pile up). Fix: backend pooling (PostgreSQL `OPTIONS["pool"]`, 5.1+) or an external pooler.
- **Streaming iterator type**: a sync generator given to `StreamingHttpResponse` under ASGI (or async under WSGI) is fully buffered with only a warning; `FileResponse` is read fully under ASGI.
- **Sync middleware in an async stack**: one sync middleware forces a thread per request, capping SSE or long-poll concurrency.
