// Test-only module hook (`node --import`): lets plain node run the TypeScript sources, whose relative
// imports omit the `.ts` extension (the bundler resolves them for the published build).
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) {
      try {
        return nextResolve(`${specifier}.ts`, context);
      } catch {
        // not a TypeScript module: resolve as written
      }
    }
    return nextResolve(specifier, context);
  },
});
