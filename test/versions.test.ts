import { describe, expect, it } from 'vitest';
import { compileRange, minVersionOfSpec, parseVersion, satisfies } from '../src/util/versions';

describe('satisfies', () => {
  it.each([
    ['15.1.0', '>=13', true],
    ['12.3.0', '>=13', false],
    ['1.21.5', '<1.22', true],
    ['1.22.0', '<1.22', false],
    ['18.3.1', '>=18 <19', true],
    ['19.0.0', '>=18 <19', false],
    ['3.2.1', '^3', true],
    ['4.0.0', '^3', false],
    ['0.2.9', '^0.2.3', true],
    ['0.3.0', '^0.2.3', false],
    ['3.2.9', '~3.2', true],
    ['3.3.0', '~3.2', false],
    ['3.12.4', '3.12', true],
    ['3.13.0', '3.12', false],
    ['3.5.0', '3.x', true],
    ['2.9.0', '<=2.x', true],
    ['3.0.0', '<=2.x', false],
    ['8', '>=8', true],
    ['7.9', '<7 || >=7.5', true],
    ['7.4', '<7 || >=7.5', false],
    ['v1.22.3', '>= 1.22', true],
  ])('%s satisfies %s → %s', (v, r, expected) => {
    expect(satisfies(v, r)).toBe(expected);
  });

  it('rejects malformed ranges and unparseable versions', () => {
    expect(() => compileRange('>=abc')).toThrow(/invalid version range/);
    expect(() => compileRange('')).toThrow();
    expect(satisfies('latest', '>=1')).toBe(false);
    expect(parseVersion('v2.10.3-rc.1')).toEqual([2, 10, 3]);
  });
});

describe('minVersionOfSpec', () => {
  it.each([
    ['^15.1.0', '15.1.0'],
    ['~5.0', '5.0'],
    ['>=18 <20', '18'],
    ['15.x', '15'],
    ['>=3.10,<4', '3.10'],
    ['==5.0.*', '5.0'],
    ['~=3.11', '3.11'],
    ['!=3.9,>=3.8', '3.8'],
    ['~> 7.1', '7.1'],
    ['[3.1,4)', '3.1'],
    ['v1.22.3', '1.22.3'],
    ['^11.0|^12.0', '11.0'],
    ['^18 || ^19', '18'],
    ['workspace:^1.2', '1.2'],
    ['npm:react@^18.2.0', '18.2.0'],
    ['3.2.0', '3.2.0'],
  ])('%s → %s', (spec, expected) => {
    expect(minVersionOfSpec(spec)).toBe(expected);
  });

  it.each(['latest', '<4', 'github:user/repo', 'file:../lib', 'https://x/y.tgz', '*', '', undefined])(
    '%s → undefined',
    (spec) => {
      expect(minVersionOfSpec(spec as string | undefined)).toBeUndefined();
    },
  );
});
