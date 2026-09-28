---
name: Enums, readonly and modern OOP
description: PHP 8.0–8.4 object-model traps — Enum::from ValueError, enums as keys/JSON, readonly arrays and shared clones, uninitialized typed properties, static variables shared with subclasses (8.1), named-argument renames, property hooks (8.4).
priority: 56
tags: [CWE-665, CWE-1188]
activation:
  versions: { lang.php: ">=8.0" }
  content:
    - '\benum\s+\w+|::(?:from|tryFrom|cases)\s*\('
    - '\breadonly\b|\bclone\b|\b__(?:get|set|clone|unserialize|wakeup)\s*\('
    - '\bstatic\s+\$\w+\s*=|\b(?:private|protected)\(set\)'
  examples:
    - 'enum Status: string {'
    - '$status = Status::tryFrom($input);'
    - 'public readonly array $items = [];'
    - 'private static $cache = [];'
sources:
  - https://www.php.net/manual/en/language.enumerations.backed.php
  - https://www.php.net/manual/en/language.oop5.properties.php
  - https://www.php.net/manual/en/migration81.incompatible.php
  - https://www.php.net/manual/en/language.oop5.property-hooks.php
---
- **Enum::from**: throws `ValueError` for unknown input → 500 instead of 422. Fix: `tryFrom()` plus validation. Persist `->value`, not `->name`, or renaming a case orphans stored data.
- **Enums as keys and JSON**: cases cannot be array keys (`TypeError`), `json_encode` of a pure enum throws, and `$status == 'paid'` is always false → use `->value` or compare cases.
- **Exhaustive match**: `match ($enum)` without `default` throws `UnhandledMatchError` once a new case is added.
- **readonly**: `$this->items[] = $x` on a readonly array throws `Error`; nested objects stay mutable and clones share them (re-init in `__clone` only since 8.3) → "immutable" values change.
- **Uninitialized typed properties**: typed properties without a default are uninitialized, not null; reading one throws `Error` → constructor branches, `unserialize` and hydrators that skip them crash. Fix: default or `?T $x = null`.
- **Static variables (8.1)**: a `static $cache` inside an inherited method is now shared by the parent and all subclasses → per-class caches collide.
- **Named arguments**: since 8.0 callers may pass `name: $v` → renaming a public parameter or overriding it with another name breaks callers (`Unknown named parameter`).
- **Property hooks (8.4)**: `$obj->items[] = $x` on a hooked array property throws `Error`; `unserialize()` and `(array)` casts bypass `set` hooks → validation in hooks is skipped for restored objects.
