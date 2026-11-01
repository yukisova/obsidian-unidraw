import assert from "node:assert/strict";

type TestFn = () => void | Promise<void>;

interface TestCase {
  name: string;
  fn: TestFn;
}

const tests: TestCase[] = [];

export function test(name: string, fn: TestFn): void {
  tests.push({ name, fn });
}

export function eq<T>(actual: T, expected: T, message?: string): void {
  assert.deepEqual(actual, expected, message);
}

export function ok(value: unknown, message?: string): void {
  assert.ok(value, message);
}

export function text(doc: { toLines(trim?: boolean): string[] }): string[] {
  return doc.toLines(true);
}

export async function runAll(): Promise<void> {
  let failed = 0;
  let passed = 0;
  for (const testCase of tests) {
    try {
      await testCase.fn();
      passed++;
      process.stdout.write(`  \u001b[32m✓\u001b[0m ${testCase.name}\n`);
    } catch (error) {
      failed++;
      process.stdout.write(`  \u001b[31m✗\u001b[0m ${testCase.name}\n`);
      if (error instanceof Error) {
        process.stdout.write(`    ${error.stack?.split("\n").slice(0, 6).join("\n    ")}\n`);
      } else {
        process.stdout.write(`    ${String(error)}\n`);
      }
    }
  }
  process.stdout.write(
    `\n${failed === 0 ? "\u001b[32m" : "\u001b[31m"}${passed} passed, ${failed} failed\u001b[0m\n`,
  );
  if (failed > 0) process.exitCode = 1;
}
