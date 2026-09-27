---
name: Ktor errors and validation
description: Ktor error handling — StatusPages catch-alls that leak exception details or turn 4xx into 500, missing ContentNegotiation, RequestValidation gaps, and request bodies bound straight into persistence models (mass assignment).
priority: 62
tags: [CWE-209, CWE-915, CWE-20]
activation:
  content:
    - '\binstall\s*\(\s*(?:StatusPages|ContentNegotiation|RequestValidation)\b'
    - '\bexception\s*<\s*(?:Throwable|Exception|RuntimeException)\s*>'
    - '\bcause\.(?:message|localizedMessage|stackTraceToString)\b'
    - '\bcall\.receive\s*<'
    - '\bRequestValidationException\b|\bValidationResult\.'
    - '\bBadRequestException\b|\bNotFoundException\b'
sources:
  - https://ktor.io/docs/server-status-pages.html
  - https://ktor.io/docs/server-serialization.html
  - https://ktor.io/docs/server-request-validation.html
---
- **Leaking exception details**: `exception<Throwable> { call, cause -> call.respondText(cause.message ?: "") }` or `cause.stackTraceToString()` → SQL, file paths and internal hostnames in responses. Fix: generic message plus a correlation ID; log the cause server-side.
- **Catch-all hides client errors**: a `Throwable`/`Exception` handler also catches `BadRequestException`, `NotFoundException`, `RequestValidationException` and deserialization errors → clients get 500 for bad input; monitoring floods. Fix: register 4xx handlers for these types (the most specific handler wins).
- **Missing ContentNegotiation**: `call.receive<Dto>()`/`call.respond(dto)` without `install(ContentNegotiation) { json() }` on that application → 415/500 or `toString()` output. Fix: install it once at application level.
- **Validation gaps**: `RequestValidation` checks only request bodies of the registered types; path/query parameters and headers are never covered → IDs and paging values reach the database unchecked. Fix: validate them in the handler.
- **Mass assignment**: `call.receive<User>()` then saving it directly lets clients set `id`, `role`, `ownerId`, `balance`. Fix: dedicated request DTOs mapped onto server-controlled fields.
