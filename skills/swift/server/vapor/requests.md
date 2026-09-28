---
name: Vapor request handling
description: Vapor 4 request bugs — decoding without Validatable, request bodies decoded straight into Fluent models, body-size limits raised globally, force-unwrapped route parameters, internal details in Abort reasons and unescaped Leaf output.
tags: [CWE-20, CWE-915, CWE-400, CWE-79, CWE-209]
activation:
  content:
    - '\breq\.(?:content|query)\.decode\(|\bValidatable\b|\.validate\((?:content|query):|\bvalidations\(_'
    - '\breq\.parameters\.get\(|\bdefaultMaxBodySize\b|\bbody:\s*\.(?:collect|stream)\b|\bAbort\(\s*\.\w+\s*,\s*reason:'
    - '#unsafeHTML\(|\breq\.view\.render\('
  examples:
    - 'let input = try req.content.decode(CreateUserRequest.self)'
    - 'let id = try req.parameters.get("id", as: UUID.self)'
    - 'return req.view.render("profile", context)'
sources:
  - https://docs.vapor.codes/basics/validation/
  - https://docs.vapor.codes/basics/routing/
  - https://docs.vapor.codes/leaf/overview/
  - https://github.com/vapor/vapor/blob/4.122.2/Sources/Vapor/Middleware/ErrorMiddleware.swift
---
- **Decode is not validation**: `req.content.decode(T.self)` only checks types → lengths, ranges, formats and enums go unchecked. Fix: conform to `Validatable` and call `T.validate(content: req)` before decoding.
- **Mass assignment**: decoding the body straight into a Fluent `Model` and saving it lets clients set `id`, roles, flags or foreign keys such as the owner's user id. Fix: request DTOs; copy allowed fields.
- **Body size limits**: Vapor 4 collects bodies up to 16 KB by default (413 beyond); raising `app.routes.defaultMaxBodySize` globally lets every route buffer large bodies in memory. Fix: per-route `body: .collect(maxSize:)` or `.stream` (Vapor 5 streams by default).
- **Force-unwrapped parameters**: `req.parameters.get("id")!` or `Int(...)!` crash on malformed input. Fix: `req.parameters.require("id", as: UUID.self)`.
- **Internal details in Abort**: `Abort(.internalServerError, reason: "\(error)")` returns SQL, paths or upstream responses to clients even in production, because `AbortError` reasons are always sent.
- **Unescaped Leaf output**: `#unsafeHTML(value)` with user-controlled content → stored or reflected XSS; `#(value)` escapes.
