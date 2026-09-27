---
name: Environment variables and secrets
description: Astro environment defects — secrets inlined through import.meta.env, PUBLIC_ or client-context exposure, uncoerced string values since Astro 6 and .env not loaded in the config file.
category: security
priority: 66
tags: [CWE-200, CWE-798]
activation:
  files: ["**/astro.config.{mjs,js,ts,mts}"]
  content:
    - "\\bimport\\.meta\\.env\\.[A-Z_]"
    - "from ['\"]astro:env/(?:client|server)['\"]"
    - "\\b(?:envField|getSecret)\\b"
    - "\\bPUBLIC_[A-Z0-9_]+"
sources:
  - https://docs.astro.build/en/guides/environment-variables/
  - https://docs.astro.build/en/guides/upgrade-to/v6/
  - https://docs.astro.build/en/reference/modules/astro-env/
---
- **Secrets inlined**: `import.meta.env.SECRET` is replaced at build time (always inlined since Astro 6) → secrets end up in built server files; runtime env changes are ignored. Fix: `astro:env/server` with `access: 'secret'` (not inlined) or `getSecret()`.
- **Client exposure**: secrets named `PUBLIC_*`, or `envField` declared with `context: 'client'` → shipped to browsers. Fix: server context and secret access.
- **String flags (Astro 6+)**: `if (import.meta.env.FEATURE_X)` or arithmetic on env values → values are no longer coerced; `'false'` is truthy, `'10' + 1` is `'101'`. Fix: compare strings explicitly or use typed `envField.boolean()`/`number()`.
- **Config reads**: `import.meta.env` inside `astro.config.*` → `.env` files are not loaded there. Fix: Vite `loadEnv()` or `process.env`.
