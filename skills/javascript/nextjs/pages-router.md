---
name: Pages Router data and API routes
description: Pages Router defects — secrets in getServerSideProps props, CDN-cached personalized SSR, getInitialProps running in the browser, fallback pages without isFallback, empty router.query before hydration, and API routes with loose method checks, parsed webhook bodies or missing responses.
priority: 62
tags: [CWE-200, CWE-524, CWE-352]
activation:
  files: ["**/pages/**/*.{js,jsx,ts,tsx}"]
  content:
    - "\\b(?:getServerSideProps|getStaticProps|getStaticPaths|getInitialProps)\\b"
    - "\\bNextApi(?:Request|Response|Handler)\\b"
    - "['\"]next/router['\"]"
sources:
  - https://nextjs.org/docs/pages/building-your-application/data-fetching/get-server-side-props
  - https://nextjs.org/docs/pages/api-reference/functions/get-static-paths
  - https://nextjs.org/docs/pages/api-reference/functions/use-router
  - https://nextjs.org/docs/pages/building-your-application/routing/api-routes
---
- **Secrets in props**: everything returned from `getServerSideProps`/`getStaticProps` is embedded in the HTML (`__NEXT_DATA__`) → full DB rows, tokens or internal fields exposed. Fix: return minimal props.
- **CDN-cached personal pages**: `Cache-Control: public, s-maxage=…` set in `getServerSideProps` for per-user content → the CDN serves one user's page to others. Fix: `private` for personalized responses.
- **getInitialProps in the browser**: it also runs client-side on navigations → server-only imports and secrets get bundled, and `req`/`res` are `undefined` there. Fix: `getServerSideProps`.
- **fallback: true without isFallback**: fallback renders receive empty props → crashes unless `router.isFallback` is handled; `fallback: false` 404s new paths until the next build.
- **Empty router.query**: statically optimized pages render with `router.query` = `{}` until hydration → effects fire with `undefined` ids. Fix: wait for `router.isReady`.
- **Loose API methods and types**: handlers acting on any `req.method` (GET deletes, no 405) and treating `req.query.x` as a string (it may be `string[]`) → CSRF-able mutations, crashes. Fix: check method and types.
- **Webhook raw body**: the default `bodyParser` consumes the stream → signatures checked over re-serialized JSON fail or can be spoofed. Fix: `bodyParser: false` in the route `config`, verify the raw body.
- **Unfinished responses**: a branch that never calls `res.send`/`json`/`end` → the request hangs ("API resolved without sending a response"). Fix: respond on every path.
