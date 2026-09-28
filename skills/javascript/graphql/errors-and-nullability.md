---
name: Errors, masking and nullability
description: GraphQL error handling in Apollo Server, Yoga and graphql-js — stack traces when NODE_ENV is unset, raw errors wrapped in GraphQLError bypassing masking, formatError leaks, non-null fields nulling whole responses, custom scalar coercion and Apollo Server 5 status codes.
priority: 62
tags: [CWE-209, CWE-20]
activation:
  content:
    - "\\bnew\\s+GraphQLError\\s*\\(|\\bformatError\\b|\\bmaskedErrors\\b|\\bmaskError\\b|\\bincludeStacktraceInErrorResponses\\b|\\bunwrapResolverError\\b"
    - "\\bnew\\s+GraphQLScalarType\\s*\\(|\\b(?:parseValue|parseLiteral|coerceInputValue|coerceInputLiteral|coerceOutputValue)\\s*[(:]"
    - "\\bGraphQLNonNull\\b|\\bnullable\\s*:\\s*false\\b|\\b[a-z]\\w*(?:\\([^)\\n]{0,120}\\))?\\s*:\\s*\\[?[A-Z]\\w*!"
    - "\\bstatus400ForVariableCoercionErrors\\b"
  examples:
    - 'throw new GraphQLError(dbErr.message);'
    - 'parseValue(value) { return new Date(value); },'
    - 'email: String!'
    - 'status400ForVariableCoercionErrors: true,'
sources:
  - https://www.apollographql.com/docs/apollo-server/data/errors
  - https://the-guild.dev/graphql/yoga-server/docs/features/error-masking
  - https://www.apollographql.com/docs/apollo-server/migration
  - https://www.graphql-js.org/upgrade-guides/v16-v17/
---
- **NODE_ENV unset**: Apollo Server adds `extensions.stacktrace` unless `NODE_ENV` is `production`/`test`; Yoga returns `originalError` details when `NODE_ENV=development`. Fix: set NODE_ENV, or `includeStacktraceInErrorResponses: false` / `maskedErrors: { isDev: false }`.
- **Unmasked by design**: Yoga masks only non-`GraphQLError`s and Apollo forwards any thrown message — `throw new GraphQLError(dbErr.message)` or rethrown driver errors expose SQL, hosts and field names. Fix: safe messages and codes; log originals (`unwrapResolverError`).
- **formatError leaks**: `formatError: (formatted, error) => error` or spreading the original error returns internal fields and stacks. Fix: build a new object from allowed fields.
- **Non-null blast radius**: a non-null field (`email: String!`, `[Item!]!`) whose resolver throws or returns null nulls the nearest nullable parent — one bad item wipes a whole list or `data`. Fix: keep fallible or remote fields nullable.
- **Custom scalars**: validating only in `parseLiteral` (inline) or only in `parseValue` (variables) lets invalid input in the other way; graphql-js 17 renames them `coerceInputLiteral`/`coerceInputValue`. Fix: one validator for both.
- **Apollo Server 5 statuses**: `status400ForVariableCoercionErrors` now defaults to `true` (AS4 answered 200), changing what clients and monitors see; AS4 is end-of-life since 2026-01-26. Fix: update clients and alerts when upgrading.
