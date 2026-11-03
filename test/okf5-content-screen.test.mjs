import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as screen from '../oats-package/capabilities/oats-okf-harvest/skills/okf-authoring/scripts/okf-content-screen.mjs';

// Synthetic-only fixtures. No service is contacted, no credential is loaded,
// and no fixture is written to disk. Nonreserved .tld strings are invented so
// the tests exercise refusal rather than the package's example-domain policy.
const { screenText, screenBytes, RULE_IDS } = screen;
const MODULE = new URL('../oats-package/capabilities/oats-okf-harvest/skills/okf-authoring/scripts/okf-content-screen.mjs', import.meta.url);
const LOCATION = 'outgoing-text-1';
const MAX = 4 * 1024 * 1024;
const BODY = 'Ab3dEf7hIj9kLm2nOp4qRs6tUv8wXy0z';
const PYPI = `pypi-${BODY.repeat(4)}`;
const GITHUB = `ghp_${BODY.repeat(2).slice(0, 36)}`;
const EMAIL = 'synthetic-person@synthetic-contact.tld';
const PHONE = '+1 202-555-0104';
const rules = (text, options) => screenText(text, LOCATION, options).map(finding => finding.rule);
const hasRule = (text, rule, options) => assert.ok(rules(text, options).includes(rule), `missing rule: ${rule}`);
const clean = (text, options) => assert.deepEqual(screenText(text, LOCATION, options), []);
const inputError = operation => assert.throws(operation, error => {
  assert.ok(error instanceof Error);
  assert.equal(error.code, 'E_CONTENT_INPUT');
  assert.equal(error.message, 'Content screen input is invalid or exceeds the supported limit.');
  assert.deepEqual(Object.keys(error), ['code']);
  return true;
});

test('library exports a fixed, immutable rule vocabulary and only its two entry points', () => {
  assert.deepEqual(Object.keys(screen).sort(), ['RULE_IDS', 'screenBytes', 'screenText']);
  assert.ok(Object.isFrozen(RULE_IDS));
  assert.equal(new Set(RULE_IDS).size, RULE_IDS.length);
  assert.deepEqual(RULE_IDS, [
    'secret-pypi', 'secret-github', 'secret-service-token', 'secret-private-key',
    'secret-credential-url', 'secret-assignment', 'contact-email', 'contact-phone',
  ]);
  const child = spawnSync(process.execPath, [fileURLToPath(MODULE), '--help'], { encoding: 'utf8' });
  assert.equal(child.status, 0);
  assert.equal(child.stdout, '');
  assert.equal(child.stderr, '');
});

test('recognizes PyPI and all common GitHub prefixes, without generic identifier scans', () => {
  hasRule(PYPI, 'secret-pypi');
  for (const prefix of ['ghp_', 'gho_', 'ghu_', 'ghs_', 'ghr_']) {
    hasRule(`${prefix}${BODY.repeat(2).slice(0, 36)}`, 'secret-github');
  }
  hasRule(`github_pat_${BODY.repeat(3)}`, 'secret-github');
  for (const text of ['pypi-package', 'ghp_short', 'github_pat_short', 'pypi-',
    'prefixghp_' + BODY.repeat(2), 'pypi_docs_identifier', 'sk-short', BODY.repeat(8)]) clean(text);
});

test('recognizes explicit synthetic service credential shapes', () => {
  const fixtures = [
    `AKIA${'A1'.repeat(8)}`, `ASIA${'B2'.repeat(8)}`,
    `AIza${BODY.repeat(2).slice(0, 35)}`,
    ...['xoxb-', 'xoxa-', 'xoxp-', 'xoxr-', 'xoxs-', 'xapp-'].map(prefix => `${prefix}${BODY}`),
    `sk_live_${BODY}`, `sk_test_${BODY}`, `rk_live_${BODY}`,
    `sk-${BODY.repeat(2)}`, `sk-proj-${BODY.repeat(3)}`,
    `sk-svcacct-${BODY.repeat(2)}`, `sk-ant-${BODY.repeat(3)}`,
    `npm_${BODY.repeat(2).slice(0, 36)}`, `glpat-${BODY}`, `hf_${BODY}`,
    `dop_v1_${'a1b2c3d4'.repeat(8)}`, `SG.${BODY}.${BODY}`,
    `eyJ${BODY}.${BODY}.${BODY}`,
  ];
  for (const fixture of fixtures) hasRule(fixture, 'secret-service-token');
  for (const fixture of ['AKIAshort', 'AIza-short', 'npm_package_identifier',
    'hf_docs', 'SG.example', 'eyJshort.onlytwo', 'arbitrary_'.repeat(20)]) clean(fixture);
});

