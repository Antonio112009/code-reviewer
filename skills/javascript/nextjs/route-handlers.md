---
name: Next.js Route Handlers
description: App Router route.ts defects — public handlers without authorization, webhook signatures verified over re-serialized JSON, cacheable personalized responses, streams that ignore client disconnects and branches without a response.
priority: 68
tags: [CWE-862, CWE-524, CWE-347]
activation:
  files: ["**/app/**/route.{js,ts}"]
  content:
    - "\\bexport\\s+(?:async\\s+)?function\\s+(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\\b"
    - "\\bexport\\s+const\\s+(?:GET|POST|PUT|PATCH|DELETE)\\s*="
  examples:
    - "export async function POST(request) {"
    - "export const GET = async (request) => { return Response.json(data); };"
sources:
  - https://nextjs.org/docs/app/api-reference/file-conventions/route
  - https://nextjs.org/docs/app/guides/data-security
  - https://nextjs.org/docs/app/api-reference/file-conventions/proxy
---
- **Public endpoint**: every exported method is reachable directly; layout/page auth doesn't cover it and proxy matchers may exclude `/api` → missing session and ownership checks mean data exposure or IDOR. Fix: authorize inside each handler.
- **Webhook signatures**: verifying a signature over `JSON.stringify(await req.json())` instead of the raw `await req.text()` → valid events rejected or forged ones accepted; the body stream can be read only once. Fix: verify the raw text, then `JSON.parse`.
- **Cacheable personal data**: `Cache-Control: public` or `s-maxage` on per-user responses → a CDN serves one user's data to others. Fix: `private, no-store`.
- **Streams ignoring disconnects**: SSE or LLM streaming handlers that don't stop on `request.signal` abort → upstream work and token spend continue after the client leaves. Fix: pass the signal to upstream calls, cancel on abort.
- **Missing response on a branch**: a code path (early `if`, `catch`, `switch` default) that returns nothing → Next.js throws "No response is returned from route handler" and the client gets a 500. Fix: return a `Response` on every path.
