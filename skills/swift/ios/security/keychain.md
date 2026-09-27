---
name: Keychain storage
description: Keychain Services mistakes — SecItemAdd duplicates and ignored OSStatus, locked-device errors treated as logout, accessibility classes, over-broad queries, iCloud-synchronizable items, items surviving reinstall, the macOS legacy keychain and SecItem calls on the main thread.
tags: [CWE-522, CWE-311]
activation:
  content: ['\bSecItem(?:Add|CopyMatching|Update|Delete)\b|\bkSec(?:Attr|Class|Value|Return|Match|Use)\w*|\bSecAccessControl\w*|\berrSec\w+']
sources:
  - https://developer.apple.com/documentation/security/updating-and-deleting-keychain-items
  - https://developer.apple.com/documentation/security/restricting-keychain-item-accessibility
  - https://developer.apple.com/documentation/security/ksecattrsynchronizable
  - https://developer.apple.com/documentation/security/ksecusedataprotectionkeychain
---
- **Add instead of update**: `SecItemAdd` returns `errSecDuplicateItem` when an item with the same primary attributes exists → an ignored `OSStatus` leaves the old token in place. Fix: `SecItemUpdate`, adding only on `errSecItemNotFound`.
- **Locked device = logged out**: treating any `SecItemCopyMatching` failure as "no token" → `errSecInteractionNotAllowed` (device locked) during background refresh or push handling wipes sessions. Fix: distinguish not-found from locked and retry later.
- **Accessibility class**: the default `kSecAttrAccessibleWhenUnlocked` fails in background while locked → items used by background work need `AfterFirstUnlock`; secrets that must not migrate via backups need `…ThisDeviceOnly`.
- **Over-broad queries**: queries without `kSecAttrService`/`kSecAttrAccount` make `SecItemUpdate`/`SecItemDelete` affect every item of that class → logout wipes other accounts' or SDKs' items.
- **Synchronizable items**: `kSecAttrSynchronizable = true` sends secrets to iCloud Keychain and updates/deletes hit all devices; queries without `kSecAttrSynchronizableAny` miss synced items.
- **Survives reinstall**: keychain items can outlive app deletion → a fresh install silently reuses old sessions. Fix: clear them on first launch (flag in `UserDefaults`).
- **macOS legacy keychain**: without `kSecUseDataProtectionKeychain: true`, macOS uses the file-based keychain (ACL prompts, different access groups). Fix: set it on every query.
- **Main-thread calls**: `SecItem*` block the calling thread → launch and UI hangs. Fix: call them off the main thread.
