---
name: Incoming intents and deep links
description: Untrusted Intent and deep-link input — intent redirection, Intent.parseUri from web content, deep-link parameters driving navigation, WebView or account actions, unverified App Links, string-based host checks and deserialized extras.
priority: 72
tags: [CWE-940, CWE-939, CWE-502, OWASP-A01]
activation:
  content:
    - '\bgetParcelableExtra\b'
    - '\bgetSerializableExtra\b'
    - '\bIntent\.parseUri\s*\('
    - '\bintent\.(?:data|extras|getStringExtra)\b'
    - '\bandroid:autoVerify\b'
    - '<data\s+android:(?:scheme|host)\b'
    - '\bremoveLaunchSecurityProtection\b'
    - '\bdeepLinks?\b|\bnavDeepLink\b'
  examples:
    - 'val next = intent.getParcelableExtra<Intent>("next")'
    - 'val obj = intent.getSerializableExtra("payload")'
    - 'val target = Intent.parseUri(url, Intent.URI_INTENT_SCHEME)'
    - 'val id = intent.getStringExtra("id")'
    - 'android:autoVerify="true"'
    - '<data android:scheme="https" android:host="example.com" />'
    - 'forwardedIntent.removeLaunchSecurityProtection()'
    - 'composable("details/{id}", deepLinks = listOf(navDeepLink { uriPattern = "app://details/{id}" }))'
sources:
  - https://developer.android.com/privacy-and-security/risks/intent-redirection
  - https://developer.android.com/privacy-and-security/risks/unsafe-use-of-deeplinks
  - https://developer.android.com/privacy-and-security/risks/unsafe-uri-loading
  - https://developer.android.com/privacy-and-security/risks/unsafe-deserialization
---
- **Intent redirection**: a nested `Intent` from extras (`getParcelableExtra("next")`) passed to `startActivity`/`startService`/`sendBroadcast`/`setResult` → attackers reach unexported components and inherit `FLAG_GRANT_*_URI_PERMISSION` grants. Fix: allowlist the resolved component, strip grant flags or `IntentSanitizer`.
- **Opting out of Android 16 hardening**: `removeLaunchSecurityProtection()` on forwarded intents disables the platform's redirection protection. Fix: validate instead.
- **parseUri from web content**: `Intent.parseUri(url, URI_INTENT_SCHEME)` on WebView/deep-link input then `startActivity` → arbitrary component launch. Fix: `addCategory(BROWSABLE)`, `component = null`, `selector = null`.
- **Deep links as trusted commands**: link parameters that skip login, load a WebView URL, change account settings or pay without re-checking auth → one tap by the victim triggers it. Fix: allowlist values, re-check state, ask for confirmation.
- **Hijackable links**: custom schemes or `https` links without `android:autoVerify="true"` (or failing Digital Asset Links) → other apps register the same link and capture magic-link tokens or OAuth codes. Fix: verified App Links, PKCE, no secrets in URLs.
- **String host checks**: `url.startsWith("https://trusted.com")`/`contains(...)` → `trusted.com.evil.io` or `@` tricks pass. Fix: `Uri.parse`, compare `scheme` and exact `host`.
- **Serializable extras**: `getSerializableExtra` on intents from other apps → unsafe Java deserialization. Fix: typed `Parcelable`/primitive extras.
