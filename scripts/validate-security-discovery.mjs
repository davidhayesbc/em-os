import { readFileSync } from 'node:fs';

const fixturePath = new URL('../fixtures/security/mcp-discovery-probe.synthetic.json', import.meta.url);
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
const failures = [];
const expect = (condition, message) => {
  if (!condition) failures.push(message);
};

expect(fixture.classification === 'synthetic', 'fixture must be classified synthetic');
expect(fixture.probe.transport === 'UNVERIFIED', 'fixture must not claim a verified MCP transport');
expect(fixture.probe.authentication === 'UNVERIFIED', 'fixture must not claim verified authentication');
expect(
  fixture.probe.requestedCapabilities.length === 1
    && fixture.probe.requestedCapabilities[0] === 'tools/list',
  'unapproved synthetic discovery must request only tools/list',
);
expect(
  !fixture.probe.requestedCapabilities.includes('resources/list'),
  'resources/list must remain absent until an explicit approval condition is modeled',
);
expect(fixture.probe.prohibitedOperations.includes('update'), 'write operations must be prohibited');
expect(fixture.probe.prohibitedOperations.includes('delete'), 'delete operations must be prohibited');
expect(fixture.probe.prohibitedOperations.includes('merge'), 'merge operations must be prohibited');
expect(fixture.probe.requestLogPolicy.includes('Never log'), 'probe must prohibit raw sensitive logging');

const advertisedTools = fixture.syntheticToolListResponse.tools;
expect(Array.isArray(advertisedTools), 'syntheticToolListResponse.tools must be an array');
expect(advertisedTools.length === 1, 'fixture must advertise exactly one synthetic tool (fail-closed)');
for (const tool of advertisedTools) {
  expect(typeof tool.name === 'string', 'every advertised tool must have a string name');
  expect(fixture.expectedAdapterBehavior.allowlist.includes(tool.name), `advertised tool "${tool.name}" must be in expectedAdapterBehavior.allowlist`);
}
const tool = advertisedTools[0];
expect(tool.name === 'pull_requests.list', 'fixture must use the approved synthetic read tool');
expect(tool.inputSchema.additionalProperties === false, 'tool input must reject unknown properties');
expect(tool.inputSchema.properties.limit.maximum <= 50, 'page size must remain bounded at 50 or fewer');
expect(fixture.expectedAdapterBehavior.allowlist.length === 1, 'fixture must keep a single-tool allowlist');
expect(fixture.expectedAdapterBehavior.fieldMinimization.includes('id'), 'adapter must retain stable source ID');
expect(!fixture.expectedAdapterBehavior.fieldMinimization.includes('body'), 'adapter must not retain raw PR body');
expect(fixture.expectedAdapterBehavior.cursorRule.includes('same committed transaction'), 'cursor advancement must be transactional');
expect(fixture.expectedAdapterBehavior.retryRule.includes('Never retry authorization'), 'authorization failures must fail closed');
expect(fixture.expectedAdapterBehavior.schemaRule.includes('Reject'), 'schema drift must fail closed');

if (failures.length) {
  console.error(`security discovery fixture validation failed:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('security discovery fixture policy: PASS');
