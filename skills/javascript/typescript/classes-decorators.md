---
name: Class fields and decorators
description: useDefineForClassFields turning redeclared fields into shadowing own properties, emitDecoratorMetadata lost through import type or esbuild-based tools, and reflect-metadata load order.
priority: 55
activation:
  content:
    - '^\s*@[A-Z][\w$]*\s*\('
    - '\b(?:experimentalDecorators|emitDecoratorMetadata|useDefineForClassFields)\b'
    - '\bdeclare\s+[a-z][\w$]*\s*[:!?]|^\s*[a-z][\w$]*!\s*:'
    - '\breflect-metadata\b|\bReflect\.(?:getMetadata|defineMetadata)\s*\('
    - '^import\s+type\s+\{[^}\n]{1,200}\b[A-Z][\w$]*(?:Service|Repository|Provider|Client)\b'
sources:
  - https://www.typescriptlang.org/tsconfig/#useDefineForClassFields
  - https://www.typescriptlang.org/docs/handbook/release-notes/typescript-3-7.html#the-usedefineforclassfields-flag-and-the-declare-property-modifier
  - https://www.typescriptlang.org/tsconfig/#emitDecoratorMetadata
  - https://esbuild.github.io/content-types/#typescript-caveats
---
- **Define semantics shadow accessors**: with `target` ≥ ES2022, a field without initializer (`name: string;`, even `name!:`) becomes an own `undefined` property → hides accessors added at runtime (Sequelize `Model.init`, Lit, MobX); TS can't warn. Fix: `declare name: string;`.
- **`import type` breaks DI metadata**: with `emitDecoratorMetadata`, a constructor dependency imported via `import type` (or typed by an interface) is emitted as `Function`/`Object` in `design:paramtypes` → NestJS/TypeORM/Inversify DI fails at runtime. Fix: value imports; `@Inject(TOKEN)` for interfaces.
- **Toolchains without metadata**: esbuild (tsx, esbuild-based test and dev setups) doesn't implement `emitDecoratorMetadata`, and Node type stripping can't parse decorators → DI/validation that works under `tsc` fails in tests or dev. Fix: SWC or tsc transforms for decorator-heavy code.
- **`reflect-metadata` load order**: the polyfill must be imported once before any decorated class is evaluated; entry points, workers, scripts and test setup that skip it fail with `Reflect.getMetadata is not a function` or empty metadata. Fix: import it first in every entry/setup file.