test('private-key headers refuse, public keys and prose do not', () => {
  for (const prefix of ['', 'RSA ', 'EC ', 'DSA ', 'OPENSSH ', 'ENCRYPTED ']) {
    hasRule(`-----BEGIN ${prefix}PRIVATE KEY-----`, 'secret-private-key');
  }
  hasRule('-----BEGIN PGP PRIVATE KEY BLOCK-----', 'secret-private-key');
  hasRule('PuTTY-User-Key-File-3: ssh-ed25519', 'secret-private-key');
  clean('-----BEGIN PUBLIC KEY-----\n-----END PUBLIC KEY-----');
  clean('Never publish private keys.');
});

test('literal assignments use a finite credential vocabulary, not arbitrary fields', () => {
  const keys = [
    'password', 'passwd', 'pwd', 'secret', 'token', 'api_key', 'api-key', 'apiKey',
    'access_token', 'accessToken', 'auth_token', 'bearer_token', 'refresh_token',
    'client_secret', 'clientSecret', 'private_key', 'AWS_SECRET_ACCESS_KEY',
    'AWS_ACCESS_KEY_ID', 'AWS_SESSION_TOKEN', 'GITHUB_TOKEN', 'PYPI_TOKEN',
    'NPM_TOKEN', 'OPENAI_API_KEY', 'DB_PASSWORD', 'DATABASE_PASS', 'PGPASSWORD',
  ];
  for (const key of keys) {
    for (const separator of ['=', ': ']) {
      hasRule(`${key}${separator}"synthetic-literal-value"`, 'secret-assignment');
    }
  }
  hasRule('{"api_key":"synthetic-literal-value"}', 'secret-assignment');
  hasRule("password='synthetic value with spaces'", 'secret-assignment');
  hasRule('password=`synthetic-value`', 'secret-assignment');
  hasRule('password=x', 'secret-assignment');
  for (const key of ['key', 'id', 'run_id', 'source_id', 'sha256', 'identifier',
    'cache_key', 'monkey', 'password_policy', 'token_count', 'tokenizer', 'parser_token']) {
    clean(`${key}=${BODY.repeat(3)}`);
  }
});

test('metavariable syntax and complete references are nonliteral, never a word allowlist', () => {
  const placeholders = [
    '', '<redacted>', '<placeholder>', '<token>', '<password>', '<secret>',
    '<api-key>', '<api_key>',
    '$TOKEN', '${TOKEN}', '{{ TOKEN }}', '{{ secrets.API_KEY }}',
    'process.env.API_KEY', 'os.environ["API_KEY"]',
  ];
  for (const value of placeholders) {
    clean(`password='${value}'`);
    clean(`api_key=${value}`);
  }
  for (const value of ['null', 'undefined', 'none', 'REDACTED', '[redacted]',
    'placeholder', 'example', 'sample', 'dummy', 'changeme', 'change-me',
    'replace-me', 'not-a-secret', 'your_token_here', 'your_api_key_here',
    'your-password-here', '...', '***', 'xxxx', 'xxxxxxxx',
    'redacted-but-not-really', 'example-real-value',
    '<synthetic-literal>', '${TOKEN}-literal', '{{ TOKEN }}literal', '$TOKEN-literal',
    'process.env.API_KEY + literal', 'os.environ["API_KEY"] + literal']) {
    hasRule(`password="${value.replaceAll('"', '\\"')}"`, 'secret-assignment');
  }
  hasRule(`password=redacted\n${GITHUB}`, 'secret-github');
  hasRule(`api_key=example ${EMAIL}`, 'contact-email');
  hasRule(`password="${PYPI}" # placeholder`, 'secret-pypi');
  hasRule('password=redacted#synthetic-literal', 'secret-assignment');
  clean('password= # an empty assignment');
});

