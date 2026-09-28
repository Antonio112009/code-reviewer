---
tier: full
name: Animated and Reanimated
description: Animation defects in React Native — native-driver animations of layout props, shared values read or mutated in render, JS calls from worklets, captured closures, and Reanimated 4 upgrade breakage (New Architecture only, worklets plugin, removed APIs).
priority: 60
activation:
  content:
    - '\bAnimated\.|\buseNativeDriver\b'
    - 'react-native-(?:reanimated|worklets)'
    - '\buse(?:SharedValue|AnimatedStyle|DerivedValue|AnimatedProps|AnimatedGestureHandler|WorkletCallback)\b'
    - '\b(?:runOnJS|runOnUI|scheduleOnRN|scheduleOnUI)\b|[''"]worklet[''"]'
  examples:
    - 'Animated.timing(value, { toValue: 1, useNativeDriver: true }).start();'
    - "import { useSharedValue } from 'react-native-reanimated';"
    - "const style = useAnimatedStyle(() => { 'worklet'; runOnJS(setCount)(1); return {}; });"
sources:
  - https://reactnative.dev/docs/animations
  - https://docs.swmansion.com/react-native-reanimated/docs/core/useSharedValue/
  - https://docs.swmansion.com/react-native-reanimated/docs/guides/migration-from-3.x/
  - https://docs.swmansion.com/react-native-worklets/docs/fundamentals/closures/
---
- **Native driver on layout props**: `useNativeDriver: true` animating `width`, `height`, `top`, `left`, `margin` or flex → runtime error; `Animated.event` with the native driver on PanResponder (bubbling events) is unsupported. Fix: animate `transform`/`opacity`, or Reanimated.
- **Shared values in render**: reading or writing `sv.value` in the component body → breaks render purity; each JS read blocks until the UI thread syncs. Fix: read in `useAnimatedStyle`/`useDerivedValue`/effects; with React Compiler use `get()`/`set()`.
- **Mutating objects**: `sv.value.x = 1` or `sv.value.push(…)` → UI never updates. Fix: assign a new object or use `sv.modify()`.
- **JS calls from worklets**: calling React state setters, navigation or non-worklet functions inside `useAnimatedStyle`, gesture callbacks or animation callbacks → crash on the UI runtime. Fix: `scheduleOnRN(fn, ...args)` (Reanimated 4) or `runOnJS(fn)(...)` (3.x).
- **Captured closures**: worklets get copies of captured variables → later JS-side mutations are invisible on the UI thread; large captured objects are copied repeatedly. Fix: shared values for cross-thread state.
- **Reanimated 4 upgrade**: New Architecture only; the Babel plugin moved to `react-native-worklets/plugin`; `useAnimatedGestureHandler`, `useWorkletCallback`, `combineTransition` removed; `withSpring` duration semantics changed → build errors, crashes, different timing. Fix: follow the 3.x migration guide.
