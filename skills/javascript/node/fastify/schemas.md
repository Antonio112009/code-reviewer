---
name: JSON-schema validation and serialization
description: Fastify Ajv and fast-json-stringify behaviour — type coercion and defaults, silent property removal, routes or status codes without response schemas leaking fields, v5 full-schema requirement and body-schema bypasses fixed in 5.x.
priority: 62
tags: [CWE-20, CWE-200, CWE-94]
activation:
  content:
    - "\\bschema\\s*:\\s*\\{"
    - "\\bresponse\\s*:\\s*\\{\\s*['\"]?(?:\\d|default)"
    - "\\b(?:addSchema|setValidatorCompiler|setSerializerCompiler|withTypeProvider|setSchemaErrorFormatter)\\s*[(<]"
    - "\\bType\\.(?:Object|String|Number|Integer|Optional|Array)\\s*\\(|\\badditionalProperties\\b|\\bcoerceTypes\\b|\\bremoveAdditional\\b"
  examples:
    - 'fastify.get(''/users/:id'', { schema: { response: { 200: userSchema } } }, handler);'
    - 'fastify.addSchema(userSchema);'
    - 'const UserSchema = Type.Object({ name: Type.String() }, { additionalProperties: false });'
sources:
  - https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/
  - https://fastify.dev/docs/latest/Guides/Migration-Guide-V5/
  - https://github.com/advisories/GHSA-247c-9743-5963
  - https://advisories.gitlab.com/npm/fastify/CVE-2026-18504/
---
- **Coercion**: default Ajv options (`coerceTypes: 'array'`, `useDefaults`) turn `"123"` into `123`, `"true"` into `true` and a single value into `[value]` → handlers re-parsing raw strings or comparing to strings misbehave.
- **Silent stripping**: `removeAdditional: true` drops unknown properties only where `additionalProperties: false` is set — typos silently discard client fields; without it, extra fields (`role`, `ownerId`) reach handlers. Fix: explicit `additionalProperties: false`.
- **Response schema gaps**: a route without a `response` schema (or a status code missing from the map, e.g. only `200` declared) serializes the whole returned object — password hashes, internal fields. Fix: schemas for every code (`2xx`, `default`).
- **v5 full schemas**: v5 removed `jsonShortHand` — `querystring: { page: { type: 'integer' } }` must become `{ type: 'object', properties: … }`; `date-time`/`time` formats now require a timezone.
- **Content-type bypasses**: per-content-type body schemas (`schema.body.content`) could be skipped with crafted Content-Type headers (CVE-2025-32442, CVE-2026-25223, CVE-2026-33806; fixed 5.8.5); root primitive body schemas passed uncoerced values until 5.12.1. Fix: upgrade.
- **Schemas are code**: validators and serializers are compiled with `new Function()` — schemas or `$ref`s built from user or DB input allow code injection, and `allErrors: true` enables DoS.