test('shell assignments retain leading punctuation and adjacent literal suffixes', () => {
  const misses = [
    'password=#synthetic-literal',
    "password=''synthetic-literal",
    'password="$TOKEN"-synthetic-literal',
    'password=,synthetic-literal',
  ];
  for (const text of misses) {
    // Exact diagnostics also pin that no raw assignment value is returned.
    assert.deepEqual(screenText(text, LOCATION), [
      { location: LOCATION, line: 1, rule: 'secret-assignment' },
    ]);
  }
  for (const value of ['#', ',', '}', ']', "''", '""', '"$TOKEN"', "'${TOKEN}'",
    '`$TOKEN`', '$TOKEN', '${TOKEN}', '{{ TOKEN }}', '<token>', 'os.environ["TOKEN"]']) {
    for (const suffix of ['-synthetic-literal', "'synthetic-literal'", '"synthetic-literal"',
      '#synthetic-literal', ',synthetic-literal', '}', ']']) {
      hasRule(`password=${value}${suffix}`, 'secret-assignment');
    }
  }
  for (const value of ['#', ',', '}', ']']) hasRule(`password=${value}`, 'secret-assignment');
});

test('complete references and empty values stop at real shell assignment boundaries', () => {
  const values = ['', "''", '""', '$TOKEN', '${TOKEN}', '"$TOKEN"', "'${TOKEN}'",
    '{{ TOKEN }}', '{{ secrets.TOKEN }}', '<token>', 'process.env.TOKEN', 'os.environ["TOKEN"]'];
  for (const value of values) {
    for (const suffix of ['', ' ', '\t', ' # synthetic comment',
      '; other=synthetic-literal', ' && other=synthetic-literal', ' | other=synthetic-literal',
      ';other=synthetic-literal', '&other=synthetic-literal', '|other=synthetic-literal']) {
      clean(`password=${value}${suffix}`);
    }
    for (const separator of ['; ', ' && ', ' | ', ';', '&', '|']) {
      hasRule(`password=${value}${separator}token=synthetic-literal`, 'secret-assignment');
    }
    // A nonempty assignment ends at whitespace, not at the next assignment's value.
    if (value) {
      clean(`password=${value} other=synthetic-literal`);
      hasRule(`password=${value} token=synthetic-literal`, 'secret-assignment');
    }
  }
});

test('hash starts an assignment comment only at a whitespace boundary', () => {
  for (const text of ['password= # synthetic comment', 'password=\t# synthetic comment',
    'password="" # synthetic comment', 'password=$TOKEN # synthetic comment',
    'password: # synthetic comment', 'password: "$TOKEN" # synthetic comment']) clean(text);
  for (const text of ['password=#synthetic-literal', 'password:#synthetic-literal',
    'password=""#synthetic-literal', 'password=$TOKEN#synthetic-literal',
    'password: "$TOKEN"#synthetic-literal']) hasRule(text, 'secret-assignment');
});

test('JSON and YAML separators end complete values without hiding separate assignments', () => {
  for (const value of ['', "''", '""', '$TOKEN', '${TOKEN}', '"${TOKEN}"',
    "'${TOKEN}'", '{{ TOKEN }}', '<token>', 'process.env.TOKEN', 'os.environ["TOKEN"]']) {
    for (const key of ['password', '"password"']) {
      for (const suffix of ['}', ']', ', note: synthetic-literal}',
        ', "note": "synthetic-literal"}', '}, {note: synthetic-literal}]']) {
        clean(`{${key}: ${value}${suffix}`);
      }
      for (const next of [', token: synthetic-literal}', ', "token": "synthetic-literal"}',
        '}, {token: synthetic-literal}]']) {
        hasRule(`{${key}: ${value}${next}`, 'secret-assignment');
      }
    }
  }
  for (const value of ['""synthetic-literal', '"$TOKEN"-synthetic-literal',
    '${TOKEN}-synthetic-literal', '{{ TOKEN }}synthetic-literal',
    'os.environ["TOKEN"]-synthetic-literal', '$TOKEN;synthetic-literal',
    '$TOKEN&synthetic-literal', '$TOKEN|synthetic-literal']) {
    hasRule(`{"password": ${value}, "note": "synthetic-literal"}`, 'secret-assignment');
  }
  clean('{"password":"${TOKEN}","token":"$TOKEN"}');
  hasRule('{"password":"${TOKEN}","token":"synthetic-literal"}', 'secret-assignment');
});

