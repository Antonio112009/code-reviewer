---
name: StoreKit purchases
description: In-app purchase bugs that lose revenue or give content away — unverified transactions honoured, no Transaction.updates listener, finish() timing, revoked or expired entitlements kept, pending purchases mishandled, AppStore.sync() at launch and StoreKit 1 queue handling.
priority: 66
tags: [CWE-345]
activation:
  content:
    - '^[ \t]*import[ \t]+StoreKit\b|\bTransaction\.(?:updates|currentEntitlements|unfinished|all|latest)\b|\bVerificationResult\b|\bAppStore\.sync\b'
    - '\.purchase\(|\bPurchaseResult\b|\.finish\(\)|\brevocationDate\b|\bSKPaymentQueue\b|\bSKPaymentTransactionObserver\b|\bfinishTransaction\('
sources:
  - https://developer.apple.com/documentation/storekit/transaction/updates
  - https://developer.apple.com/documentation/storekit/transaction/finish()
  - https://developer.apple.com/documentation/storekit/transaction/currententitlements
  - https://developer.apple.com/documentation/storekit/appstore/sync()
---
- **Unverified transactions**: unlocking content for `.unverified` results, or reading `payloadValue` without checking → forged or tampered transactions grant access. Fix: act only on `.verified`, ideally confirm server-side.
- **No updates listener**: not iterating `Transaction.updates` from app launch → Ask to Buy approvals, renewals, refunds, offer codes and purchases from other devices are never processed; unfinished transactions delivered at launch are missed.
- **finish() timing**: never calling `finish()` redelivers the transaction on every launch; calling it before content is delivered and persisted loses paid consumables. Fix: deliver, save, then finish.
- **Stale entitlements**: access based on a stored flag instead of `Transaction.currentEntitlements`, ignoring `revocationDate`, `expirationDate` or `isUpgraded` → refunded or expired purchases stay unlocked.
- **Purchase results**: treating `.pending` (Ask to Buy, bank authentication) as failure or `.userCancelled` as an error, or not handling `.success(.unverified)` → duplicate purchase attempts and wrong UI.
- **sync() at launch**: `AppStore.sync()` shows an App Store sign-in prompt → call it only from an explicit Restore action.
- **StoreKit 1 queue**: an `SKPaymentTransactionObserver` added late, or `finishTransaction` not called for purchased/failed/restored transactions → the queue replays them forever.
