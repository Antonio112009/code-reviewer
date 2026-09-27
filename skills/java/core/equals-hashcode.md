---
name: equals, hashCode and ordering contracts
description: Broken equality contracts — equals without hashCode, mutable hash keys, overloads instead of overrides, asymmetric equals, compareTo inconsistent with equals in TreeSet/TreeMap, subtraction comparators and array/record component equality.
priority: 55
tags: [CWE-581, CWE-697]
activation:
  content:
    - '\b(?:equals|hashCode|compareTo|compare)\s*\('
    - '\bimplements\s+[\w<>, ]{0,80}\b(?:Comparable|Comparator)\b'
    - '\brecord\s+\w+\s*[(<]'
    - '\bnew\s+Tree(?:Set|Map)\b'
    - '\bComparator\.comparing'
sources:
  - https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Object.html#equals(java.lang.Object)
  - https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Comparable.html
  - https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Record.html#equals(java.lang.Object)
---
- **equals without hashCode**: overriding one, or using different fields in each → `HashMap`/`HashSet` miss equal objects and keep duplicates. Fix: implement both over the same fields.
- **Mutable hash keys**: fields used by `hashCode` change while the object is a `HashSet` element or `HashMap` key → entry unreachable (`contains` false, `remove` no-op, leak). Fix: immutable keys, or remove → mutate → re-add.
- **Overload, not override**: `public boolean equals(Foo other)` without `@Override` → collections call `Object.equals` (identity). Fix: override `equals(Object)`.
- **Asymmetric equals**: `instanceof` checks in non-final classes whose subclasses add fields, or "equal" to other types (e.g., `String`) → symmetry broken, set contents depend on insertion order. Fix: `getClass()` comparison or final classes.
- **compareTo ≠ equals**: a `compareTo`/`Comparator` over a subset of fields makes `TreeSet`/`TreeMap` treat distinct objects as duplicates and silently drop them. Fix: tie-break on a unique field.
- **Subtraction comparators**: `(a, b) -> a.x - b.x` overflows for large or negative values → wrong order or `IllegalArgumentException: Comparison method violates its general contract!`. Fix: `Integer.compare`, `Comparator.comparingInt`.
- **Array equality**: `array.equals(other)`, `Objects.equals` on arrays and record components of array type (record `equals` uses `Objects.equals`) compare identity; records are only shallowly immutable. Fix: `Arrays.equals`, `List.copyOf` in the compact constructor.
