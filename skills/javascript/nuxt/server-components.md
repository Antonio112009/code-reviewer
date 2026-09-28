---
name: Server components and islands
description: Nuxt server components (.server.vue, NuxtIsland) whose props arrive through the public /__nuxt_island endpoint — dynamic component resolution, attribute fallthrough, missing authorization and client-only gaps.
category: security
priority: 66
tags: [CWE-94, CWE-285]
activation:
  files: ["**/*.server.vue", "**/*.client.vue"]
  content:
    - "<NuxtIsland\\b"
    - "\\bcomponentIslands\\b"
    - "\\bresolveDynamicComponent\\s*\\("
    - "<component\\s[^>\\n]{0,80}:is="
  examples:
    - '<NuxtIsland name="UserCard" :props="{ userId }" />'
    - 'experimental: { componentIslands: true },'
    - 'const comp = resolveDynamicComponent(tag);'
    - '<component :is="widget" />'
sources:
  - https://nuxt.com/docs/4.x/guide/directory-structure/app/components
  - https://github.com/nuxt/nuxt/security/advisories/GHSA-9473-5f9j-94wq
  - https://github.com/nuxt/nuxt/security/advisories/GHSA-48hr-524c-v5w3
---
- **Props are request input**: island props come from the `/__nuxt_island/…` request, not only from your pages → anyone can render the island with arbitrary props. Fix: validate props; authorize data access inside the island.
- **Dynamic resolution from props**: island props forwarded to `<component :is>`, `resolveDynamicComponent()` or `h()` → attacker instantiates any global component, or a `{ template }` object compiled on the server (RCE before 4.5.1/3.21.10). Fix: map strings through an allowlist.
- **Attribute fallthrough**: an island whose root is a polymorphic component (`as`/`asChild`, e.g. @nuxt/ui) with undeclared props falling through → the same injection without explicit forwarding. Fix: declare props, `inheritAttrs: false`.
- **Unpatched Nuxt**: server components/islands on Nuxt <4.5.1 (<3.21.10) → RCE and DoS advisories (July 2026). Fix: upgrade; until then block `template`/`render` keys in island props at the edge.
- **Client-only gaps**: `.client.vue`/`<ClientOnly>` content is absent from SSR HTML → missing SEO text and layout shift. Fix: a same-size `fallback` or placeholder.
