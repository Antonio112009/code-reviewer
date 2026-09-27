---
name: Query cost and abuse limits
description: Unbounded GraphQL execution in JS servers — no depth/complexity/alias limits, HTTP batching and aliases defeating rate limits, unbounded list arguments, persisted-query caches mistaken for allowlists, and introspection or field suggestions exposing private schemas.
priority: 64
tags: [CWE-400, CWE-770, CWE-307]
activation:
  content:
    - "\\b(?:depthLimit|createComplexityLimitRule|costLimit|maxDepth|maxAliases|maxTokens|maxRecursiveSelections|validationRules)\\b"
    - "\\ballowBatchedHttpRequests\\b|\\bbatching\\s*:|\\bintrospection\\s*:|\\bpersistedQueries\\b|\\bpersistedDocuments\\b|\\bhideSchemaDetailsFromClientErrors\\b"
    - "\\bnew\\s+ApolloServer\\b|\\bcreateYoga\\s*\\(|\\bcreateHandler\\s*\\(|\\bgraphqlHTTP\\s*\\("
    - "\\b(?:first|last|limit|take|pageSize|perPage)\\s*:\\s*(?:Int\\b|\\{\\s*type\\b|\\[?\\s*GraphQLInt\\b)"
sources:
  - https://www.apollographql.com/docs/apollo-server/api/apollo-server
  - https://www.apollographql.com/docs/apollo-server/v3/requests
  - https://github.com/Escape-Technologies/graphql-armor
  - https://the-guild.dev/graphql/yoga-server/docs/features/graphiql
---
- **No cost limits**: Apollo Server and Yoga ship without depth, complexity or alias limits (Apollo's `maxRecursiveSelections` is off) → deeply nested or cyclic queries exhaust CPU and the database. Fix: GraphQL Armor or validation rules.
- **Aliases and batching**: one request can repeat a mutation hundreds of times via aliases or batched arrays (`allowBatchedHttpRequests`, Yoga `batching`) → login/OTP brute force past per-request rate limits. Fix: keep batching off; count operations and aliases.
- **Unbounded lists**: list fields whose `first`/`limit` is optional (meaning "all") or uncapped fetch whole tables. Fix: defaults and maximums enforced in the resolver.
- **APQ is not an allowlist**: automatic persisted queries (on by default in Apollo) register any query a client sends — only trusted-document allowlists that reject unknown operations restrict what runs.
- **Schema exposure**: Apollo enables introspection unless `NODE_ENV=production`, Yoga keeps it on, and "Did you mean …" suggestions reveal field names even with introspection off. Fix: `introspection: false`, `hideSchemaDetailsFromClientErrors: true` for private APIs.
