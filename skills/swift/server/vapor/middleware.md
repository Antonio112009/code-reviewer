---
name: Vapor middleware and configuration
description: Vapor 4 configuration mistakes — CORS added after the error middleware, credentialed CORS for any origin, FileMiddleware serving the working directory with dotfiles, and apps started without --env production exposing error details.
priority: 66
category: security
tags: [CWE-942, CWE-538, CWE-209]
activation:
  content:
    - '\bapp\.middleware\.use\(|\bCORSMiddleware\b|\ballowedOrigin\b|\ballowCredentials\b'
    - '\bFileMiddleware\(|\bpublicDirectory\b|\bworkingDirectory\b|\bErrorMiddleware\b'
    - '\bEnvironment\.(?:detect|get)\(|\bapp\.environment\b|--env\b|\bisRelease\b'
  examples:
    - 'app.middleware.use(CORSMiddleware(configuration: .default()), at: .beginning)'
    - 'app.middleware.use(FileMiddleware(publicDirectory: app.directory.publicDirectory))'
    - 'let env = try Environment.detect()'
sources:
  - https://docs.vapor.codes/advanced/middleware/
  - https://github.com/vapor/vapor/blob/4.122.2/Sources/Vapor/Middleware/CORSMiddleware.swift
  - https://github.com/vapor/vapor/blob/4.122.2/Sources/Vapor/Middleware/FileMiddleware.swift
  - https://docs.vapor.codes/basics/environment/
---
- **CORS after errors**: `CORSMiddleware` added with plain `use` sits behind the default `ErrorMiddleware` → error responses lack CORS headers and browsers report CORS failures instead of the real error. Fix: `app.middleware.use(cors, at: .beginning)`.
- **Credentialed CORS for any origin**: `allowedOrigin: .originBased` (also the `.default()` configuration, which echoes any `Origin`) or `.all` combined with `allowCredentials: true` → any website can make authenticated requests and read responses. Fix: `.any([...])` allowlist.
- **FileMiddleware root**: `FileMiddleware(publicDirectory: app.directory.workingDirectory)` or any directory other than `Public/` serves every file in it, dotfiles included (`.env`, sources, SQLite files). Fix: `app.directory.publicDirectory`.
- **Development by default**: Vapor runs in `development` unless started with `--env production` → `ErrorMiddleware` returns raw error descriptions (SQL, file paths) to clients and `.env.development` is loaded. Fix: pass `--env production` in the Dockerfile/service definition.
