import { readFileSync } from 'node:fs';
import { extname, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const textExtensions = new Set(['', '.cjs', '.css', '.html', '.js', '.json', '.md', '.mjs', '.ts', '.txt', '.yaml', '.yml']);
const allowedExampleEmailDomains = new Set(['example.com', 'example.invalid', 'example.org']);
const rules = [
  { id: 'secret.private-key', test: (text) => /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/.test(text) },
  { id: 'secret.aws-access-key', test: (text) => /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/.test(text) },
  { id: 'secret.github-token', test: (text) => /\bgh[pousr]_[A-Za-z0-9]{30,}\b/.test(text) },
  { id: 'secret.slack-token', test: (text) => /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/.test(text) },
  { id: 'secret.assigned-value', test: (text) => /\b(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)\s*[:=]\s*["']?[A-Za-z0-9_/+.-]{16,}/i.test(text) },
  { id: 'pii.email', test: hasRepresentativeEmail },
  { id: 'pii.phone', test: (text) => /(?:^|[^\d])(?:\+?1[ .-]?)?\(?[2-9]\d{2}\)?[ .-]\d{3}[ .-]\d{4}(?:[^\d]|$)/m.test(text) },
];

function hasRepresentativeEmail(text) {
  const emails = text.matchAll(/\b[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})\b/gi);
  for (const match of emails) {
    if (!allowedExampleEmailDomains.has(match[1].toLowerCase())) return true;
  }
  return false;
}

export function scanText(text, file = '<memory>') {
  return rules.filter((rule) => rule.test(text)).map((rule) => ({ file, rule: rule.id }));
}

function fixtureFailures(path, text) {
  const normalized = path.split(sep).join('/');
  if (!normalized.startsWith('fixtures/') || extname(path) !== '.json') return [];
  const failures = [];
  if (!normalized.includes('.synthetic.')) failures.push({ file: path, rule: 'fixture.synthetic-filename' });
  try {
    const parsed = JSON.parse(text);
    const serialized = JSON.stringify(parsed);
    const markedSynthetic = parsed?.classification === 'synthetic' || /"provider":"synthetic-[^"]+"/.test(serialized);
    if (!markedSynthetic) failures.push({ file: path, rule: 'fixture.synthetic-marker' });
  } catch {
    failures.push({ file: path, rule: 'fixture.valid-json' });
  }
  return failures;
}

function repositoryFiles() {
  const result = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.status !== 0) throw new Error('unable to enumerate repository files with git');
  return result.stdout.split('\0').filter(Boolean).sort();
}

function scanRepository() {
  const failures = [];
  for (const path of repositoryFiles()) {
    if (!textExtensions.has(extname(path))) continue;
    const absolute = resolve(root, path);
    const safeRelative = relative(root, absolute);
    if (safeRelative.startsWith(`..${sep}`) || safeRelative === '..') throw new Error('repository path escaped root');
    const buffer = readFileSync(absolute);
    if (buffer.includes(0)) continue;
    const text = buffer.toString('utf8');
    failures.push(...scanText(text, path), ...fixtureFailures(path, text));
  }
  return failures;
}

function selfTest() {
  const negativeCases = [
    ['secret.private-key', `-----BEGIN ${'PRIVATE'} KEY-----`],
    ['secret.aws-access-key', `AKIA${'A'.repeat(16)}`],
    ['secret.github-token', `ghp_${'a'.repeat(36)}`],
    ['secret.slack-token', `xoxb-${'a'.repeat(24)}`],
    ['secret.assigned-value', `password=${'a'.repeat(20)}`],
    ['pii.email', `person@${'real-company.test'}`],
    ['pii.phone', ['212', '555', '0199'].join('-')],
  ];
  for (const [expected, candidate] of negativeCases) {
    const found = scanText(candidate);
    if (!found.some(({ rule }) => rule === expected)) throw new Error(`negative probe did not trigger rule ${expected}`);
  }
  const safe = scanText('synthetic@example.invalid and no credentials');
  if (safe.length) throw new Error(`safe probe unexpectedly triggered rule ${safe[0].rule}`);
  console.log(`repository safety scanner self-test: PASS (${negativeCases.length} negative probes)`);
}

if (process.argv.includes('--self-test')) {
  selfTest();
} else {
  const failures = scanRepository();
  if (failures.length) {
    console.error('repository safety scan failed (candidate values intentionally redacted):');
    for (const { file, rule } of failures) console.error(`- file=${file} rule=${rule}`);
    process.exitCode = 1;
  } else {
    console.log('repository safety scan: PASS');
  }
}
