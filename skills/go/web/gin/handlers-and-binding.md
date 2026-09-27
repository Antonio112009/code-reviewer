---
name: Gin handlers, context and binding
description: Gin handlers continuing after Abort or an error response, Bind* auto-400 conflicts, binding:"required" rejecting zero values, bodies consumed by the first bind, pooled *gin.Context in goroutines and gin.Context used as context.Context.
priority: 64
tags: [CWE-670, CWE-362]
activation:
  content:
    - '\bc\.(?:Abort\w{0,20}|JSON|String|Status|Bind\w{0,12}|ShouldBind\w{0,12}|MustBindWith|Copy)\('
    - 'binding:"'
    - '\*gin\.Context\b'
sources:
  - https://pkg.go.dev/github.com/gin-gonic/gin#Context.Abort
  - https://gin-gonic.com/en/docs/binding/binding-and-validation/
  - https://gin-gonic.com/en/docs/middleware/goroutines-inside-a-middleware/
  - https://github.com/gin-gonic/gin/blob/master/context.go
---
- **Abort does not return**: `c.Abort()`, `c.AbortWithStatusJSON(401, …)` or `c.JSON(400, …)` without `return` → the rest of the handler or middleware still runs (double writes, side effects for rejected requests). Fix: `return` right after.
- **Must-bind responses**: `c.Bind`/`BindJSON`/`BindQuery` already abort with 400 (text/plain) on error; writing your own error afterwards triggers "Headers were already written" and sends the wrong body. Fix: `ShouldBind*` and handle the error.
- **required vs zero values**: `binding:"required"` rejects `0`, `false` and `""` → valid requests fail, or teams drop validation. Fix: pointer fields (`*bool`, `*int`) or `min`/`oneof` rules.
- **Body consumed**: a second `ShouldBindJSON` (or binding after middleware read the body) gets EOF → empty struct accepted. Fix: `ShouldBindBodyWith(&v, binding.JSON)` or `ShouldBindBodyWithJSON`.
- **Pooled context**: `*gin.Context` is reused after the handler returns — using `c` in goroutines or callbacks reads/writes another request. Fix: `cp := c.Copy()` or copy the needed values first.
- **c as context.Context**: unless `engine.ContextWithFallback = true`, `c.Done()`/`Deadline()` never fire and `Value()` misses request-context values → DB/HTTP calls given `c` ignore client disconnects and deadlines. Fix: pass `c.Request.Context()`.
