---
name: React Router 8 behavior changes
description: Silent behavior changes in React Router 8 (June 2026, former v8 future flags now default) — meta functions reading the removed data argument, raw request URLs in loaders, actions and middleware, and new .data request URL formats.
priority: 60
activation:
  content:
    - "\\bmeta\\s*[:=(]"
    - "\\brequest\\.url\\b"
    - "_root\\.data|\\.data['\"`]"
  examples:
    - "export function meta({ data }) {"
    - "const url = new URL(request.url);"
    - "const res = await fetch(`${path}.data`);"
  versions: { framework.remix: ">=8" }
sources:
  - https://reactrouter.com/changelog
  - https://reactrouter.com/upgrading/v7
---
- **meta data argument removed**: `meta({ data })` and `matches[i].data` no longer exist → titles, descriptions and OG tags render `undefined` (untyped code compiles). Fix: `loaderData`.
- **Raw request.url**: loaders, actions and middleware now receive the raw request, so data requests carry `.data` suffixes and `index`/`_routes` params → pathname checks fail and `redirectTo=${request.url}` points at `.data` URLs. Fix: use the normalized `url` argument.
- **New data request URLs**: trailing-slash routes now fetch `/path/_.data` and the root `/_.data` (was `/_root.data`); `request` pathnames keep the trailing slash → CDN cache rules, WAF allowlists or proxies matching old `.data` patterns miss requests. Fix: update those rules.