test('unclosed quotes and escaped boundaries cannot truncate a literal assignment', () => {
  for (const value of ['"', "'", '`', '"$TOKEN', "'${TOKEN}", '`<token>',
    '$TOKEN\\;synthetic-literal', '$TOKEN\\ synthetic-literal', '$TOKEN\\#synthetic-literal',
    '"$TOKEN\\"synthetic-literal"', '""\\,synthetic-literal',
    "'\\'synthetic-literal", "'\\' token=synthetic-literal"]) {
    hasRule(`password=${value}`, 'secret-assignment');
  }
});

test('authorization prose is not a header; real header and assignment syntax still refuses', () => {
  clean('An observation is not authorization: **a separate check is required**.');
  for (const value of ['Authorization: synthetic-literal', 'authorization=synthetic-literal',
    'request authorization=synthetic-literal', '{authorization: synthetic-literal}',
    'curl -H "Authorization: synthetic-literal"',
    'Use Authorization: Bearer synthetic-literal']) hasRule(value, 'secret-assignment');
});

test('Authorization headers screen credentials, not the Basic or Bearer scheme alone', () => {
  for (const scheme of ['Bearer', 'Basic']) {
    hasRule(`Authorization: ${scheme} ${BODY}`, 'secret-assignment');
    hasRule(`"Authorization": "${scheme} ${BODY}"`, 'secret-assignment');
    clean(`Authorization: ${scheme}`);
    clean(`Authorization: "${scheme}"`);
    clean(`Authorization: ${scheme} <token>`);
    clean(`Authorization: ${scheme} \${TOKEN}`);
    clean(`Authorization: "${scheme} <token>"`);
    clean(`Authorization: ${scheme} # synthetic comment`);
    clean(`{"Authorization": "${scheme} <token>", "note": "synthetic-literal"}`);
    hasRule(`{"Authorization": "${scheme} <token>", "password": "synthetic-literal"}`, 'secret-assignment');
    hasRule(`Authorization: "${scheme}"synthetic-literal`, 'secret-assignment');
    hasRule(`Authorization: ${scheme} "\${TOKEN}"-synthetic-literal`, 'secret-assignment');
    hasRule(`Authorization: "${scheme} <token>"-synthetic-literal`, 'secret-assignment');
  }
});

test('credential-bearing URL userinfo refuses, including percent-encoded credentials', () => {
  for (const protocol of ['https', 'http', 'postgres', 'postgresql', 'mysql', 'mongodb+srv', 'redis', 'ftp']) {
    hasRule(`${protocol}://synthetic-user:synthetic-password@example.com/resource`, 'secret-credential-url');
  }
  hasRule('https://synthetic-user%3Asynthetic-password@example.org', 'secret-credential-url');
  hasRule("https://synthetic-user:synthetic'password@example.com/resource", 'secret-credential-url');
  hasRule("https://synthetic'user:synthetic'password@example.com", 'secret-credential-url');
  hasRule(`https://${GITHUB}@example.com/path`, 'secret-credential-url');
  hasRule(`https://${encodeURIComponent(PYPI)}@example.com/path`, 'secret-credential-url');
  hasRule('https://synthetic-user:bad%zz@example.net', 'secret-credential-url');
  hasRule('https://synthetic-user:synthetic-password@192.0.2.1:8443/path', 'secret-credential-url');
  hasRule('https://example.com/?next=https://synthetic-user:synthetic-password@example.org', 'secret-credential-url');
  for (const text of [
    'https://example.com:8443/path', 'https://synthetic-user@example.com/path',
    'https://synthetic-user:@example.com',
    'https://synthetic-user:%3Cpassword%3E@example.com',
  ]) clean(text);
  for (const text of ['https://synthetic-user:REDACTED@example.com',
    'postgres://synthetic-user:changeme@192.0.2.1/database']) hasRule(text, 'secret-credential-url');
});

