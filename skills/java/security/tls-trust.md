---
name: TLS certificate and hostname verification
description: Disabled TLS verification in Java clients — trust-all TrustManagers, permissive HostnameVerifiers, raw SSLSocket/SSLEngine without endpoint identification, JVM-wide default overrides and legacy protocol versions.
priority: 76
tags: [CWE-295, CWE-297, CWE-757, A04:2025]
activation:
  content:
    - '\b(?:X509TrustManager|X509ExtendedTrustManager|TrustManager|HostnameVerifier|NoopHostnameVerifier|TrustAllStrategy|TrustSelfSignedStrategy|InsecureTrustManagerFactory|SSLSocketFactory|SSLEngine|SSLParameters)\b'
    - '\bSSLContext\.(?:getInstance|setDefault)\('
    - '\bsetDefault(?:SSLSocketFactory|HostnameVerifier)\('
    - '\.(?:setEnabledProtocols|hostnameVerifier|sslSocketFactory|trustManager)\('
sources:
  - https://docs.oracle.com/en/java/javase/25/security/java-secure-socket-extension-jsse-reference-guide.html
  - https://docs.oracle.com/en/java/javase/25/docs/api/java.base/javax/net/ssl/SSLParameters.html
---
- **Trust-all managers**: `X509TrustManager` with an empty `checkServerTrusted`, Apache `TrustAllStrategy`/`TrustSelfSignedStrategy`, Netty `InsecureTrustManagerFactory` or OkHttp trust-all `sslSocketFactory` → any certificate accepted (MITM). Fix: the default trust store or a dedicated `KeyStore`.
- **Permissive hostname checks**: a `HostnameVerifier` returning `true` or `NoopHostnameVerifier` → any valid certificate for any host passes. Fix: the default verifier.
- **Raw sockets skip hostnames**: `SSLSocketFactory.createSocket(...)` and `SSLEngine` verify the chain but not the hostname unless `SSLParameters.setEndpointIdentificationAlgorithm("HTTPS")` is set → MITM with any trusted certificate. Fix: set endpoint identification.
- **JVM-wide overrides**: `HttpsURLConnection.setDefaultSSLSocketFactory`/`setDefaultHostnameVerifier` or `SSLContext.setDefault` with lax settings disable verification for every library in the JVM. Fix: scope custom TLS to one client.
- **Legacy protocols**: `SSLContext.getInstance("SSL"/"TLSv1")`, `setEnabledProtocols` with TLSv1/1.1, or edits to `jdk.tls.disabledAlgorithms` re-enabling them (off by default since JDK 8u291/11.0.11/16) → downgrade attacks. Fix: TLSv1.2/1.3 only.
