---
name: Play Billing purchase handling
description: Revenue-losing Play Billing defects — purchases not acknowledged or consumed within three days, entitlement granted for PENDING purchases or without server verification, purchases missed while the app was closed, manual reconnection with auto-reconnect and outdated library versions.
priority: 68
tags: [CWE-345, CWE-841]
activation:
  content:
    - '\b(?:acknowledgePurchase|consumeAsync|consumePurchase)\s*\('
    - '\bPurchase\.PurchaseState\b|\bpurchaseState\b'
    - '\bonPurchasesUpdated\s*\('
    - '\bqueryPurchases(?:Async)?\s*\('
    - '\b(?:startConnection|enableAutoServiceReconnection|enablePendingPurchases)\s*\('
    - '\blaunchBillingFlow\s*\('
    - 'com\.android\.billingclient:billing'
sources:
  - https://developer.android.com/google/play/billing/integrate
  - https://developer.android.com/google/play/billing/security
  - https://developer.android.com/google/play/billing/deprecation-faq
---
- **Not acknowledged**: purchases that are neither acknowledged (non-consumables, subscriptions) nor consumed (consumables) within three days are automatically refunded and the entitlement revoked. Fix: acknowledge/consume after granting, on every code path (including restores).
- **Granting PENDING purchases**: unlocking content in `onPurchasesUpdated` without checking `purchaseState == PURCHASED` → users get items for cash payments that never complete. Fix: grant only on `PURCHASED`; show pending UI otherwise; don't acknowledge while pending.
- **Unverified purchases**: granting entitlement from the client callback alone → forged or replayed purchase tokens unlock content. Fix: verify the token on your backend (Play Developer API) and bind it to the account (`setObfuscatedAccountId`).
- **Missed purchases**: handling purchases only in `onPurchasesUpdated` → purchases completed while the app was killed, on another device or outside the app are never granted or acknowledged. Fix: `queryPurchasesAsync()` after each successful connection and on resume.
- **Double reconnection**: with `enableAutoServiceReconnection()` (PBL 8), also calling `startConnection()` in `onBillingServiceDisconnected` → racing connections. Fix: pick one strategy.
- **Outdated library**: from Aug 31, 2026 new apps and updates must use Billing Library 8+ (extension to Nov 1, 2026) → release blocked. Fix: upgrade and migrate removed APIs.
