---
tier: full
name: React Native accessibility
description: Screen-reader and motor accessibility defects in React Native — unlabeled icon buttons, missing roles and states, accessible containers swallowing inner controls, overlays without modal semantics, tiny targets, disabled font scaling and silent status changes.
priority: 56
activation:
  content:
    - '\baccessib\w+|\baria-[a-z]+|\brole='
    - '<(?:Pressable|TouchableOpacity|TouchableHighlight|TouchableWithoutFeedback)\b'
    - '\b(?:hitSlop|allowFontScaling|maxFontSizeMultiplier|importantForAccessibility|AccessibilityInfo)\b'
  examples:
    - '<Pressable accessibilityLabel="Delete item" onPress={onDelete}>'
    - 'hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}'
sources:
  - https://reactnative.dev/docs/accessibility
  - https://reactnative.dev/docs/accessibilityinfo
  - https://reactnative.dev/blog/2026/04/07/react-native-0.85
  - https://developer.apple.com/design/human-interface-guidelines/accessibility
---
- **Unlabeled icon buttons**: `Pressable`/`Touchable*` holding only an icon or image, without `accessibilityLabel`/`aria-label` → announced as "button" or nothing. Fix: label the action.
- **Missing role and state**: custom buttons, tabs, checkboxes, switches without `role`/`accessibilityRole` (Pressable has none) and `accessibilityState`/`aria-checked|selected|expanded|disabled` → type and state not announced. Fix: set both.
- **Swallowed controls**: `accessible` on a container (or a Touchable wrapping) that holds other buttons → inner controls (delete, like) become unreachable for screen readers. Fix: don't group containers with own controls; expose `accessibilityActions`.
- **Overlays leak focus**: custom modals, drawers, sheets without `accessibilityViewIsModal` (iOS) and `importantForAccessibility="no-hide-descendants"` on the background (Android) → screen-reader focus moves behind. Fix: set both.
- **Tiny targets**: touch areas below ~44×44 pt (iOS) / 48×48 dp (Android) → mis-taps. Fix: padding or `hitSlop`.
- **Font scaling disabled**: `allowFontScaling={false}`, low `maxFontSizeMultiplier` or fixed `height` on text containers → text doesn't grow or clips at large system sizes. Fix: allow scaling, flexible heights.
- **Silent status changes**: errors, results or loading states shown only visually; `accessibilityLiveRegion` is Android-only → iOS users hear nothing. Fix: `AccessibilityInfo.announceForAccessibility`; replace `setAccessibilityFocus` (deprecated 0.85) with `sendAccessibilityEvent`.
