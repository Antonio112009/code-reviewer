---
name: Lifespan, shared state and background tasks
description: FastAPI application-lifecycle defects — on_event handlers ignored next to lifespan, sub-application lifespans that never run, clients created at import or per request, per-worker module state, TestClient without lifespan and in-process BackgroundTasks used for durable work.
priority: 62
activation:
  content:
    - '\blifespan\b|\bon_event\(|\bapp\.state\.'
    - '\bBackgroundTasks?\b|\.add_task\('
    - '\b(?:httpx\.AsyncClient|aiohttp\.ClientSession|create_async_engine|AsyncClient)\('
    - '\bTestClient\('
  examples:
    - 'app = FastAPI(lifespan=lifespan)'
    - 'background_tasks.add_task(send_welcome_email, user.email)'
    - 'client = httpx.AsyncClient(base_url=settings.API_URL)'
    - 'with TestClient(app) as client:'
sources:
  - https://fastapi.tiangolo.com/advanced/events/
  - https://fastapi.tiangolo.com/tutorial/background-tasks/
  - https://starlette.dev/lifespan/
  - https://starlette.dev/release-notes/
---
- **on_event ignored**: with `FastAPI(lifespan=...)`, `@app.on_event("startup")`/`("shutdown")` handlers never run (all-or-nothing); `on_event` is deprecated and Starlette 1.0 removed its own. Fix: move the code into `lifespan`.
- **Sub-app lifespans skipped**: lifespan and startup handlers of applications attached with `app.mount()` never run → their pools and clients stay uninitialised.
- **Clients at import or per request**: `httpx.AsyncClient()`, engines or Redis clients created at import are never closed and may bind to another event loop; one per request discards pooling. Fix: create in `lifespan`, close on exit.
- **Per-worker state**: module-level dicts, caches, counters or connection registries exist once per worker process (`--workers`, multiple pods) → inconsistent limits and lost updates. Fix: Redis or the database.
- **TestClient without lifespan**: `TestClient(app)` used outside `with TestClient(app) as client:` never runs lifespan, so tests exercise uninitialised state.
- **BackgroundTasks are not a queue**: tasks run in the same worker after the response, are lost on restart or crash, never retry, and slow ones occupy the loop or thread pool. Fix: a real task queue for durable work.
