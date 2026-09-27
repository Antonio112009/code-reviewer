---
name: Dependencies and yield lifetimes
description: FastAPI dependency defects — yield dependencies that swallow exceptions, resource lifetimes that changed in 0.106, 0.118 and 0.121 (scope), per-request dependency caching and decorator dependencies whose return values are discarded.
priority: 66
activation:
  content:
    - '\bDepends\(|\bSecurity\('
    - '^[ \t]*yield\b'
    - '\bdependencies\s*=\s*\['
    - '\buse_cache\s*=|\bscope\s*=\s*["''](?:function|request)["'']'
sources:
  - https://fastapi.tiangolo.com/tutorial/dependencies/dependencies-with-yield/
  - https://fastapi.tiangolo.com/advanced/advanced-dependencies/
  - https://fastapi.tiangolo.com/tutorial/dependencies/sub-dependencies/
  - https://fastapi.tiangolo.com/release-notes/
---
- **Swallowed exceptions (0.110+)**: `try: yield db / except Exception: db.rollback()` without `raise` hides the error → the client gets a 500 with nothing logged, or FastAPI raises "Response not awaited". Fix: re-raise, or raise an `HTTPException`.
- **Exit timing by version**: the code after `yield` runs after the response is sent on <0.106 and on 0.118+, but before it on 0.106–0.117 → sessions used by a `StreamingResponse` or `BackgroundTasks` were already closed there. Check the pinned version.
- **scope="function" (0.121+)**: `Depends(dep, scope="function")` closes the resource before the response is sent; streaming bodies or background tasks that still use it fail. Keep the default `scope="request"` for them.
- **Held resources**: with request scope, a DB session opened only for an auth check stays checked out until a slow stream or background task ends → pool exhaustion. Fix: close early, or `scope="function"` on 0.121+.
- **Per-request caching**: the same dependency declared twice (directly and via a sub-dependency) runs once and shares its value; side-effecting or stateful dependencies that must run each time need `use_cache=False`.
- **Discarded return values**: dependencies in `dependencies=[Depends(...)]` (decorator, router or app) run but their return values are dropped; code expecting the user or session from them must declare a parameter.
