---
name: Shared mutable defaults and aliases
description: Objects created once and shared by every call or instance — mutable or call-time default arguments, class-level containers, list repetition, dict.fromkeys, shallow copies and in-place += on aliases.
priority: 62
activation:
  content:
    - "\\bdef\\s+\\w+\\s*\\([^)]*=\\s*(?:\\[|\\{|(?:set|list|dict|deque|defaultdict|OrderedDict|Counter)\\s*\\(|(?:[\\w.]*\\.)?(?:now|utcnow|today|time|uuid\\d)\\s*\\(|[A-Z]\\w*\\s*\\()"
    - "^[ \\t]+\\w+\\s*:\\s*[^=\\n]{1,60}=\\s*(?:\\[\\s*\\]|\\{\\s*\\}|set\\(\\s*\\))\\s*(?:#[^\\n]*)?$"
    - "\\[\\s*\\[[^\\[\\]\\n]{0,60}\\](?:\\s*\\*\\s*\\w+)?\\s*\\]\\s*\\*"
    - "\\bfromkeys\\s*\\([^)\\n]{1,80},\\s*(?:\\[|\\{|(?:set|list|dict)\\s*\\()"
    - "\\bcopy\\.copy\\s*\\("
sources:
  - https://docs.python.org/3/faq/programming.html#why-are-default-values-shared-between-objects
  - https://docs.python.org/3/faq/programming.html#how-do-i-create-a-multidimensional-list
  - https://docs.python.org/3/library/stdtypes.html#dict.fromkeys
  - https://docs.python.org/3/faq/programming.html#why-does-a-tuple-i-item-raise-an-exception-when-the-addition-works
---
- **Mutable default argument**: `def f(items=[])`, `={}`, `=set()` or `=Config()` is built once when the `def` runs and shared by every call → state leaks between calls and requests. Fix: `None` default, create inside.
- **Call-time defaults**: `def f(ts=datetime.now())`, `=uuid4()` or `=load_config()` are evaluated once at import → the same timestamp, id or stale config on every call. Fix: `None` sentinel, compute in the body.
- **Class-level containers**: `cache = {}` or `items: list = []` in a (non-dataclass) class body is one object shared by all instances. Fix: create it in `__init__`.
- **Repetition and `fromkeys`**: `[[0] * n] * m`, `[[]] * n` and `dict.fromkeys(keys, [])` reuse one inner object → writing one row or key changes all. Fix: comprehensions.
- **Shallow copies**: `copy.copy`, `list(x)`, `x[:]`, `{**x}` copy one level → nested lists/dicts of templates and default configs are still shared and get mutated. Fix: `copy.deepcopy`.
- **`+=` on aliases**: `a += [x]` mutates the list that other names (defaults, class attributes, the caller) reference, unlike `a = a + [x]`; `t[0] += [x]` on a tuple mutates, then raises TypeError. Fix: rebind or copy first.
