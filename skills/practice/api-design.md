---
name: API contracts
description: HTTP/RPC and webhook contract defects — breaking changes, stricter input, schema evolution, missing idempotency, mutating GETs, unstable pagination, wrong status codes, blind PATCH, lost updates and lossy numbers.
category: practice
priority: 52
tier: full
tags:
  - CWE-837
  - CWE-1068
  - OWASP-A06
activation:
  files:
    - "**/*.{proto,avsc}"
    - "**/*.{graphql,gql}"
    - "**/{openapi,swagger,asyncapi}*.{yaml,yml,json}"
    - "**/*.openapi.{yaml,yml,json}"
    - "**/{routes,routers,controllers,handlers,endpoints}/**/*.{ts,js,mjs,py,go,java,kt,cs,php,rb,rs,ex}"
    - "**/app/api/**/route.{ts,js}"
    - "**/pages/api/**/*.{ts,js}"
    - "**/{urls.py,routes.rb,api.php}"
    - "**/*{Controller,Endpoint,Resource}.{java,kt,cs,php}"
    - "**/*.{controller,resolver}.{ts,js}"
    - "**/*_controller.rb"
  content:
    - \b(?:app|\w*[rR]outer|server|fastify|routes)\.(?:get|post|put|patch|delete|all|route)\(\s*['"`]/
    - \.(?:GET|POST|PUT|PATCH|DELETE|Get|Post|Put|Patch|Delete|Handle|HandleFunc|Group|Route)\(\s*"(?:[A-Z]+ )?/|\bMap(?:Get|Post|Put|Patch|Delete|Group)\(
    - "@(?:Get|Post|Put|Patch|Delete|Controller|RestController|RequestMapping|GetMapping|PostMapping|PutMapping|PatchMapping|DeleteMapping|Path|GET|POST|PUT|DELETE)\\b"
    - "@(?:app|router|api|bp|blueprint)\\.(?:get|post|put|patch|delete|route|api_route)\\(|\\burlpatterns\\b|\\[(?:Http(?:Get|Post|Put|Patch|Delete)|Route|ApiController)\\b"
    - \bRoute::(?:get|post|put|patch|delete|resource|apiResource)\(|#\[Route\(|\bresources?\s+:\w+
    - \bexport\s+(?:async\s+)?function\s+(?:GET|POST|PUT|PATCH|DELETE)\b|\bexport\s+const\s+(?:GET|POST|PUT|PATCH|DELETE)\s*[:=]
    - \.status\(\d{3}\)|\breply\.code\(|\bWriteHeader\(|\bhttp\.Error\(|\b(?:ResponseEntity|HTTPException|JsonResponse|StatusCodes|HttpStatus)\b|[Ii]dempoten|\b(?:next_?[cC]ursor|page_?[tT]oken)\b|\bIf-Match\b|\bETag\b
    - "[Ww]ebhook|\\bconstructEvent\\(|\\bX-Hub-Signature|\\bsvix\\b|\\bStripe-Signature\\b"
  examples:
    - 'app.post("/orders", createOrder);'
    - 'app.MapGet("/orders/{id}", GetOrder);'
    - '@GetMapping("/orders/{id}")'
    - '@app.post("/orders")'
    - 'Route::post("/orders", [OrderController::class, "store"]);'
    - 'export async function POST(request: Request) {'
    - 'res.status(409).json({ error: "Idempotency-Key already used" });'
    - 'const event = stripe.webhooks.constructEvent(rawBody, sig, secret);'
---
- **Breaking change**: removed/renamed fields, endpoints, parameters or enum values; changed types, units, nullability or defaults; new required inputs or rejected unknown fields on existing endpoints → deployed clients break. Fix: additive changes, deprecate, version.
- **Schema evolution**: protobuf tag or type changed, deleted field not `reserved`, field moved into `oneof`, renames (break ProtoJSON), new enum values for strict decoders (`Codable`, Jackson) → failed or corrupt decoding. Fix: `reserved`, unknown-value handling.
- **No idempotency**: POST creating payments, orders, emails or jobs without idempotency key or natural unique key; PUT/DELETE turned into toggles or increments → client and gateway retries duplicate effects. Fix: store key with result, replay.
- **Mutating GET**: GET/HEAD that logs out, deletes, marks read or redeems a one-time link → prefetchers, email link scanners and crawlers trigger it. Fix: GET shows a confirmation; POST acts.
- **Unstable pagination**: sort on a non-unique key (`created_at`), cursor not encoding sort key plus tie-breaker, filters changeable between pages, OFFSET over changing data → skipped or repeated items. Fix: keyset cursor bound to the query.
- **Wrong status**: errors as 200 with an error body, validation failures as 500, retryable failures as 4xx, 429/503 without `Retry-After` → clients, gateways and caches retry or cache wrongly. Fix: correct status class.
- **Blind PATCH**: omitted fields written as null or defaults, or null conflated with absent → data wiped or impossible to clear. Fix: distinguish absent from null (`exclude_unset=True`, JSON Merge Patch).
- **Lost update**: PUT/PATCH of shared resources without `ETag`/`If-Match` or a version field → concurrent editors silently overwrite each other. Fix: conditional requests, 412 on mismatch.
- **Webhooks**: signature checked over re-serialized JSON instead of raw bytes, no timestamp window or event-id dedupe, slow work before the 2xx → valid events rejected, replays accepted, retries duplicate work. Fix: raw body, dedupe, enqueue.
- **Lossy numbers**: 64-bit ids or amounts emitted as JSON numbers → JavaScript clients silently round values above 2^53. Fix: serialize as strings.
