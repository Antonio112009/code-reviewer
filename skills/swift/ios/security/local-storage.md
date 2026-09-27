---
name: Local data storage and logging
description: Sensitive data exposed on device — secrets in UserDefaults and plain files, missing or too-strict file protection, personal data in logs (Logger redacts strings but not numbers), clipboard content shared across devices, user data in purgeable directories and app-switcher snapshots.
tags: [CWE-312, CWE-532, CWE-200]
activation:
  content:
    - '\bUserDefaults\b|@(?:AppStorage|SceneStorage)\b|\bNSKeyedArchiver\b|\.write\(to:|\bFileManager\b|\b(?:caches|documents)Directory\b|\bisExcludedFromBackup\b'
    - '\b(?:complete|completeUnlessOpen|completeUntilFirstUserAuthentication)FileProtection\b|\bFileProtectionType\b|\bfileProtection\b'
    - '\bprivacy:\s*\.public\b|\bNSLog\(|\bos_log\(|\bLogger\(|\bUIPasteboard\b'
sources:
  - https://developer.apple.com/documentation/uikit/encrypting-your-app-s-files
  - https://developer.apple.com/documentation/os/generating-log-messages-from-your-code
  - https://developer.apple.com/documentation/uikit/uipasteboard/optionskey/localonly
---
- **Secrets in defaults or files**: tokens, passwords or personal data in `UserDefaults`, `@AppStorage`, plists or JSON files → unencrypted in the app container and in device backups. Fix: Keychain.
- **File protection**: files get `completeUntilFirstUserAuthentication` by default → sensitive files need `.completeFileProtection`, but those can't be read while locked, so background tasks need a weaker class.
- **Personal data in logs**: `print`/`NSLog`, or `Logger` values marked `privacy: .public`, expose tokens and personal data in device logs and sysdiagnoses; `Logger` redacts dynamic strings by default but not integers, floats or bools. Fix: `privacy: .private`/`.private(mask: .hash)`.
- **Clipboard**: copying one-time codes or passwords to `UIPasteboard.general` without `.localOnly` and `.expirationDate` → sent to other devices via Universal Clipboard and readable later.
- **Purgeable locations**: user-created data in `cachesDirectory` or `tmp` can be deleted by the system → data loss. Fix: Application Support, excluded from backup only if re-downloadable.
- **App-switcher snapshots**: screens with balances, health or messages are captured in the multitasking snapshot unless hidden when the scene becomes inactive.