test('contact-email detects ordinary addresses and literal endpoints', () => {
  for (const text of [EMAIL, `<${EMAIL}>`, `mailto:${EMAIL}`, `Contact: ${EMAIL}.`,
    'synthetic.person+tag@sub.synthetic-contact.tld', 'synthetic@[198.18.0.1]',
    'synthetic@[IPv6:2001:db8::1]']) hasRule(text, 'contact-email');
  clean('package@1.2.3');
  clean('symbol@identifier');
});

test('RFC2606/6761 exclusions include subdomains but never near-miss suffixes', () => {
  for (const host of ['example.com', 'example.net', 'example.org', 'example', 'test', 'invalid', 'localhost']) {
    clean(`synthetic@${host}`);
    clean(`synthetic@sub.${host}`);
    clean(`synthetic@deep.sub.${host.toUpperCase()}.`);
  }
  for (const host of ['notexample.com', 'example.company', 'example.com.evil.tld',
    'sub.example.net.evil.tld', 'notexample.org', 'example.org-evil.tld',
    'notlocalhost.tld', 'invalid.evil.tld', 'testing.tld', 'localhost.evil.tld']) {
    hasRule(`synthetic@${host}`, 'contact-email');
  }
});

test('documentation IP exclusions are exact and do not suppress independent secrets', () => {
  for (const block of ['192.0.2', '198.51.100', '203.0.113']) {
    for (const last of [0, 1, 254, 255]) clean(`synthetic@[${block}.${last}]`);
  }
  for (const ip of ['192.0.20.1', '198.51.101.1', '203.0.114.1']) {
    hasRule(`synthetic@[${ip}]`, 'contact-email');
  }
  hasRule(`api_key=${GITHUB}\nsynthetic@example.org`, 'secret-github');
  hasRule(`password=synthetic-password\nsynthetic@[192.0.2.1]`, 'secret-assignment');
});

test('noreply exemption is commit-only and limited to final attribution trailers', () => {
  const addresses = [
    'noreply@synthetic-contact.tld', 'no-reply@synthetic-contact.tld',
    '12345+synthetic@users.noreply.github.com', 'synthetic@users.noreply.github.com',
    '12345-synthetic@users.noreply.gitlab.com',
  ];
  for (const address of addresses) {
    const trailer = `Co-authored-by: Synthetic Fixture <${address}>`;
    const commit = `Synthetic subject\n\nSynthetic body.\n\n${trailer}\n`;
    clean(commit, { commit: true });
    hasRule(commit, 'contact-email');
    hasRule(commit, 'contact-email', { commit: false });
    hasRule(`Synthetic subject\n\nContact ${address} in prose.`, 'contact-email', { commit: true });
    hasRule(trailer, 'contact-email', { commit: true });
    hasRule(`Synthetic subject\n${trailer}`, 'contact-email', { commit: true });
    hasRule(`Synthetic subject\n\n${trailer}\nBody after trailer.`, 'contact-email', { commit: true });
    hasRule(`Synthetic subject\n\n${trailer} extra prose`, 'contact-email', { commit: true });
    hasRule(`Synthetic subject\n\nContact: ${address}`, 'contact-email', { commit: true });
  }
});

test('noreply exemptions never silence other content or near-miss noreply domains', () => {
  for (const address of [EMAIL, 'not-noreply@synthetic-contact.tld',
    'synthetic@users.noreply.github.com.evil.tld', 'synthetic@notusers.noreply.github.com',
    'synthetic@noreply.github.com', 'synthetic@users.noreply.gitlab.com.evil.tld']) {
    hasRule(`Subject\n\nSigned-off-by: Synthetic <${address}>`, 'contact-email', { commit: true });
  }
  const noreply = 'synthetic@users.noreply.github.com';
  clean(`Subject\n\nReviewed-by: Synthetic <${noreply}>\nSigned-off-by: Synthetic <${noreply}>\n\n`, { commit: true });
  hasRule(`Subject\n\n${EMAIL}\n\nCo-authored-by: Synthetic <${noreply}>`, 'contact-email', { commit: true });
  hasRule(`Subject\n\nCo-authored-by: ${EMAIL} <${noreply}>`, 'contact-email', { commit: true });
  hasRule(`Subject\n\nCo-authored-by: ${GITHUB} <${noreply}>`, 'secret-github', { commit: true });
  hasRule(`Subject\n\nCo-authored-by: ${PHONE} <${noreply}>`, 'contact-phone', { commit: true });
});

