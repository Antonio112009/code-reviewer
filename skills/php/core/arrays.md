---
name: Arrays and references
description: PHP array traps — key coercion, array_merge renumbering, gaps that turn JSON lists into objects, array_filter without callback, foreach by reference, in-place sort returning bool, destructuring missing keys, iterator_to_array keys.
priority: 58
tags: [CWE-1024, CWE-704]
activation:
  content:
    - '\b(?:array_merge|array_filter|array_unique|array_diff|array_splice|array_walk|iterator_to_array)\s*\('
    - '\b(?:sort|rsort|usort|uasort|uksort|ksort|asort|shuffle)\s*\('
    - '\bforeach\s*\([^)\n]{1,200}as\s*(?:\$\w+\s*=>\s*)?&\$'
    - '\blist\s*\(|^[ \t]*\[[ \t]*(?:''\w+''[ \t]*=>[ \t]*)?\$\w+[ \t]*,'
  examples:
    - '$merged = array_merge($defaults, $options);'
    - 'usort($items, fn($a, $b) => $a->price <=> $b->price);'
    - 'foreach ($rows as $key => &$value) {'
    - '[$user, $host] = explode(''@'', $email);'
sources:
  - https://www.php.net/manual/en/language.types.array.php
  - https://www.php.net/manual/en/function.array-merge.php
  - https://www.php.net/manual/en/control-structures.foreach.php
  - https://www.php.net/manual/en/migration82.incompatible.php
---
- **Key coercion**: key `'8'` becomes int 8 (`'08'` stays a string), `true` becomes 1, `null` becomes `''` → ID-keyed maps return ints that fail `===` or collide.
- **array_merge renumbers**: integer keys are reindexed, so id-keyed maps lose their ids. Fix: `array_replace()` or `+`; avoid `array_merge` inside loops (quadratic copying).
- **Gaps become JSON objects**: `array_filter`, `array_unique`, `array_diff`, `unset()` keep keys → `json_encode` emits `{"0":…,"2":…}` instead of a list. Fix: `array_values()`.
- **array_filter without callback**: also drops `'0'`, `0`, `''` and `[]` → valid zeros vanish. Fix: pass an explicit callback.
- **foreach by reference**: `foreach ($a as &$v)` without `unset($v)` → the next loop over `$v` overwrites the last element. Fix: `unset($v)` after the loop.
- **In-place functions**: `sort`, `usort`, `shuffle`, `array_splice` mutate the argument and return bool/int → `$sorted = sort($items)` stores `true`.
- **Destructuring**: `[$user, $host] = explode('@', $s)` yields `null` plus a warning for missing parts and keeps going. Fix: check `count()` first.
- **iterator_to_array keys**: keys are preserved by default, so generators with `yield from` or repeated keys overwrite rows. Fix: `iterator_to_array($it, false)`.
