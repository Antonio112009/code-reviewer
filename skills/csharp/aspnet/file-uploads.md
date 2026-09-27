---
name: File uploads
description: IFormFile/upload defects — trusting FileName and ContentType, serving uploads from the web root, removed or inflated request size limits, buffering uploads into memory and synchronous form reads.
priority: 70
tags: [CWE-434, CWE-22, CWE-400, A06:2025]
activation:
  content:
    - '\bIFormFile(?:Collection)?\b|\bMultipartReader\b|\.FileName\b'
    - '\[(?:RequestSizeLimit|DisableRequestSizeLimit|RequestFormLimits)\b|\bMaxRequestBodySize\b|\bMultipartBodyLengthLimit\b'
    - '\bServeUnknownFileTypes\b|\bUseStaticFiles\(|\bPhysicalFileProvider\b'
sources:
  - https://learn.microsoft.com/en-us/aspnet/core/mvc/models/file-uploads
  - https://learn.microsoft.com/en-us/aspnet/core/fundamentals/servers/kestrel/options
  - https://learn.microsoft.com/en-us/aspnet/core/fundamentals/static-files
---
- **Trusted metadata**: `IFormFile.FileName` in storage paths or rendered unencoded, `ContentType`/extension trusted as the real type → traversal, overwrites, stored XSS, executable uploads. Fix: `Path.GetRandomFileName()` for storage, HTML-encode display names, allowlist extensions and check file signatures.
- **Uploads served back**: files saved under `wwwroot`/a `UseStaticFiles` root, or `ServeUnknownFileTypes = true` → uploaded HTML/SVG/JS served from the app origin (XSS). Fix: store outside the web root; serve with `Content-Disposition: attachment` and `nosniff`.
- **Limits removed**: `[DisableRequestSizeLimit]`, `MaxRequestBodySize = null` or a huge `MultipartBodyLengthLimit` (default 128 MB; Kestrel body limit ~28.6 MB) on public endpoints → disk/memory DoS (buffered files over 64 KB go to temp files). Fix: per-endpoint `[RequestSizeLimit]`, streaming.
- **Buffering in memory**: `file.CopyToAsync(memoryStream)`, `ToArray()` of whole uploads, or synchronous `Request.Form` reads → large-object-heap churn, OOM, thread starvation. Fix: stream to the destination; `ReadFormAsync`.
