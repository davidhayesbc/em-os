// Regression probe for the synthetic discovery validator.
// Exits 0 only when the validator rejects mutated fixtures carrying an extra
// unallowlisted or write-capable tool. Uses only in-memory synthetic values;
// no endpoints, credentials, work content, or real data.
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const baseFixture = JSON.parse(
  readFileSync(new URL('../../fixtures/security/mcp-discovery-probe.synthetic.json', import.meta.url), 'utf8'),
);
const validatorSource = readFileSync(
  new URL('../../scripts/validate-security-discovery.mjs', import.meta.url),
  'utf8',
);

const cases = [
  {
    name: 'extra-unallowlisted-read-tool',
    mutate: (fixture) => {
      fixture.syntheticToolListResponse.tools.push({
        name: 'issues.list',
        description: 'Extra unapproved read tool.',
        inputSchema: { type: 'object', additionalProperties: false, properties: {} },
      });
    },
    mustFail: true,
  },
  {
    name: 'extra-write-capable-tool',
    mutate: (fixture) => {
      fixture.syntheticToolListResponse.tools.push({
        name: 'pull_requests.merge',
        description: 'Write-capable tool that must be rejected.',
        inputSchema: { type: 'object', additionalProperties: false, properties: {} },
      });
    },
    mustFail: true,
  },
  {
    name: 'zero-tools',
    mutate: (fixture) => {
      fixture.syntheticToolListResponse.tools = [];
    },
    mustFail: true,
  },
  {
    name: 'single-allowlisted-tool-still-passes',
    mutate: () => {},
    mustFail: false,
  },
];

const tmp = mkdtempSync(join(tmpdir(), 'em-os-discovery-probe-'));
let exitCode = 0;

for (const { name, mutate, mustFail } of cases) {
  const mutant = structuredClone(baseFixture);
  mutate(mutant);
  const fixturePath = join(tmp, `mutant-${name}.json`);
  writeFileSync(fixturePath, JSON.stringify(mutant, null, 2), 'utf8');

  // Inject the mutant fixture path into a copy of the validator.
  const patchedValidator = validatorSource.replace(
    "const fixturePath = new URL('../fixtures/security/mcp-discovery-probe.synthetic.json', import.meta.url);",
    `const fixturePath = new URL('file://${fixturePath}');`,
  );
  const mutantValidatorPath = join(tmp, `validate-${name}.mjs`);
  writeFileSync(mutantValidatorPath, patchedValidator, 'utf8');

  const run = spawnSync(process.execPath, ['--check', mutantValidatorPath], { cwd: repoRoot, encoding: 'utf8' });
  if (run.status !== 0) {
    console.error(`[${name}] validator syntax check failed:\n${run.stderr}`);
    exitCode = 1;
    continue;
  }

  const result = spawnSync(process.execPath, [mutantValidatorPath], { cwd: repoRoot, encoding: 'utf8' });
  const failed = result.status !== 0;
  const expected = mustFail ? 'FAIL' : 'PASS';
  const actual = failed ? 'FAIL' : 'PASS';

  if (failed !== mustFail) {
    console.error(`[${name}] expected ${expected}, got ${actual}`);
    if (result.stderr) console.error(result.stderr.trim());
    if (result.stdout) console.error(result.stdout.trim());
    exitCode = 1;
  } else {
    console.log(`[${name}] ${actual} (expected ${expected})`);
  }
}

rmSync(tmp, { recursive: true, force: true });
process.exit(exitCode);
