---
name: Runtime config and secrets
description: Nuxt runtimeConfig and app.config exposure and override rules — secrets in public config, build-time process.env defaults, ignored NUXT_ overrides, private keys read on the client and client-side mutation.
category: security
priority: 68
tags: [CWE-200, CWE-798]
activation:
  files: ["**/nuxt.config.{ts,js,mjs}", "**/app.config.{ts,js,mjs}"]
  content:
    - "\\buseRuntimeConfig\\s*\\("
    - "\\bruntimeConfig\\s*:"
    - "\\bNUXT_[A-Z0-9_]+"
    - "\\b(?:defineAppConfig|useAppConfig|updateAppConfig)\\s*\\("
sources:
  - https://nuxt.com/docs/4.x/guide/going-further/runtime-config
  - https://nuxt.com/docs/4.x/guide/directory-structure/app/app-config
  - https://nuxt.com/docs/4.x/guide/directory-structure/server
---
- **Secret in public config**: API keys or tokens under `runtimeConfig.public` or in `app.config` → shipped to every browser in the payload/bundle. Fix: top-level (private) `runtimeConfig` keys read only in `server/`.
- **Build-time defaults**: `runtimeConfig: { apiSecret: process.env.MY_SECRET }` with a differently named variable → value frozen at build; runtime env changes ignored. Fix: declare the key and set `NUXT_API_SECRET` at runtime.
- **Ignored overrides**: env vars without the `NUXT_`/`NUXT_PUBLIC_` prefix, not matching the key path, or for keys not declared in `nuxt.config` → silently ignored. Fix: declare the key; name the variable after its path.
- **Private key on the client**: reading a private `runtimeConfig` key in components or plugins → works during SSR, `undefined` in the browser. Fix: expose data via a server route, or make only truly public values public.
- **Server read without event**: `useRuntimeConfig()` in Nitro handlers without `event` → may miss runtime env overrides. Fix: `useRuntimeConfig(event)`.
- **Client mutation and copies**: writing to the client-side config object, or copying private values into `useState`/rendered output → shared mutable state, secrets in HTML. Fix: treat config as read-only; keep secrets server-side.
