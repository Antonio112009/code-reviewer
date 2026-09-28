---
name: Boxing, unboxing and wrapper equality
description: Wrapper-type traps — == on Integer/Long outside the -128..127 cache, NullPointerException from unboxing (including ternaries), mismatched Long/Integer keys, the List.remove(int) overload and switch on null.
priority: 58
tags: [CWE-595, CWE-476]
activation:
  content:
    - '\b(?:Integer|Long|Short|Byte|Character|Boolean|Double|Float)\b'
  examples:
    - 'Integer count = map.get(key);'
sources:
  - https://docs.oracle.com/javase/specs/jls/se25/html/jls-5.html#jls-5.1.7
  - https://docs.oracle.com/javase/specs/jls/se25/html/jls-15.html#jls-15.25
  - https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/List.html
---
- **`==` on wrappers**: `Integer`/`Long`/`Short`/`Character` compared with `==`/`!=` are only guaranteed identical inside the cached -128..127 range → passes tests with small ids, fails in production. Fix: `equals`/`Objects.equals` or compare primitives.
- **Unboxing null**: `int n = map.get(k)`, `if (dto.getActive())` on a `Boolean`, or arithmetic on a nullable `Long` → `NullPointerException`. Fix: null checks, `getOrDefault`.
- **Ternary unboxing**: `cond ? 0 : map.get(k)` (one primitive operand) unboxes the wrapper branch → NPE even when the result is assigned to an `Integer`. Fix: make both operands wrappers.
- **Mismatched key types**: `Map<Long, V>.get(intId)`, `Set<Long>.contains(1)` or `Long.equals(Integer)` box to a different type → always `null`/`false`. Fix: convert to the key type first (`(long) id`).
- **Overload trap**: `List<Integer>.remove(i)` removes by index, not by value; `Set<Short>.remove(s - 1)` boxes an `Integer` and removes nothing. Fix: `remove(Integer.valueOf(i))`, cast to the element type.
- **Switch on null**: `switch` over a null `String`, enum or wrapper throws NPE (always before JDK 21; later without `case null`). Fix: null check or `case null`.
