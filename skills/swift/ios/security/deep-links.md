---
name: URL schemes, universal links and OAuth callbacks
description: Deep-link handlers as an attack surface — state-changing actions triggered by links, unvalidated URL parameters, custom schemes that other apps can claim and OAuth sign-in inside embedded web views.
tags: [CWE-939, CWE-601]
activation:
  content:
    - '\bonOpenURL\b|\bopenURLContexts\b|\bcontinue\s+userActivity\b|\bNSUserActivityTypeBrowsingWeb\b|\bwebpageURL\b|\bopen\s+url:\s*URL\b'
    - '\bASWebAuthenticationSession\b|\bcallbackURLScheme\b|<key>(?:CFBundleURLTypes|CFBundleURLSchemes)</key>|\bapplinks:'
sources:
  - https://developer.apple.com/documentation/xcode/defining-a-custom-url-scheme-for-your-app
  - https://developer.apple.com/documentation/xcode/supporting-universal-links-in-your-app
  - https://developer.apple.com/documentation/authenticationservices/aswebauthenticationsession
  - https://datatracker.ietf.org/doc/html/rfc8252#section-8.12
---
- **Actions from links**: URL-scheme or universal-link handlers that pay, transfer, delete, change account data or log in with a token parameter without validation and user confirmation → any web page or app can trigger them.
- **Unvalidated parameters**: link parameters used as web-view URLs, redirect targets, file paths or API hosts → in-app phishing, open redirects, path traversal. Fix: parse with `URLComponents`, allowlist values, reject malformed URLs.
- **Claimable schemes**: any app can register the same custom URL scheme, and which app opens is undefined → OAuth codes or magic-login tokens intercepted. Fix: universal links, or `ASWebAuthenticationSession` (callback goes only to the caller) with PKCE.
- **Embedded sign-in**: third-party OAuth in `WKWebView` exposes the user's credentials to the app and violates RFC 8252 (native apps must use an external user-agent). Fix: `ASWebAuthenticationSession`.
