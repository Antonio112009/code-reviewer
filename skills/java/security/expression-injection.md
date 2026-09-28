---
name: Expression, script and JNDI injection
description: Code execution through user-controlled SpEL, Jakarta EL, OGNL/MVEL/JEXL, Groovy or ScriptEngine expressions, Bean Validation message templates, template engines, JNDI lookups and reflective class loading.
priority: 78
tags: [CWE-917, CWE-94, CWE-470, A05:2025]
activation:
  content:
    - '\b(?:SpelExpressionParser|StandardEvaluationContext|ExpressionFactory|ELProcessor|GroovyShell|ScriptEngineManager|ScriptEngine|InitialContext|DirContext|OgnlUtil|Ognl|JexlEngine|JexlBuilder|MVEL)\b'
    - '\.parseExpression\('
    - '\bbuildConstraintViolationWithTemplate\('
    - '\.lookup\('
    - '\bClass\.forName\('
    - '\bnew\s+Template\('
  examples:
    - 'SpelExpressionParser parser = new SpelExpressionParser();'
    - 'Expression expr = parser.parseExpression(userInput);'
    - 'context.buildConstraintViolationWithTemplate(userMessage).addConstraintViolation();'
    - 'Object obj = ctx.lookup(userSuppliedName);'
    - 'Class<?> clazz = Class.forName(className);'
    - 'Template tmpl = new Template("name", reader, config);'
sources:
  - https://docs.spring.io/spring-framework/reference/core/expressions/evaluation.html
  - https://docs.hibernate.org/validator/9.0/reference/en-US/html_single/
  - https://owasp.org/www-community/vulnerabilities/Expression_Language_Injection
---
- **SpEL from input**: `parser.parseExpression(userInput).getValue()` (default `StandardEvaluationContext`) → `T(java.lang.Runtime).getRuntime().exec(...)`. Fix: never parse user-controlled expressions; `SimpleEvaluationContext.forReadOnlyDataBinding()` for data binding.
- **Other engines**: Jakarta EL (`ELProcessor.eval`, `createValueExpression`), OGNL, MVEL, JEXL, `GroovyShell.evaluate` or `ScriptEngine.eval` on user-influenced strings → RCE. Fix: fixed expressions with parameters; sandboxes aren't a defense.
- **Validation messages**: `buildConstraintViolationWithTemplate("…" + value)` is interpolated with Expression Language (older Hibernate Validator versions, or when EL is enabled for custom violations) → RCE through invalid input. Fix: `addMessageParameter`/`addExpressionVariable`.
- **JNDI lookups**: `InitialContext.lookup(name)`/`DirContext.lookup` with user-influenced names (`ldap://`, `rmi://`) → remote class loading or deserialization (Log4Shell class). Fix: constant names only.
- **Template injection**: templates built from input (FreeMarker `new Template(name, userString)`, Velocity `evaluate`) or Thymeleaf view names built from input (`__${…}__` preprocessing) → server-side template injection. Fix: fixed templates, allow-listed view names.
- **Reflective loading**: `Class.forName(param)`, `getMethod(param).invoke(...)` or instantiating user-named classes → arbitrary class initialization and method calls. Fix: map allowed names to classes explicitly.
