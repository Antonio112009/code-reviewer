import { describe, expect, it } from 'vitest';
import { addedRanges, parseUnifiedDiff, unquote } from '../src/git/diff-parser';

const DIFF = `diff --git a/src/a.ts b/src/a.ts
index 1111111..2222222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,4 +1,5 @@ export function a() {
 const x = 1;
-const y = 2;
+const y = 3;
+const z = 4;

 export { x };
diff --git a/new.txt b/new.txt
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/new.txt
@@ -0,0 +1,2 @@
+hello
+world
\\ No newline at end of file
diff --git a/gone.ts b/gone.ts
deleted file mode 100644
index 4444444..0000000
--- a/gone.ts
+++ /dev/null
@@ -1 +0,0 @@
-bye
diff --git a/old name.ts b/new name.ts
similarity index 100%
rename from old name.ts
rename to new name.ts
diff --git a/img.png b/img.png
index 5555555..6666666 100644
Binary files a/img.png and b/img.png differ
`;

describe('parseUnifiedDiff', () => {
  const files = parseUnifiedDiff(DIFF);

  it('parses every file with the right status', () => {
    expect(files.map((f) => [f.path, f.status, f.binary])).toEqual([
      ['src/a.ts', 'modified', false],
      ['new.txt', 'added', false],
      ['gone.ts', 'deleted', false],
      ['new name.ts', 'renamed', false],
      ['img.png', 'modified', true],
    ]);
    expect(files[3]!.oldPath).toBe('old name.ts');
  });

  it('tracks old/new line numbers, including blank context lines', () => {
    const hunk = files[0]!.hunks[0]!;
    expect(hunk.header).toContain('export function a()');
    expect(hunk.lines.map((l) => `${l.type}:${l.oldLine ?? '-'}:${l.newLine ?? '-'}`)).toEqual([
      'ctx:1:1',
      'del:2:-',
      'add:-:2',
      'add:-:3',
      'ctx:3:4',
      'ctx:4:5',
    ]);
  });

  it('ignores "no newline" markers', () => {
    expect(files[1]!.hunks[0]!.lines.map((l) => l.text)).toEqual(['hello', 'world']);
  });

  it('computes merged added ranges', () => {
    expect(addedRanges(files[0]!.hunks)).toEqual([[2, 3]]);
  });
});

describe('unquote', () => {
  it('decodes C-style quoted paths with octal UTF-8 bytes', () => {
    expect(unquote('"caf\\303\\251 \\"x\\".ts"')).toBe('café "x".ts');
    expect(unquote('plain.ts')).toBe('plain.ts');
  });
});
