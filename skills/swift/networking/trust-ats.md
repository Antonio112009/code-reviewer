---
name: App Transport Security and server trust
description: Transport security holes on Apple platforms — ATS disabled globally, NSAllowsArbitraryLoads silently ignored, trust challenges answered without evaluation, brittle certificate pinning, other auth challenges mishandled and TLS below URLSession that ATS doesn't cover.
priority: 68
category: security
tags: [CWE-295, CWE-319]
activation:
  content:
    - '<key>NS(?:AppTransportSecurity|AllowsArbitraryLoads\w*|AllowsLocalNetworking|ExceptionDomains|Exception\w+|PinnedDomains|Pinned\w+Identities)</key>'
    - '\bURLAuthenticationChallenge\b|\bdidReceive\s+challenge\b|\bserverTrust\b|\bSecTrust\w*|\bURLCredential\(trust:|\.useCredential\b|NSURLAuthenticationMethodServerTrust'
    - '\b(?:ServerTrustManager|DisabledTrustEvaluator|PinnedCertificatesTrustEvaluator|PublicKeysTrustEvaluator)\b|\bsec_protocol_options_set_verify_block\b|\bNWProtocolTLS\b'
  examples:
    - '<key>NSAllowsArbitraryLoads</key>'
    - 'completionHandler(.useCredential, URLCredential(trust: challenge.protectionSpace.serverTrust!))'
    - 'let evaluators = ["api.example.com": DisabledTrustEvaluator()]'
sources:
  - https://developer.apple.com/documentation/bundleresources/information-property-list/nsapptransportsecurity/nsallowsarbitraryloads
  - https://developer.apple.com/documentation/bundleresources/information-property-list/nsapptransportsecurity/nspinneddomains
  - https://developer.apple.com/documentation/security/preventing-insecure-network-connections
  - https://developer.apple.com/documentation/foundation/performing-manual-server-trust-authentication
---
- **ATS off globally**: `NSAllowsArbitraryLoads = YES` disables ATS for every domain and needs App Review justification. Fix: a per-host `NSExceptionDomains` entry, or `NSAllowsArbitraryLoadsInWebContent` for web views.
- **Silently ignored flag**: on iOS 10+ `NSAllowsArbitraryLoads` is ignored when `NSAllowsArbitraryLoadsInWebContent`, `NSAllowsArbitraryLoadsForMedia` or `NSAllowsLocalNetworking` is also present → cleartext requests that used to work fail.
- **Trust bypass**: a delegate answering `NSURLAuthenticationMethodServerTrust` with `.useCredential, URLCredential(trust:)` without a passing `SecTrustEvaluateWithError`, or on failure → any certificate accepted (MITM); often "debug-only" code that ships.
- **Brittle pinning**: pinning only the leaf certificate bytes with no backup pins, or comparing pins instead of evaluating trust first → outage at certificate rotation or acceptance of invalid chains. Fix: SPKI hashes with backups, or `NSPinnedDomains` (iOS 14+).
- **Other challenge types**: cancelling or answering Basic, client-certificate and proxy challenges as if they were server trust → broken auth. Fix: return `.performDefaultHandling` for methods you don't handle.
- **Below URLSession**: ATS doesn't cover Network.framework, sockets or custom TLS → a `sec_protocol_options_set_verify_block` that always succeeds, or Alamofire's `DisabledTrustEvaluator` in release, removes certificate checks.
