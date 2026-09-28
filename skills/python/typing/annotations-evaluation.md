---
name: Annotation evaluation at runtime
description: When annotations are evaluated — TYPE_CHECKING-only imports used at runtime, postponed annotations (PEP 563) breaking frameworks that resolve them, deferred evaluation in 3.14 (PEP 649/749) and reading __annotations__ directly.
priority: 52
activation:
  content:
    - "\\bTYPE_CHECKING\\b"
    - "\\bfrom\\s+__future__\\s+import\\s+annotations\\b"
    - "\\b(?:get_type_hints|get_annotations)\\s*\\(|\\b__annotations__\\b|\\bannotationlib\\b|\\bForwardRef\\b"
  examples:
    - 'if TYPE_CHECKING:'
    - 'from __future__ import annotations'
    - 'hints = typing.get_type_hints(User)'
sources:
  - https://docs.python.org/3/library/typing.html#typing.TYPE_CHECKING
  - https://docs.python.org/3/whatsnew/3.14.html#changes-in-annotations-pep-649-and-pep-749
  - https://docs.python.org/3/howto/annotations.html
  - https://peps.python.org/pep-0563/
---
- **`TYPE_CHECKING`-only names at runtime**: names imported under `if TYPE_CHECKING:` don't exist at runtime → `isinstance`, defaults, decorators and frameworks that resolve annotations (pydantic, FastAPI, `singledispatch`, serializers) raise NameError. Fix: runtime imports for names that get evaluated.
- **Postponed annotations (PEP 563)**: with `from __future__ import annotations` annotations are strings resolved in module globals → classes defined inside functions or imported conditionally can't be resolved (NameError, pydantic "not fully defined"). Fix: module-level definitions.
- **Deferred evaluation in 3.14 (PEP 649/749)**: annotations are evaluated lazily, so reading `obj.__annotations__` can raise NameError for undefined forward references, and class annotations are no longer reachable via instances (`self.__annotations__`). Fix: `annotationlib.get_annotations(obj, format=Format.FORWARDREF)`.
- **Reading `__annotations__` directly**: it holds only the class's own fields (no inherited ones), returns the base class's dict for unannotated classes on 3.9 and older, and triggers evaluation on 3.14. Fix: `typing.get_type_hints(cls, include_extras=True)`.
- **`get_type_hints()` failures**: it evaluates strings in the module's globals, so local classes, `TYPE_CHECKING` imports and typos raise at call time — often deep in serializers or DI containers, not at import. Fix: pass `localns`; test resolution in CI.
