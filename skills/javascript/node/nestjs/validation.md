---
name: DTO validation and transformation
description: ValidationPipe and class-validator gaps — no whitelist, DTOs declared as interfaces, generics or type-only imports, nested objects and arrays never validated, params that stay strings, implicit conversion turning 'false' into true and @IsOptional accepting null.
priority: 66
tags: [CWE-20, CWE-915]
activation:
  content:
    - "\\bValidationPipe\\b|\\bParse(?:Int|Float|Bool|Array|UUID|Enum|Date)Pipe\\b"
    - "@(?:Body|Query|Param|Headers)\\s*\\("
    - "@(?:IsOptional|ValidateNested|ValidateIf|Type|Transform|IsString|IsNumber|IsInt|IsBoolean|IsEnum|IsArray)\\s*\\("
    - "\\bimport\\s+type\\s*\\{[^}\\n]{0,200}Dto\\b|\\benableImplicitConversion\\b|\\bforbidUnknownValues\\b"
sources:
  - https://docs.nestjs.com/techniques/validation
  - https://docs.nestjs.com/pipes
  - https://github.com/typestack/class-validator
---
- **No whitelist**: `ValidationPipe` defaults to `whitelist: false` — undecorated properties (`role`, `isAdmin`, `ownerId`) reach `repo.save(dto)`/`Object.assign(entity, dto)`. Fix: global `whitelist: true, forbidNonWhitelisted: true`, explicit mapping.
- **Erased types**: DTOs declared as interfaces or type aliases, generic parameters (`@Body() body: T`), unions, or imported with `import type` (a common lint autofix) emit no metadata → nothing is validated. Fix: concrete classes, value imports.
- **Nested objects and arrays**: nested DTOs need `@ValidateNested()` plus `@Type(() => Child)`; `@Body() items: CreateDto[]` isn't validated per item. Fix: `ParseArrayPipe({ items: CreateDto })` or a wrapper DTO with `@ValidateNested({ each: true })`.
- **Strings stay strings**: without `transform: true` or `ParseIntPipe`, `@Param('id') id: number` is a string (`===` fails, `id + 1` concatenates); with `transform` alone, `'abc'` becomes `NaN`. Fix: `ParseIntPipe` or `@IsInt()`.
- **Implicit conversion**: `transformOptions.enableImplicitConversion` converts by TS type — query `'false'` becomes `true`, `''` becomes `0`. Fix: explicit `@Transform(({ value }) => value === 'true')`.
- **Optional means nullable**: `@IsOptional()` skips all validators for `null` as well as `undefined` → `null` reaches non-nullable columns or bypasses constraints. Fix: `@ValidateIf((o) => o.x !== undefined)`.