test('phone-shaped contacts include common NANP and international formats', () => {
  for (const phone of [
    PHONE, '202-555-0104', '(202) 555-0104', '(202)555-0104', '202.555.0104',
    '202 555 0104', '1-202-555-0104', '+12025550104', '+1 (202) 555-0104',
    '+44 20 7946 0958', '+44 (0)20 7946 0958', '+447700900123',
    '+49 30 12345678', '+34 612 345 678', '+61 2 5550 0123', '+81-3-1234-5678',
    'phone: 2025550104', 'telephone=020 7946 0958', 'tel:+442079460958',
    'fax: 555-0104', 'mobile: 07700 900123',
  ]) hasRule(`Contact ${phone}`, 'contact-phone');
});

test('timestamps, ports, versions, PR/issues, run IDs and Git hashes are not phones or secrets', () => {
  for (const text of [
    '2026-11-03T06:41:12.123Z', '2026-11-03 06:41:12 +0200',
    '2026-11-03T06:41:12.123+01:00', 'timestamp=1793688072123',
    '+2026-11-03', '20261103', '06:41:12',
    'port: 5432', 'https://example.com:8443', '192.0.2.1:65535',
    '127.0.0.1', '198.51.100.123', '203.0.113.123',
    'v1.2.3', 'version 2026.11.3', 'v202.555.0104', '1.23.456.7890',
    'PR #2025550104', 'issue #2025550104', 'ABC-2025550104',
    'https://example.org/pull/2025550104', 'run_id=202555010412345',
    'run-2025550104', '0123456789abcdef'.repeat(4), 'a'.repeat(40),
    '2025550104abcdef'.repeat(4), 'ref/202-555-0104/item',
    'build-202-555-0104', 'value202-555-0104suffix',
    '123-456-7890', '202-155-0104', '+1234567890123456',
    'tel: 192.0.2.1', 'phone: 2026-11-03',
  ]) clean(text);
});

test('line numbers and deterministic deduplication include CRLF, CR and trailing newlines', () => {
  const text = `heading\r\n${PYPI} ${PYPI}\r\n\r${EMAIL}\n${PHONE}\n`;
  const expected = [
    { location: LOCATION, line: 2, rule: 'secret-pypi' },
    { location: LOCATION, line: 4, rule: 'contact-email' },
    { location: LOCATION, line: 5, rule: 'contact-phone' },
  ];
  assert.deepEqual(screenText(text, LOCATION), expected);
  assert.deepEqual(screenBytes(Buffer.from(text), LOCATION), expected);
  assert.deepEqual(screenText(text, LOCATION), expected);
  const crlf = 'Subject\r\n\r\nCo-authored-by: Synthetic <synthetic@users.noreply.github.com>\r\n';
  clean(crlf, { commit: true });
});

test('multiple rules on a line are ordered and findings contain only trusted labels and IDs', () => {
  const text = `api_key=${GITHUB} ${PYPI} ${EMAIL} ${PHONE}`;
  const findings = screenText(text, LOCATION);
  assert.deepEqual(findings.map(f => f.rule), [
    'secret-pypi', 'secret-github', 'secret-assignment', 'contact-email', 'contact-phone',
  ]);
  for (const finding of findings) {
    assert.deepEqual(Object.keys(finding), ['location', 'line', 'rule']);
    assert.equal(finding.location, LOCATION);
    assert.equal(finding.line, 1);
    assert.ok(RULE_IDS.includes(finding.rule));
  }
  const serialized = JSON.stringify(findings);
  for (const value of [PYPI, GITHUB, EMAIL, PHONE, 'api_key']) assert.equal(serialized.includes(value), false);
  const independentlyReturned = screenText(text, LOCATION);
  findings[0].rule = 'mutated-by-caller';
  assert.notDeepEqual(findings, independentlyReturned);
});

