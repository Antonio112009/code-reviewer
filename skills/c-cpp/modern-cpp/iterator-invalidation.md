---
name: Iterator and reference invalidation
description: Iterators, references, pointers and views into std containers used after insert/erase/rehash/reallocation — erase inside loops, growth while iterating, stored element addresses, rehash and short-string moves.
priority: 65
tags: [CWE-416, CWE-825]
activation:
  content:
    - '\.(?:push_back|emplace_back|emplace|insert|insert_or_assign|try_emplace|erase|resize|reserve|shrink_to_fit|clear|rehash|push_front|emplace_front|append|assign)\s*\('
    - '\bstd::(?:erase|erase_if)\s*\('
sources:
  - https://en.cppreference.com/w/cpp/container
  - https://cmu-sei.github.io/secure-coding-standards/sei-cert-cpp-coding-standard/rules/containers-ctr/ctr51-cpp/
  - https://cmu-sei.github.io/secure-coding-standards/sei-cert-cpp-coding-standard/rules/characters-and-strings-str/str52-cpp/
---
- **Erase in a loop**: `for (auto it = c.begin(); it != c.end(); ++it) if (p(*it)) c.erase(it);` → increments an invalidated iterator. Fix: `it = c.erase(it)` without `++`, or C++20 `std::erase_if`.
- **Growing while iterating**: `push_back`/`emplace_back`/`insert` into a `vector`, `string` or `deque` inside a range-for or while holding iterators/references to its elements → reallocation leaves them dangling. Fix: index loops, `reserve` first, or collect and append after.
- **Stored element addresses**: pointers, references, `string_view`s or `span`s into `vector`/`string` elements kept elsewhere while the container grows, shrinks or is reassigned → dangling. Fix: store indices/keys, or use node-based containers.
- **Unordered rehash**: inserting into `unordered_map`/`unordered_set` may rehash and invalidate every iterator (references stay valid). Fix: no iterators across inserts; `reserve` up front.
- **Short strings move**: reallocating a container of `std::string` invalidates `c_str()`/views of short strings (stored inline) while long ones happen to survive → bugs only for short values. Fix: never point into elements of a container that can move.
- **deque ends**: `push_front`/`push_back` on a `deque` invalidate all iterators but keep references; erasing in the middle invalidates everything. Fix: re-acquire iterators after changes.
