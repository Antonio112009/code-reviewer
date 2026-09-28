---
tier: full
name: Compose accessibility
description: Accessibility failures in Compose that block TalkBack, switch and large-font users — missing content descriptions, click handlers built from raw pointer input, small touch targets, unscalable text, unmerged rows and unannounced toggle state.
priority: 60
activation:
  content:
    - '\bcontentDescription\s*=\s*null\b'
    - '\b(?:Image|Icon|IconButton)\s*\('
    - '\b(?:pointerInput|detectTapGestures)\s*[({]'
    - '\.clickable\s*[({]'
    - '\.(?:size|height|width)\s*\(\s*\d{1,2}\.dp\s*\)'
    - '\bfontSize\s*=\s*\d+(?:\.\d+)?\.dp\b|\.toSp\(\)'
    - '\b(?:semantics|clearAndSetSemantics)\s*[({]'
  examples:
    - 'Icon(Icons.Default.Close, contentDescription = null)'
    - 'Modifier.pointerInput(Unit) { detectTapGestures { onTap() } }'
    - 'Modifier.clickable { onItemClick(item) }'
    - 'Modifier.size(24.dp)'
    - 'style = TextStyle(fontSize = 14.dp)'
    - 'Modifier.semantics { contentDescription = "Close" }'
sources:
  - https://developer.android.com/develop/ui/compose/accessibility/key-steps
  - https://developer.android.com/develop/ui/compose/accessibility/semantics
  - https://developer.android.com/guide/topics/ui/accessibility/apps
---
- **Missing descriptions**: `Image`/`Icon` that carry meaning (icon-only buttons, status icons) with `contentDescription = null` → TalkBack announces nothing or "unlabeled button". Fix: a meaningful description; `null` only for decorative images.
- **Raw pointer clicks**: taps handled with `pointerInput { detectTapGestures { … } }` instead of `clickable`/`toggleable` expose no click action → unreachable for TalkBack, switch access and keyboards. Fix: `clickable(role = Role.Button)` or `semantics { onClick(…) }`.
- **Small touch targets**: custom clickable icons or boxes sized under 48 dp without `minimumInteractiveComponentSize()` → hard to hit for motor-impaired users. Fix: at least 48×48 dp touch area.
- **Unscalable text**: font sizes in `dp`, fixed `height()` on text containers or `maxLines = 1` without overflow → text doesn't scale or gets clipped at 200% font scale. Fix: `sp`, `heightIn(min = …)`, allow wrapping.
- **Unmerged rows and silent state**: rows whose icon and texts get focus separately, switches built from `clickable` without `toggleable`/`stateDescription`, or `clearAndSetSemantics {}` on real content → meaning and state not announced. Fix: `mergeDescendants = true`, `toggleable(role = Role.Switch)`.
