---
name: Responses, exception filters and serialization
description: NestJS response defects — @Res() manual mode hanging and bypassing interceptors, parameter routes shadowing static ones, catch-all filters leaking or re-mapping errors, HttpExceptions built from raw errors and ClassSerializerInterceptor not applying to plain objects.
priority: 64
tags: [CWE-209, CWE-200]
activation:
  content:
    - "@Res\\s*\\(|@Response\\s*\\("
    - "@Catch\\s*\\(|\\bExceptionFilter\\b|\\bAPP_FILTER\\b|\\buseGlobalFilters\\s*\\("
    - "\\bnew\\s+\\w*Exception\\s*\\(\\s*(?:err|error|e|ex)\\b"
    - "\\bClassSerializerInterceptor\\b|@(?:Exclude|Expose|SerializeOptions)\\s*\\(|\\b(?:plainToInstance|instanceToPlain)\\s*\\("
    - "@(?:Get|Post|Put|Patch|Delete)\\s*\\(\\s*['\"]:\\w+"
  examples:
    - '@Res({ passthrough: true }) res: Response'
    - '@Catch(HttpException)'
    - 'throw new BadRequestException(err)'
    - '@UseInterceptors(ClassSerializerInterceptor)'
    - '@Get(":id")'
sources:
  - https://docs.nestjs.com/controllers
  - https://docs.nestjs.com/exception-filters
  - https://docs.nestjs.com/techniques/serialization
---
- **@Res() manual mode**: injecting `@Res()` without `{ passthrough: true }` makes you send the response — branches that `return data` hang, and interceptors (serializer, cache, logging) plus `@HttpCode()`/`@Header()` stop applying. Fix: return values or `passthrough: true`.
- **Route shadowing**: `@Get(':id')` declared before `@Get('me')`/`@Get('export')` in the same controller captures those paths → `ParseIntPipe` 400s or the wrong handler runs. Fix: static routes first.
- **Catch-all filters**: `@Catch()` filters that send `exception.message`/`stack` for non-`HttpException` errors leak driver and SQL details; forcing every error to 500 turns 401/404 into 500; `switchToHttp()` inside filters breaks WS/RPC. Fix: branch on `instanceof HttpException`.
- **Raw errors as bodies**: `throw new BadRequestException(err)` or `new HttpException(err, 500)` serialises the caught error's enumerable fields (codes, `meta`, request configs) as the response body. Fix: a safe message; keep the original as `cause` for logs.
- **Serializer needs instances**: `ClassSerializerInterceptor` applies `@Exclude()` only to class instances — Prisma results, raw queries, `{ ...user }` spreads and `{ user }` wrappers send password hashes and tokens. Fix: `@SerializeOptions({ type: UserDto })` or explicit response DTOs.
- **Denylist drift**: `@Exclude()` hides only fields someone remembered; new sensitive columns leak by default. Fix: `excludeExtraneousValues: true` with `@Expose()` allowlists (or schema-based serializers).
