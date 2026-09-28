---
name: WebView
description: WebView attack surface — JavaScript bridges reachable by untrusted frames, file:// access settings, ignored SSL errors, unsafe URL-loading decisions, untrusted input in loadUrl/evaluateJavascript and remote debugging left on in release.
priority: 72
tags: [CWE-749, CWE-295, CWE-79, CWE-939]
activation:
  content:
    - '\bWebView\b'
    - '\baddJavascriptInterface\s*\('
    - '@JavascriptInterface\b'
    - '\b(?:allowFileAccess|allowFileAccessFromFileURLs|allowUniversalAccessFromFileURLs|allowContentAccess|javaScriptEnabled)\b'
    - '\bset(?:AllowFileAccess|AllowFileAccessFromFileURLs|AllowUniversalAccessFromFileURLs|JavaScriptEnabled)\s*\('
    - '\bonReceivedSslError\b'
    - '\bshouldOverrideUrlLoading\b'
    - '\b(?:loadUrl|evaluateJavascript|postWebMessage|addWebMessageListener|setWebContentsDebuggingEnabled)\s*\('
  examples:
    - 'val webView = WebView(context)'
    - 'webView.addJavascriptInterface(bridge, "Android")'
    - '@JavascriptInterface fun getToken(): String = authToken'
    - 'settings.javaScriptEnabled = true'
    - 'webSettings.setAllowFileAccessFromFileURLs(true)'
    - 'override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) { handler.proceed() }'
    - 'override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {'
    - 'webView.loadUrl(intent.data.toString())'
sources:
  - https://developer.android.com/privacy-and-security/risks/insecure-webview-native-bridges
  - https://developer.android.com/privacy-and-security/risks/webview-unsafe-file-inclusion
  - https://developer.android.com/privacy-and-security/risks/unsafe-uri-loading
  - https://developer.android.com/develop/ui/views/layout/webapps/load-local-content
---
- **Bridge exposed to untrusted content**: `addJavascriptInterface` on a WebView that loads remote, user-supplied or redirected pages → every frame (ads, iframes, XSS) calls native methods. Fix: `addWebMessageListener` with `allowedOriginRules`; never `*` origins.
- **file:// access**: `allowFileAccessFromFileURLs`/`allowUniversalAccessFromFileURLs = true`, or `allowFileAccess` left at its pre-API-30 default `true`, while rendering untrusted HTML → local files, cookies and app data exfiltrated. Fix: all false; serve assets via `WebViewAssetLoader` over `https`.
- **SSL errors ignored**: `onReceivedSslError { handler.proceed() }` → any MITM certificate accepted. Fix: `handler.cancel()`.
- **Unsafe URL decisions**: `shouldOverrideUrlLoading` returning `false` for every URL, or launching `intent:`/custom schemes from page links → attacker pages load in-app with bridges and cookies. Fix: exact scheme+host allowlist; open others in the browser.
- **Untrusted input**: `loadUrl(intent.data)` or `evaluateJavascript("show('$msg')")` → open redirect, `javascript:` URLs, script injection. Fix: validate URLs; pass data via `postWebMessage` or JSON-quoted strings.
- **Debugging in release**: `WebView.setWebContentsDebuggingEnabled(true)` unconditionally → anyone with USB/ADB inspects DOM and tokens. Fix: enable only for debuggable builds.
