---
name: Environment variables and secrets
description: Expo configuration leaks and misconfiguration — secrets in EXPO_PUBLIC_ variables or app config, env vars not inlined because of dynamic access, server-only env used in app code, secrets bundled through imports and API routes misconfigured for native builds.
priority: 70
tags: [CWE-798, CWE-200]
activation:
  content:
    - '\bEXPO_PUBLIC_\w|\bprocess\.env\b'
    - '\bextra\s*:|\bexpoConfig\b|\bConstants\.(?:expoConfig|manifest\w*)\b'
  examples:
    - 'const apiKey = process.env.EXPO_PUBLIC_API_KEY;'
    - 'const extra = Constants.expoConfig?.extra;'
  files: ['**/app.config.{js,ts,mjs,cjs}', '**/app/**/*+api.{js,ts}']
sources:
  - https://docs.expo.dev/guides/environment-variables/
  - https://docs.expo.dev/workflow/configuration/
  - https://docs.expo.dev/router/web/api-routes/
---
- **Secrets in `EXPO_PUBLIC_`**: private API keys, tokens or signing secrets in `EXPO_PUBLIC_*` → inlined as plain text into the JS bundle and every OTA update. Fix: only public values; call secret-bearing services from a backend or `+api` route.
- **Dynamic access**: `process.env['EXPO_PUBLIC_X']`, destructuring `const { EXPO_PUBLIC_X } = process.env` or computed keys → not inlined → `undefined` in builds. Fix: literal `process.env.EXPO_PUBLIC_X`.
- **Server-only env in app code**: `process.env.API_SECRET`/`process.env.API_URL` without the prefix in client code → `undefined` at runtime (only `EXPO_PUBLIC_` reaches the app). Fix: prefix public values; keep secrets server-side.
- **Secrets in app config**: values placed in `extra` (or other config fields) from `process.env` at build time → embedded in the manifest and readable via `Constants.expoConfig`. Fix: keep app config public.
- **Secrets through imports**: modules holding secrets imported by screens, components or shared utils (anything bundled for the client, i.e. not a `+api` file) → secret ships in the app. Fix: isolate secret code in `+api.ts`/server modules.
- **API routes on native**: relative `fetch('/api/…')` from native builds without the router `origin` set (and `web.output: 'server'` deployed) → requests fail in production. Fix: configure `origin` to the deployed HTTPS host.
