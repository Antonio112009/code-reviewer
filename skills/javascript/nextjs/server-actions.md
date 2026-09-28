---
name: Next.js Server Actions
description: Next.js-specific Server Action defects — closure values sent to the client, encryption keys and action IDs across instances and deploys, loosened allowedOrigins, body limits, sequential dispatch, redirect ordering and Host-header SSRF.
priority: 72
tags: [CWE-352, CWE-918]
activation:
  content:
    - "['\"]use server['\"]"
    - "\\bserverActions\\s*:"
    - "NEXT_SERVER_ACTIONS_ENCRYPTION_KEY"
  examples:
    - "'use server';"
    - "serverActions: { allowedOrigins: ['example.com'] },"
    - "NEXT_SERVER_ACTIONS_ENCRYPTION_KEY=base64:abc123def456"
sources:
  - https://nextjs.org/docs/app/guides/server-actions
  - https://nextjs.org/docs/app/guides/data-security
  - https://nextjs.org/docs/app/api-reference/config/next-config-js/serverActions
  - https://nextjs.org/blog/july-2026-security-release
---
- **Closure values leave the server**: variables captured by inline `'use server'` functions (tokens, records, prices) travel to the client encrypted and come back on invocation; don't rely on that encryption. Fix: never capture secrets; re-read authoritative values.
- **Unstable action keys**: several instances or self-hosted deploys without one shared `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`, or clients on an old build → decryption failures, "Failed to find Server Action". Fix: stable key, rolling deploys, reload on that error.
- **Loosened CSRF check**: broad `serverActions.allowedOrigins` patterns → other sites can invoke actions with users' cookies. Fix: list exact proxy/CDN hosts only.
- **Body limit**: action payloads above the 1 MB default fail (uploads); raising `bodySizeLimit` to hundreds of MB invites memory exhaustion. Fix: direct or presigned uploads.
- **Sequential dispatch**: the client runs actions one at a time → `Promise.all` over actions is serial and a slow action blocks later ones. Fix: one action doing the parallel work.
- **Code after redirect()**: `redirect()` throws, so revalidation or writes placed after it never run. Fix: `revalidatePath`/`updateTag` and writes first, then redirect.
- **Host-header SSRF**: self-hosted/custom servers where an action redirects or forwards trust `Host`/`X-Forwarded-Host` (CVE-2024-34351 before 14.1.1; CVE-2026-64649 before 15.5.21/16.2.11) → requests to attacker hosts. Fix: upgrade; pin the host at the proxy.