test('strict UTF-8 bytes reject malformed, overlong, surrogate, truncated and out-of-range sequences', () => {
  for (const bytes of [
    [0x80], [0xc0, 0xaf], [0xc1, 0xbf], [0xe0, 0x80, 0x80],
    [0xed, 0xa0, 0x80], [0xed, 0xbf, 0xbf], [0xf0, 0x80, 0x80, 0x80],
    [0xf4, 0x90, 0x80, 0x80], [0xf5, 0x80, 0x80, 0x80], [0xff],
    [0xc2], [0xe2, 0x82], [0xf0, 0x9f, 0x98], [0xe2, 0x28, 0xa1],
    [0xff, 0xfe, 0x61, 0], [0, 0x61],
  ]) inputError(() => screenBytes(Uint8Array.from(bytes), 'private-input-label'));
  clean('Valid Unicode: café, 日本語, 😀, \uFFFD.');
  assert.deepEqual(screenBytes(Buffer.from('Valid Unicode: café, 日本語, 😀, \uFFFD.'), LOCATION), []);
  assert.deepEqual(screenBytes(Buffer.from(`\uFEFF${GITHUB}`), LOCATION), screenText(`\uFEFF${GITHUB}`, LOCATION));
});

test('NUL, lone surrogates, unsupported types and unsafe options fail with one static error', () => {
  for (const text of ['\0', `private-value\0${EMAIL}`, '\uD800', '\uDC00', 'x\uDFFFy', '\uD800\uD800']) {
    inputError(() => screenText(text, 'private-input-label'));
  }
  for (const bytes of [null, undefined, 'text', [1, 2], new ArrayBuffer(8), new Uint16Array(8), {}]) {
    inputError(() => screenBytes(bytes, LOCATION));
  }
  for (const text of [null, undefined, 7, {}, Buffer.from('text')]) inputError(() => screenText(text, LOCATION));
  inputError(() => screenText('text', { toString() { throw new Error('untrusted-error-text'); } }));
  for (const options of [null, true, [], 'commit', { commit: 'true' }, { commit: null },
    { skip: true }, { ignore: ['contact-email'] }, { allow: ['synthetic-contact.tld'] },
    { maxBytes: Infinity }, { commit: true, ignore: true }]) {
    inputError(() => screenText(EMAIL, LOCATION, options));
    inputError(() => screenBytes(Buffer.from(EMAIL), LOCATION, options));
  }
  inputError(() => screenText(EMAIL, LOCATION, { get commit() { throw new Error('untrusted-error-text'); } }));
  inputError(() => screenText(EMAIL, LOCATION, new Proxy({}, {
    ownKeys() { throw new Error('untrusted-error-text'); },
  })));
  inputError(() => screenBytes(new Proxy(new Uint8Array(8), {}), LOCATION));
  assert.deepEqual(screenText(EMAIL, LOCATION, { commit: undefined }), screenText(EMAIL, LOCATION));
});

test('four MiB limit applies to raw bytes and UTF-8 length, including exact boundary', () => {
  const ascii = 'a'.repeat(MAX);
  clean(ascii);
  assert.deepEqual(screenBytes(Buffer.from(ascii), LOCATION), []);
  inputError(() => screenText(`${ascii}a`, LOCATION));
  inputError(() => screenBytes(Buffer.alloc(MAX + 1, 0x61), LOCATION));
  clean('é'.repeat(MAX / 2));
  inputError(() => screenText('é'.repeat(MAX / 2 + 1), LOCATION));
  clean('😀'.repeat(MAX / 4));
  inputError(() => screenText('😀'.repeat(MAX / 4 + 1), LOCATION));
  const boundary = `${'a'.repeat(MAX - Buffer.byteLength(GITHUB) - 1)} ${GITHUB}`;
  hasRule(boundary, 'secret-github');
  const backing = Buffer.from(`!${EMAIL}!`);
  assert.deepEqual(screenBytes(backing.subarray(1, backing.length - 1), LOCATION), screenText(EMAIL, LOCATION));
});

test('no caller input, location or decoder details appear in input-error diagnostics', () => {
  const sentinel = 'synthetic-private-value-must-not-appear';
  try {
    screenBytes(Buffer.concat([Buffer.from(sentinel), Buffer.from([0xff])]), sentinel);
    assert.fail('invalid input unexpectedly accepted');
  } catch (error) {
    assert.equal(error.code, 'E_CONTENT_INPUT');
    for (const rendered of [String(error), error.stack, JSON.stringify(error)]) {
      assert.equal(rendered.includes(sentinel), false);
      assert.equal(rendered.includes('encoded data'), false);
    }
  }
});

