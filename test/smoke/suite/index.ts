// Extension-host test entry (`--extensionTestsPath`): VS Code calls `run()` and exits with a
// failure code if it rejects. A tiny sequential runner; no test framework needed for two tests.
import { tests } from "./dashboard.test.js";

export async function run(): Promise<void> {
  const failures: string[] = [];
  for (const t of tests) {
    const started = Date.now();
    try {
      await t.run();
      console.log(`  ok   ${t.name} (${Date.now() - started} ms)`);
    } catch (e) {
      failures.push(t.name);
      console.error(`  FAIL ${t.name}\n${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
    }
  }
  console.log(`smoke: ${tests.length - failures.length}/${tests.length} passed`);
  if (failures.length > 0) throw new Error(`Smoke tests failed: ${failures.join("; ")}`);
}
