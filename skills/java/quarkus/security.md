---
name: Quarkus security and CORS
description: Quarkus authorization gaps — unannotated Jakarta REST endpoints public by default, method-level @PermitAll overriding class rules, path-permission matching rules and regex CORS origins that accept any site with credentials.
priority: 72
tags: [CWE-862, CWE-942, A01:2025]
activation:
  content:
    - '@(?:RolesAllowed|PermitAll|DenyAll|Authenticated|PermissionsAllowed)\b'
    - '\bquarkus\.(?:http\.(?:auth|cors)|security)\b'
    - '\bdeny-unannotated'
  examples:
    - '@RolesAllowed("admin")'
    - 'quarkus.http.cors.origins=/.*/'
    - 'quarkus.security.jaxrs.deny-unannotated-endpoints=true'
sources:
  - https://quarkus.io/guides/security-authorize-web-endpoints-reference
  - https://quarkus.io/guides/security-cors
---
- **Public by default**: Jakarta REST endpoints without security annotations are open unless `quarkus.security.jaxrs.deny-unannotated-endpoints=true` or `quarkus.security.jaxrs.default-roles-allowed` is set → new endpoints ship unauthenticated. Fix: deny by default, annotate exceptions.
- **Method overrides class**: a method-level `@PermitAll` inside a `@RolesAllowed` class opens that method; annotations on interfaces or other classes instead of the endpoint implementation aren't applied. Fix: annotate the implementation explicitly.
- **Path permissions**: in `quarkus.http.auth.permission.*.paths` the longest path wins, `/*` is a prefix match and method-specific permissions beat method-less ones → a narrower `permit` (or `GET`-only) rule can open a protected subtree. Fix: test each path and verb.
- **Any-origin CORS**: `quarkus.http.cors.origins=/.*/` (regex) or overly broad regexes outside `%dev` → any site can call the API with the user's credentials. Fix: explicit origins per profile.
