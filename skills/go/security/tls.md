---
name: crypto/tls configuration
description: Disabled certificate verification, custom VerifyPeerCertificate callbacks without chain checks, client-certificate modes that accept anything, missing ServerName and legacy TLS versions or GODEBUG overrides removed in Go 1.27.
priority: 76
tags: [CWE-295, CWE-297, CWE-326]
activation:
  content:
    - '\bInsecureSkipVerify\b'
    - '\btls\.(?:Config|Dial\w{0,10}|Client|Server|Listen|VersionTLS1[0-3]|RequireAnyClientCert|RequestClientCert|VerifyClientCertIfGiven)\b'
    - '\bVerify(?:PeerCertificate|Connection)\b'
    - '\b(?:ClientAuth|ClientCAs|RootCAs|ServerName|MinVersion|CipherSuites)\s*:'
    - '\b(?:tls10server|tlsrsakex|tls3des|x509keypairleaf)\b'
  examples:
    - 'tlsConfig := &tls.Config{InsecureSkipVerify: true}'
    - 'VerifyPeerCertificate: verifyCallback,'
    - 'ClientAuth: tls.RequireAndVerifyClientCert,'
    - '//go:debug tls10server=0'
sources:
  - https://pkg.go.dev/crypto/tls#Config
  - https://go.dev/doc/go1.27
  - https://go.dev/doc/godebug
---
- **Verification off**: `InsecureSkipVerify: true` (often "temporary" or toggled by env/config) accepts any certificate → MITM. Fix: add the private CA to `RootCAs`; test servers via `httptest.NewTLSServer().Client()`.
- **Custom verification**: with InsecureSkipVerify, `VerifyPeerCertificate` receives `verifiedChains == nil`; callbacks that only compare CN/SANs or issuer names without verifying the chain accept forged certs, and the callback is skipped on resumed sessions. Fix: `VerifyConnection` + `x509.Certificate.Verify` with `DNSName`.
- **mTLS that trusts anyone**: `ClientAuth: tls.RequireAnyClientCert`/`RequestClientCert` accept any self-signed client cert and `VerifyClientCertIfGiven` accepts clients without one → authentication bypass unless the app verifies. Fix: `RequireAndVerifyClientCert` + `ClientCAs`.
- **Missing ServerName**: `tls.Dial`/custom `DialTLSContext` to an IP or through a tunnel without `ServerName` fails verification, which then gets "fixed" with InsecureSkipVerify. Fix: set `ServerName`.
- **Legacy versions**: explicit `MinVersion: tls.VersionTLS10/11`, RSA key exchange or 3DES suites; `godebug`/`//go:debug` lines setting `tls10server`, `tlsrsakex`, `tls3des` or `x509keypairleaf` to old values fail to build on Go 1.27 (settings removed). Fix: TLS 1.2+ defaults.
