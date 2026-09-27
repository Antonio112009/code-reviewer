---
name: Validation rules and validated data
description: Laravel validation holes — reading input instead of validated data, array rules without keys, max/min measuring string length, unscoped exists/unique rules, ignore() with request input, permissive url/email rules and Validator::make without a check.
priority: 70
tags: [CWE-20, CWE-639, CWE-89]
activation:
  content:
    - '->validate\s*\(|\bValidator::make\s*\(|\bextends\s+FormRequest\b|\bfunction\s+rules\s*\('
    - '\bRule::(?:unique|exists|in|when|enum)\s*\(|->validated\s*\(|->safe\s*\('
    - '[''"|](?:array|max:\d|min:\d|size:\d|url|email|exists:|unique:)'
sources:
  - https://laravel.com/docs/13.x/validation
  - https://laravel.com/docs/13.x/validation#rule-unique
  - https://laravel.com/docs/13.x/validation#validating-arrays
---
- **Input after validation**: `$request->validate([...])` followed by `$request->all()`/`input()` → fields that were never validated are used. Fix: use the returned array, `validated()` or `safe()->only()`.
- **Arrays without keys**: `'meta' => 'array'` without `array:key1,key2` or `meta.*` rules → `validated()` returns the whole nested payload unchecked. Fix: list allowed keys and rule every nested field.
- **Size rules**: `max`, `min`, `size`, `between` measure string length unless the field also has `numeric` or `integer` → `'age' => 'max:120'` accepts `'999'`. Fix: add the type rule.
- **Unscoped exists/unique**: `exists:projects,id` accepts another tenant's project; `unique:` also counts soft-deleted rows → IDOR through validation, false conflicts. Fix: `Rule::exists(...)->where('team_id', …)`, `withoutTrashed()`.
- **ignore() with input**: `Rule::unique('users')->ignore($request->input('id'))` → uniqueness bypass and SQL injection (documented). Fix: ignore the bound model or its id from the database.
- **Permissive formats**: `url` accepts `file://`, `gopher://`, `redis://`, `dict://` and dozens more schemes unless you pass `url:http,https`; `email` defaults to RFC checks only → SSRF via "validated" webhook URLs, unusable addresses. Fix: restrict protocols, `email:rfc,dns`.
- **Unchecked validator**: `Validator::make($data, $rules)` without `->validate()`, `->fails()` or `->validated()` validates nothing → raw data persisted.
