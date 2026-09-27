---
name: SSR, hydration and transfer cache
description: Angular SSR defects — browser APIs on the server, private data in the HTTP transfer cache or TransferState, prerendered personal routes, host-header SSRF, hydration-breaking DOM access and null request tokens.
priority: 66
activation:
  files: ["**/*.server.ts", "**/server.ts"]
  content:
    - "\\b(?:isPlatform(?:Browser|Server)|afterNextRender|afterEveryRender|TransferState|makeStateKey)\\b"
    - "\\b(?:provideClientHydration|withHttpTransferCacheOptions|withIncrementalHydration|provideServerRendering)\\b"
    - "\\b(?:REQUEST|RESPONSE_INIT|REQUEST_CONTEXT|RenderMode|getPrerenderParams)\\b"
    - "\\b(?:AngularNodeAppEngine|AngularAppEngine|CommonEngine|trustProxyHeaders|allowedHosts)\\b"
    - "\\bngSkipHydration\\b"
sources:
  - https://angular.dev/guide/ssr
  - https://angular.dev/guide/hydration
  - https://angular.dev/best-practices/security
  - https://github.com/angular/angular-cli/security/advisories/GHSA-x288-3778-4hhx
---
- **Browser globals on the server**: `window`, `document`, `localStorage` in constructors, field initializers, `ngOnInit` or services → SSR crash or divergent HTML. Fix: `afterNextRender`, `inject(DOCUMENT)`.
- **Private data in transfer cache**: `withHttpTransferCacheOptions` enabling `includeRequestsWithAuthHeaders`/`includeRequestsWithCredentials`/`includePostRequests`, or a loose `filter` → user-specific responses embedded in cacheable HTML. Fix: keep the defaults.
- **Per-user TransferState**: `TransferState` keys or resource `id`s holding per-user data on cached/prerendered pages → one user's data hydrated for another.
- **Prerendered personal routes**: `RenderMode.Prerender` for routes whose output depends on the user or request → build-time HTML served to everyone. Fix: `RenderMode.Server` or `Client`.
- **Host header trust**: server-side relative `HttpClient` URLs resolve against the request host; `trustProxyHeaders` without a trusted proxy, or no `allowedHosts` → SSRF, credential leaks (patched in @angular/ssr 21.1.5/20.3.17/19.2.21). Fix: `security.allowedHosts`; upgrade.
- **Hydration-breaking DOM/HTML**: native DOM manipulation (`innerHTML`, `appendChild`, DOM libraries) or invalid nesting (`<div>` in `<p>`, tables without `<tbody>`) → hydration errors (NG0500). Fix: templates/`Renderer2`; `ngSkipHydration` as a last resort.
- **Null request tokens**: `inject(REQUEST)`/`RESPONSE_INIT` without null checks → crashes in the browser and during prerender (they are `null` there).
