---
name: Collection API traps
description: Fixed-size and unmodifiable collections, null-hostile List.of/Map.of, views that leak or throw, ConcurrentModificationException in loops, Collectors.toMap failures and reliance on HashMap iteration order.
priority: 55
tags: [CWE-248, CWE-476]
activation:
  content:
    - '\bArrays\.asList\('
    - '\b(?:List|Set|Map)\.(?:of|copyOf|ofEntries)\('
    - '\.toList\(\)'
    - '\bCollectors\.(?:toMap|groupingBy|toSet|toUnmodifiable\w*)\('
    - '\bCollections\.(?:unmodifiable\w*|emptyList|emptyMap|emptySet)\('
    - '\.(?:subList|remove)\('
    - '\bnew\s+(?:HashMap|HashSet)\b'
sources:
  - https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/List.html#unmodifiable
  - https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Collectors.html
  - https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/ConcurrentModificationException.html
---
- **Fixed-size lists**: `Arrays.asList(...)` rejects `add`/`remove` and writes through to the array; `Arrays.asList(intArray)` is a one-element `List<int[]>`. Fix: `new ArrayList<>(...)`.
- **Unmodifiable results**: `List.of`, `Map.of`, `Stream.toList()` (JDK 16+) or `Collections.emptyList()` handed to code that later adds or sorts → `UnsupportedOperationException`. Fix: mutable copies where mutation is expected.
- **Null-hostile factories**: `List.of`/`Set.of`/`Map.of` throw NPE on nulls — even for `contains(null)` — and `IllegalArgumentException` on duplicates from runtime data. Fix: filter first or use `HashSet`/`HashMap`.
- **Views, not copies**: `Collections.unmodifiableList(list)` reflects later changes to `list`; a `subList` breaks after the parent changes and pins the parent in memory. Fix: `List.copyOf`, `new ArrayList<>(sub)`.
- **Remove while iterating**: `list.remove(x)` inside a for-each → `ConcurrentModificationException`, or the last element is silently skipped. Fix: `removeIf` or `Iterator.remove()`.
- **Collectors.toMap**: throws `IllegalStateException` on duplicate keys and NPE on null values. Fix: a merge function; handle nulls first.
- **Unspecified order**: output built from `HashMap`/`HashSet`/`groupingBy` iteration (JSON, CSV, paging, test expectations) varies across JDKs and sizes. Fix: `LinkedHashMap`/`TreeMap` or sort.
