---
name: URLSession requests and sessions
description: URLSession defects — tasks never resumed, HTTP error statuses treated as success, URL building changed by iOS 17 parsing, unescaped + in query items, long default timeouts, sessions that leak their delegate and sensitive responses cached on disk.
activation:
  content:
    - '\bURLSession\w*\b|\.(?:dataTask|downloadTask|uploadTask)\(|\.resume\(\)|\bHTTPURLResponse\b|\.statusCode\b'
    - '\bURL\(string:|\bURLComponents\b|\b(?:percentEncoded)?[qQ]ueryItems?\b|\baddingPercentEncoding\('
    - '\btimeoutInterval\w*|\bwaitsForConnectivity\b|\burlCache\b|\bURLCache\b|\.(?:finishTasksAndInvalidate|invalidateAndCancel)\('
sources:
  - https://developer.apple.com/documentation/foundation/url/init(string:)
  - https://developer.apple.com/documentation/foundation/urlsession/init(configuration:delegate:delegatequeue:)
  - https://developer.apple.com/documentation/foundation/urlsessionconfiguration/timeoutintervalforresource
  - https://developer.apple.com/forums/thread/113632
---
- **Never resumed**: a `dataTask`/`downloadTask`/`uploadTask` created without `.resume()` never sends the request, and its completion never runs.
- **HTTP errors are not errors**: URLSession reports 4xx/5xx as success → error bodies decoded as data, 401s shown as empty content. Fix: check `(response as? HTTPURLResponse)?.statusCode` before decoding.
- **URL(string:) since iOS 17**: apps linked on iOS 17+ get invalid characters percent-encoded instead of `nil` → `nil`-based input validation now passes bad input. Fix: `URL(string:encodingInvalidCharacters: false)` or build with `URLComponents`.
- **"+" in query items**: `URLComponents.queryItems` leaves `+` unescaped (legal per RFC 3986) but form-style servers decode it as a space → phone numbers, emails, signatures corrupted. Fix: encode `+` as `%2B` via `percentEncodedQueryItems` (which traps on invalid encoding).
- **Default timeouts**: `timeoutIntervalForRequest` is 60 s of idle time and `timeoutIntervalForResource` 7 days; with `waitsForConnectivity`, requests wait up to the resource timeout → endless spinners. Fix: set a resource timeout.
- **Session per request**: a session strongly retains its delegate until `finishTasksAndInvalidate()`/`invalidateAndCancel()` → sessions created per call or per screen leak themselves and their delegate, with no connection reuse. Fix: long-lived sessions; invalidate the rest.
- **Sensitive responses on disk**: the default configuration caches responses in the shared `URLCache` on disk when headers allow → tokens and personal data persist. Fix: `.ephemeral` configuration, `urlCache = nil` or `Cache-Control: no-store`.
