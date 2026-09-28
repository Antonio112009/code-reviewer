---
name: Network security configuration
description: Transport security of Android apps — cleartext allowed globally, user CAs trusted in release, trust-all TrustManager/HostnameVerifier, pinning without backup pins, TLS 1.0/1.1 removal (targetSdk 35) and Certificate Transparency by default (targetSdk 37).
priority: 70
tags: [CWE-319, CWE-295, OWASP-A04]
activation:
  files: ["**/res/xml/network_security_config*.xml"]
  content:
    - '\bcleartextTrafficPermitted\b|\busesCleartextTraffic\b'
    - '<(?:base-config|domain-config|debug-overrides|trust-anchors|pin-set|certificateTransparency)\b'
    - 'src="user"'
    - '\bX509TrustManager\b|\bHostnameVerifier\b|\bhostnameVerifier\s*[({]'
    - '\bCertificatePinner\b'
    - '\bsslSocketFactory\s*\('
    - '\bConnectionSpec\b|\bTlsVersion\.TLS_1_[01]\b'
  examples:
    - 'android:usesCleartextTraffic="true"'
    - '<domain-config cleartextTrafficPermitted="false">'
    - '<certificates src="user" />'
    - 'client.hostnameVerifier { _, _ -> true }'
    - 'val pinner = CertificatePinner.Builder().add("example.com", pin).build()'
    - 'builder.sslSocketFactory(sslSocketFactory, trustManager)'
    - 'ConnectionSpec.Builder(ConnectionSpec.MODERN_TLS).tlsVersions(TlsVersion.TLS_1_0).build()'
sources:
  - https://developer.android.com/privacy-and-security/security-config
  - https://developer.android.com/privacy-and-security/risks/unsafe-trustmanager
  - https://developer.android.com/privacy-and-security/risks/unsafe-hostname
  - https://developer.android.com/about/versions/15/behavior-changes-15
---
- **Cleartext everywhere**: `android:usesCleartextTraffic="true"` or `cleartextTrafficPermitted="true"` on `<base-config>` (instead of one dev domain) → every host may use HTTP (blocked by default since API 28). Fix: per-domain `<domain-config>`, only in debug variants.
- **User CAs in release**: `<certificates src="user"/>` under `<base-config>`/`<domain-config>` instead of `<debug-overrides>` → any user- or MDM-installed CA can intercept production traffic. Fix: keep user CAs in `<debug-overrides>` (applies only to debuggable builds).
- **Trust-all code**: custom `X509TrustManager` with empty `checkServerTrusted`, `HostnameVerifier { _, _ -> true }`, or OkHttp `sslSocketFactory`/`hostnameVerifier` overrides → MITM. Fix: platform defaults; custom CAs via network security config.
- **Brittle pinning**: a single leaf-certificate pin (`<pin-set>` or `CertificatePinner`) with no backup key → app-wide outage on certificate rotation; an `expiration` silently disables pinning afterwards. Fix: pin SPKI of CA/intermediate plus a backup key.
- **Legacy TLS**: targetSdk 35 disallows TLS 1.0/1.1; `ConnectionSpec` forcing `TLS_1_0/1_1` or legacy servers → handshake failures. Fix: TLS 1.2+ on servers.
- **Certificate Transparency**: targetSdk 37 enables CT checks by default for system trust anchors → hosts with certificates missing SCTs fail. Fix: fix the certificate chain; opt out per domain only as a stopgap.
