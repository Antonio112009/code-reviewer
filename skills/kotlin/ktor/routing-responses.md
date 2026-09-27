---
name: Ktor routing and request handling
description: Ktor handler defects — respond() not ending the handler, double responses, receiving the body twice, routes left outside authenticate {}, `!!` and unchecked parsing of parameters, and multipart uploads (50 MiB default limit, client file names, undisposed parts).
priority: 64
tags: [CWE-285, CWE-22, CWE-400]
activation:
  content:
    - '\bcall\.respond\w*\s*\('
    - '\bcall\.receive\w*\s*[<(]'
    - '\b(?:routing|route|authenticate)\s*[({]'
    - '\b(?:get|post|put|patch|delete)\s*\(\s*"'
    - '\bcall\.parameters\s*\['
    - '\breceiveMultipart\s*\(|\bPartData\.FileItem\b|\boriginalFileName\b'
sources:
  - https://ktor.io/docs/server-responses.html
  - https://ktor.io/docs/server-requests.html
  - https://ktor.io/docs/server-double-receive.html
  - https://ktor.io/docs/server-auth.html
---
- **respond() doesn't return**: `call.respond(HttpStatusCode.Forbidden)` inside a check without `return@get` → the handler keeps running (performs the action) and a second respond throws `ResponseAlreadySentException`. Fix: `return@get` right after every early respond.
- **Body received twice**: calling `call.receive…()` again (in an interceptor, logging or validation, then the handler) → `RequestAlreadyConsumedException`. Fix: receive once and pass the object, or install `DoubleReceive`.
- **Routes outside authenticate**: endpoints declared as siblings of `authenticate("jwt") { … }` instead of inside it, or added in another `routing {}` block, are public. Fix: nest protected routes; review route trees when moving code.
- **Parameter handling**: `call.parameters["id"]!!` or `.toInt()` on raw values → NPE/`NumberFormatException` answered as 500 instead of 400. Fix: `getOrFail<Int>("id")`, or `requirePathParameter`/`requireQueryParameter` (Ktor 3.5+).
- **Multipart limits**: since Ktor 3.0 file/binary parts over 50 MiB throw `IOException` unless `receiveMultipart(formFieldLimit = …)` is set; with a raised limit, uploads stream to disk/memory unbounded. Fix: explicit per-route limits.
- **Client-supplied file names**: `File("uploads/${part.originalFileName}")` → path traversal and overwrites. Fix: generate names; never use `originalFileName` as a path.
- **Undisposed parts**: multipart parts not `dispose()`d after processing → temp files and buffers accumulate. Fix: `part.dispose()` in `finally`.
