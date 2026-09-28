---
name: Auth dependencies and route exposure
description: FastAPI authorization gaps — OAuth2PasswordBearer/HTTPBearer that only extract tokens, auto_error=False without rejection, declared but unchecked security scopes, per-route auth, mounted apps outside router dependencies, public docs and route-order shadowing.
priority: 74
tags: [CWE-862, CWE-287, A01:2025, A07:2025]
activation:
  content:
    - '\b(?:OAuth2PasswordBearer|OAuth2AuthorizationCodeBearer|HTTPBearer|HTTPBasic|APIKeyHeader|APIKeyCookie|APIKeyQuery|SecurityScopes|Security)\b'
    - '\bauto_error\s*=\s*False\b'
    - '\binclude_router\(|\bAPIRouter\(|\.mount\('
    - '\b(?:docs_url|redoc_url|openapi_url)\s*='
    - '@\w+\.(?:get|post|put|patch|delete)\(\s*["''][^"''\n]{0,80}\{'
  examples:
    - 'oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token", auto_error=False)'
    - 'app.include_router(admin_router, dependencies=[Depends(get_admin)])'
    - 'app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)'
    - '@app.get("/users/{user_id}")'
sources:
  - https://fastapi.tiangolo.com/tutorial/security/first-steps/
  - https://fastapi.tiangolo.com/advanced/security/oauth2-scopes/
  - https://fastapi.tiangolo.com/advanced/sub-applications/
  - https://fastapi.tiangolo.com/tutorial/path-params/#order-matters
---
- **Token extracted, not verified**: `OAuth2PasswordBearer`, `HTTPBearer` and `APIKey*` only read the header; a dependency that returns the raw token without decoding, checking signature, expiry and the user record authenticates anyone.
- **auto_error=False**: the scheme returns `None` when credentials are missing; handlers that do not reject `None` serve anonymous requests.
- **Scopes declared, never checked**: `Security(dep, scopes=[...])` only collects scopes into `SecurityScopes`; nothing is enforced unless the dependency compares `security_scopes.scopes` with the token's scopes.
- **Auth added per route**: protecting endpoints one by one instead of `APIRouter(dependencies=[...])` / `include_router(..., dependencies=[...])` lets new routes ship public.
- **Mounted apps are separate**: `app.mount()` sub-applications, `StaticFiles` and plain Starlette routes do not get router- or app-level `dependencies` → unauthenticated paths.
- **Public docs**: `/docs`, `/redoc` and `/openapi.json` stay public unless `docs_url`, `redoc_url` and `openapi_url` are `None` or protected → internal endpoints and schemas exposed.
- **Route shadowing**: `/users/{user_id}` declared before `/users/me` captures `me` → wrong handler and dependencies (or 422). Fix: static paths first.
- **Status code change (0.122+)**: missing credentials now yield 401 instead of 403 from the security classes; clients or tests keyed on 403 break.
