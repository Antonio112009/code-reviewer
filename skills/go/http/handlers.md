---
name: net/http handlers
description: Handlers that continue after writing an error, headers or status set after the body, encode failures after 200, content sniffing XSS, silently ignored form errors and request/response use after the handler returns.
priority: 62
tags: [CWE-670, CWE-79, CWE-20]
activation:
  content:
    - '\bhttp\.(?:Error|Redirect|SetCookie|NotFound|ServeContent)\('
    - '\bw\.(?:WriteHeader|Write|Header)\('
    - '\br\.(?:FormValue|PostFormValue|ParseForm|Form|PostForm|Body|Context)\b'
    - '\bhttp\.ResponseWriter\b'
  examples:
    - 'http.Error(w, "bad request", http.StatusBadRequest)'
    - 'w.WriteHeader(http.StatusOK)'
    - 'name := r.FormValue("name")'
    - 'func handler(w http.ResponseWriter, r *http.Request) {}'
sources:
  - https://pkg.go.dev/net/http#Error
  - https://pkg.go.dev/net/http#ResponseWriter
  - https://pkg.go.dev/net/http#Request.FormValue
  - https://pkg.go.dev/net/http#DetectContentType
---
- **No return after an error**: `http.Error(w, …)` or `w.WriteHeader(403)` does not end the handler → the success path still runs its side effects and appends to the body. Fix: `return` immediately.
- **Late headers**: `w.Header().Set`, `http.SetCookie` or `WriteHeader` after the first `Write` (e.g., after `json.NewEncoder(w).Encode`) are ignored → status 200 on failures, missing cookies/CORS headers. Fix: headers, then status, then body.
- **Encoding after commit**: `json.NewEncoder(w).Encode(v)` failing midway can no longer change the 200 → clients get truncated JSON as success. Fix: marshal to bytes first, then write.
- **Content sniffing**: writing user-controlled bytes without `Content-Type` makes net/http sniff it (`DetectContentType`) → uploaded HTML/SVG served as `text/html` → XSS. Fix: explicit `Content-Type`, `X-Content-Type-Options: nosniff`, `Content-Disposition: attachment`.
- **Form helpers**: `r.FormValue`/`PostFormValue` ignore parse errors and oversized bodies (returning ""), and `FormValue` mixes query and body values → attacker picks the source. Fix: `r.ParseForm()` with error handling, read `r.PostForm`.
- **Use after return**: goroutines writing to `w` or reading `r` (body, form, headers) after the handler returned → data races, panics or writes to a recycled connection. Fix: copy what you need before returning.
- **Body read twice**: logging/auth middleware reading `r.Body` leaves an empty body for the handler. Fix: buffer it and reset `r.Body = io.NopCloser(bytes.NewReader(b))`.
