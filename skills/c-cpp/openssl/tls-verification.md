---
name: OpenSSL TLS verification and I/O errors
description: OpenSSL TLS defects — no peer verification by default, missing hostname checks, accept-all verify callbacks, verify results without a certificate, tri-state X509_verify_cert, stale error queues and unexpected-EOF handling (1.1.1–4.0).
priority: 85
tags: [CWE-295, CWE-297, CWE-252]
activation:
  content:
    - '\bSSL_(?:CTX_)?set_verify\w*\s*\(|\bSSL_VERIFY_\w+'
    - '\bSSL_(?:set1_host|add1_host|set1_dnsname|set1_ipaddr|set_tlsext_host_name|get_verify_result|get1?_peer_certificate|get0_peer_certificate|connect|get_error|CTX_new)\s*\('
    - '\bX509_(?:VERIFY_PARAM_set1_host|check_host|verify_cert)\s*\(|\bSSL_OP_IGNORE_UNEXPECTED_EOF\b'
sources:
  - https://docs.openssl.org/3.5/man3/SSL_CTX_set_verify/
  - https://docs.openssl.org/3.5/man3/SSL_get_verify_result/
  - https://docs.openssl.org/master/man3/SSL_set1_host/
  - https://docs.openssl.org/3.5/man3/SSL_get_error/
---
- **No verification by default**: clients without `SSL_CTX_set_verify(ctx, SSL_VERIFY_PEER, …)` complete the handshake whatever the certificate (`SSL_VERIFY_NONE` is the default) → MITM. Fix: `SSL_VERIFY_PEER` plus trusted roots.
- **No hostname check**: chain verification alone accepts any valid certificate for any host. Fix: `SSL_set1_host` (1.1.0+; 4.0 prefers `SSL_set1_dnsname`/`SSL_set1_ipaddr`), plus SNI via `SSL_set_tlsext_host_name`.
- **Accept-all callbacks**: a verify callback returning 1 regardless of `preverify_ok` turns every verification failure into success. Fix: return `preverify_ok` unless a specific error is deliberately waived.
- **No certificate, no error**: `SSL_get_verify_result()` returns `X509_V_OK` when the peer sent no certificate. Fix: also require a non-NULL `SSL_get1_peer_certificate` (3.0+).
- **Tri-state chain result**: `X509_verify_cert()` returns 1, 0 or a negative error; `if (X509_verify_cert(ctx))` accepts errors. Fix: compare `== 1`.
- **Stale error queue**: before OpenSSL 4.0, leftover errors on the thread's queue make `SSL_get_error()` misreport I/O results. Fix: `ERR_clear_error()` before `SSL_read`/`SSL_write`.
- **Unexpected EOF**: since 3.0 a missing close_notify is `SSL_ERROR_SSL`, not `SSL_ERROR_SYSCALL` with errno 0; `SSL_OP_IGNORE_UNEXPECTED_EOF` hides truncation. Fix: use it only if the protocol detects truncation.
