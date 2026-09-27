import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    cli: 'src/cli.ts',
    index: 'src/index.ts',
  },
  format: 'esm',
  platform: 'node',
  target: 'node24',
  dts: true,
  clean: true,
  sourcemap: true,
  // package.json has "type": "module", so plain .js is ESM
  fixedExtension: false,
});