test('environment and textual bypass attempts cannot disable screening', () => {
  const child = spawnSync(process.execPath, ['--input-type=module', '--eval', `
    import { screenText } from ${JSON.stringify(MODULE.href)};
    const text = ${JSON.stringify(`<!-- okf-ignore -->\n# skip content screen\n${GITHUB}\n${EMAIL}`)};
    process.stdout.write(JSON.stringify(screenText(text, 'fixed')));
  `], {
    encoding: 'utf8',
    env: { ...process.env,
      OKF_CONTENT_SCREEN: 'off', OKF_SKIP_CONTENT_SCREEN: '1',
      OKF_CONTENT_SCREEN_IGNORE: '*', OKF_CONTENT_IGNORE: '*',
      OKF_ALLOW_SECRETS: '1', OKF_ALLOW_PERSONAL_DATA: '1',
      OKF_CONTENT_MAX_BYTES: '999999999', OKF_STRICT_EXIT: '0',
      SKIP_CONTENT_SCREEN: '1', NO_CONTENT_SCREEN: '1',
    },
  });
  assert.equal(child.status, 0);
  assert.equal(child.stderr, '');
  assert.deepEqual(JSON.parse(child.stdout), [
    { location: 'fixed', line: 3, rule: 'secret-github' },
    { location: 'fixed', line: 4, rule: 'contact-email' },
  ]);
});

test('long synthetic near-matches and malformed trailers stay bounded without skipping later content', () => {
  // Use a subprocess timeout: an in-process test timeout cannot stop a regex
  // that blocks the event loop. This is a regression guard, not a speed claim.
  const child = spawnSync(process.execPath, ['--input-type=module', '--eval', `
    import assert from 'node:assert/strict';
    import { screenText } from ${JSON.stringify(MODULE.href)};
    for (const prefix of ['Subject\\n\\nCo-authored-by: Synthetic ',
      'Subject\\n\\nCo-authored-by: ', 'Subject\\n\\nCo-authored-by: Synthetic <']) {
      const text = prefix + ' '.repeat(1024 * 1024) + '\\n' + ${JSON.stringify(EMAIL)};
      assert.deepEqual(screenText(text, 'fixed', {commit: true}),
        [{location: 'fixed', line: 4, rule: 'contact-email'}]);
      // Also enter the actual final-trailer-block parser with an unclosed name.
      assert.deepEqual(screenText(prefix + ' '.repeat(1024 * 1024), 'fixed', {commit: true}), []);
    }
    assert.deepEqual(screenText('password=<token> '.repeat(10000), 'fixed'), []);
    assert.deepEqual(screenText(${JSON.stringify('password="${TOKEN}" token=<token>; ')}.repeat(10000), 'fixed'), []);
    assert.deepEqual(screenText(${JSON.stringify('{password: {{ TOKEN }}, token: ""} ')}.repeat(10000), 'fixed'), []);
    for (const value of ['"' + ' '.repeat(1024 * 1024),
      ${JSON.stringify('"$TOKEN"')} + '""'.repeat(100000) + '-synthetic-literal',
      '{{' + ' '.repeat(1024 * 1024) + 'TOKEN }}-synthetic-literal']) {
      assert.deepEqual(screenText('password=' + value, 'fixed'),
        [{location: 'fixed', line: 1, rule: 'secret-assignment'}]);
    }
    assert.deepEqual(screenText('password=redacted '.repeat(10000), 'fixed'),
      [{location: 'fixed', line: 1, rule: 'secret-assignment'}]);
    assert.deepEqual(screenText((${JSON.stringify(GITHUB)} + ' ').repeat(10000), 'fixed'),
      [{location: 'fixed', line: 1, rule: 'secret-github'}]);
  `], { encoding: 'utf8', timeout: 10000 });
  assert.equal(child.error, undefined);
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout, '');
});

test('bounded screen makes no claim to detect names or contextual personal information', () => {
  // Deliberately undetected limitations, not a declaration that these categories
  // are safe to publish. The gate's separate contextual review still applies.
  clean('A Synthetic Person attended a private meeting at a sensitive location.');
  clean('Contact: synthetic [at] synthetic-contact [dot] tld');
  clean('Unlabelled numeric identifier 2025550104');
  clean('Opaque identifier ' + BODY.repeat(4));
});
