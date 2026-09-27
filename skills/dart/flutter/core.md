---
name: Flutter
description: Widget lifecycle, async BuildContext, disposal, rebuild, state-management and mobile-security defects in Flutter apps.
category: framework
priority: 62
tier: essential
tags:
  - CWE-295
  - CWE-312
  - CWE-749
  - OWASP-A04
activation:
  stack:
    - framework.flutter
  languages:
    - dart
  files:
    - "**/*.dart"
  content:
    - package:(?:flutter|flutter_riverpod|hooks_riverpod|riverpod|provider|flutter_bloc|go_router|webview_flutter|shared_preferences|dio)/
    - \b(?:StatefulWidget|StatelessWidget|BuildContext|setState|initState|FutureBuilder|StreamBuilder|ChangeNotifier)\b
---
- **Async gap**: `setState`, `Navigator.of(context)` or `context.read` after `await` or in timer/stream callbacks without a `mounted` check → errors on disposed widgets. Fix: check after each await.
- **Undisposed controllers**: `AnimationController`, `TextEditingController`, `ScrollController`, `FocusNode` or own `ChangeNotifier`s never disposed, listeners never removed → leaks, Ticker errors. Fix: release in `dispose()`.
- **Created in build**: `FutureBuilder(future: api())`, streams, controllers or `GlobalKey`s created in `build()` → refetch or resubscribe every rebuild, lost state. Fix: create in `initState`.
- **Ignored widget updates**: controllers, streams or futures derived from `widget.x` in `initState` without `didUpdateWidget` → a new id from the parent is ignored. Fix: compare `oldWidget`, recreate.
- **Wrong listen mode**: `context.watch`, `ref.watch` or listening `Provider.of` in callbacks → assertions, missed updates; `read` in `build` → never rebuilds. Fix: watch in `build`, read in callbacks.
- **Riverpod after dispose**: async notifier methods touching `state`/`ref` after `await` once an `autoDispose` provider was disposed → exceptions. Fix: check `ref.mounted` after awaits.
- **Missing keys**: stateful rows in reorderable/removable lists without keys → row state sticks to the wrong item. Fix: `ValueKey(item.id)`.
- **TLS disabled**: `badCertificateCallback` returning `true` on `HttpClient` or dio's `IOHttpClientAdapter` → MITM in release builds. Fix: remove it or pin certificates.
- **Plaintext tokens**: auth tokens or PII in `SharedPreferences`/Hive without encryption → readable from backups and rooted devices. Fix: `flutter_secure_storage`.
- **Snapshot misuse**: `snapshot.data!` in `FutureBuilder`/`StreamBuilder` without checking `hasError`/`connectionState` → null-check crash, or an endless spinner on errors. Fix: handle waiting, error and data.
- **WebView channels**: `JavaScriptMode.unrestricted` on untrusted URLs while `addJavaScriptChannel` handlers act without checking the current page → remote script drives native code. Fix: `NavigationDelegate` host allowlist.
