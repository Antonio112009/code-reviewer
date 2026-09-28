---
name: Classes, descriptors and inheritance
description: Cooperative super() chains, abstractmethod without ABC, property setter names, classmethod+property (removed 3.13), cached_property caveats (no lock since 3.12, no __slots__), functools.partial as a method (3.14) and __getattr__ masking errors.
priority: 54
activation:
  content:
    - "\\bsuper\\s*\\(|\\b__init_subclass__\\b|\\b__slots__\\b"
    - "@(?:functools\\.)?cached_property\\b|@\\w+\\.setter\\b|@(?:abc\\.)?abstractmethod\\b"
    - "@classmethod[ \\t]*\\r?\\n[ \\t]*@property\\b|\\bdef\\s+__getattr__\\s*\\("
    - "^[ \\t]+\\w+\\s*=\\s*(?:functools\\.)?partial\\s*\\("
  examples:
    - 'super().__init__(**kwargs)'
    - '@cached_property'
    - 'def __getattr__(self, name):'
    - '    handler = functools.partial(send, retries=3)'
sources:
  - https://docs.python.org/3/library/functools.html#functools.cached_property
  - https://docs.python.org/3/whatsnew/3.13.html#builtins
  - https://docs.python.org/3/whatsnew/3.14.html#changes-in-the-python-api
  - https://docs.python.org/3/library/abc.html#abc.abstractmethod
---
- **Cooperative `super()`**: in mixin/multiple-inheritance chains, an `__init__` that skips `super().__init__()` (or calls `Base.__init__(self)` directly) drops or double-runs other initializers → missing attributes. Fix: every `__init__` calls `super().__init__(**kwargs)`.
- **`@abstractmethod` without ABC**: it blocks instantiation only when the metaclass is `ABCMeta` → incomplete subclasses instantiate and fail later. Fix: inherit from `abc.ABC`.
- **Property setter name**: `@x.setter` must decorate a function also named `x`; another name leaves `x` read-only → AttributeError on assignment. Fix: reuse the name.
- **`@classmethod` over `@property`**: deprecated in 3.11, removed in 3.13 → returns a bound method instead of the value. Fix: a metaclass property or a plain classmethod.
- **`cached_property`**: needs an instance `__dict__` (fails with `__slots__`), never refreshes when inputs change, and has no lock since 3.12 (getter may run twice across threads). Fix: `del obj.attr` to invalidate; lock side-effecting getters.
- **`partial` as class attribute (3.14)**: `functools.partial` became a method descriptor → called via an instance it now receives `self` first. Fix: wrap in `staticmethod()`.
- **`__getattr__` masking errors**: an AttributeError inside a property falls through to `__getattr__`, hiding the bug; reading an unset `self.x` inside `__getattr__` recurses forever. Fix: use `self.__dict__` there.
