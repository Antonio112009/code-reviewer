---
name: Text input and keyboard
description: TextInput and keyboard defects in React Native — taps swallowed by keyboardShouldPersistTaps, passwords shown by unsupported secureTextEntry combos, missing autofill hints, controlled-value rewrites, unreliable onBlur text and KeyboardAvoidingView misuse.
priority: 60
activation:
  content:
    - '<TextInput\b|\bsecureTextEntry\b|\btextContentType\b'
    - '\bkeyboardShouldPersistTaps\b|\bKeyboardAvoidingView\b|\bkeyboardType\b'
    - '\bonChangeText\b|\bonEndEditing\b'
sources:
  - https://reactnative.dev/docs/textinput
  - https://reactnative.dev/docs/scrollview
  - https://reactnative.dev/docs/keyboardavoidingview
  - https://reactnative.dev/blog/2026/06/11/react-native-0.86
---
- **Taps swallowed**: forms inside `ScrollView`/`FlatList` with default `keyboardShouldPersistTaps` (`'never'`) → the first tap on Submit or a list item only dismisses the keyboard. Fix: `keyboardShouldPersistTaps="handled"`.
- **Password shown**: `secureTextEntry` with `multiline`, or on Android with `keyboardType="email-address"`/`"phone-pad"` → not honored, the secret is visible. Fix: single-line input, default keyboard.
- **No autofill hints**: password/OTP fields without `autoComplete` (`'password'`, `'new-password'`, `'one-time-code'`, Android `'sms-otp'`) → password managers and SMS code autofill fail. Fix: set it; a conflicting iOS `textContentType` wins over it.
- **Controlled rewrites**: `onChangeText` that masks, trims or uppercases and writes back to `value` (especially via async state) → flicker, cursor jumps, dropped characters. Fix: `maxLength`, format on blur, or an uncontrolled input.
- **onBlur text**: reading `e.nativeEvent.text` in `onBlur` → may be undefined. Fix: keep the value in state or use `onEndEditing`.
- **Keyboard covering inputs**: one `KeyboardAvoidingView` `behavior` for both platforms, or nested inside screens that already resize → double offsets or hidden fields; on Android 15+ edge-to-edge it misbehaved before 0.86. Fix: platform-specific `behavior`, test Android 15.
- **Keyboard type as validation**: `keyboardType="numeric"`/`"email-address"` assumed to restrict input → paste and hardware keyboards insert anything. Fix: parse and validate the value.
