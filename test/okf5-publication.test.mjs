import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Real Git owns objects, reachability, pushes and leases. gh is deliberately
// only an argv-checked local adapter: these tests do NOT prove GitHub delivery,
// deletion of GitHub pull refs, or purging unreachable objects from storage.
// Every value below is synthetic; no credentials or external remotes are used.
const SCRIPT = fileURLToPath(new URL('../oats-package/capabilities/oats-okf-harvest/skills/okf-authoring/scripts/okf-publication.mjs', import.meta.url));
const GITHUB = 'fixture-owner/fixture-knowledge';
const BRANCH = 'okf-harvest/synthetic-publication';
const REF = `refs/heads/${BRANCH}`;
const PR = '17';
const SECRET = `ghp_${'A'.repeat(36)}`;
const CONTACT = 'synthetic-person@contacts.synthetic-fixture.org';
const IDENTITY = ['-c', 'user.name=OKF fixture', '-c', 'user.email=fixture@localhost', '-c', 'commit.gpgSign=false'];
const jsonLines = path => fs.existsSync(path) ? fs.readFileSync(path, 'utf8').split('\n').filter(Boolean).map(JSON.parse) : [];
const provenance = (version = 2) => ({
  version,
  ...(version === 1 ? { run: '12345678-1234-4123-8123-123456789abc', input: ['ab'.repeat(32)] } : { evidence: [{ note: 'notes/decision.md', sha256: 'ab'.repeat(32) }] }),
  source: { soul: 'fixture', ...(version === 1 ? { soulId: null } : {}), owner: 'fixture', instance: 'fixture-source', ownedNodes: ['kb/expert'], readNodes: [], bases: [{ alias: 'kb', id: 'fixture-base', kind: 'git', root: '.', repository: GITHUB }] },
  tasks: { provider: null, refs: [] }, harvester: { instance: 'fixture-harvester', alias: null },
});
const body = (p = provenance(), prose = 'A synthetic knowledge proposal.') => `${prose}\n\n\`\`\`okf-harvest\n${JSON.stringify(p, null, 2)}\n\`\`\`\n`;
const verdict = (head, decision = 'merge') => `Reviewed this exact synthetic head.\n\n\`\`\`okf-review\n${JSON.stringify({ headSha: head, verdict: decision })}\n\`\`\`\n`;

// The adapter rejects unknown argv rather than silently accepting imaginary gh
// options. It records attempted calls separately from successful write effects.
// Races execute at an explicit gh boundary, using real Git update-ref; no sleeps,
// polling, production instrumentation, or copied publication algorithms.
const FAKE_GH = String.raw`const fs = require('node:fs');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const a = process.argv.slice(2), repo = 'fixture-owner/fixture-knowledge', pr = '17';
const stateFile = process.env.FIXTURE_GH_STATE, log = process.env.FIXTURE_GH_LOG;
const s = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
const save = () => fs.writeFileSync(stateFile, JSON.stringify(s));
function git(where, args) {
  const r = spawnSync('git', args, { cwd: where, env: process.env, encoding: 'utf8' });
  assert.equal(r.status, 0, 'fixture Git operation failed: ' + r.stderr);
  return r.stdout.trim();
}
function head() { return git(process.env.FIXTURE_REMOTE, ['rev-parse', 'refs/heads/' + s.headRefName]); }
function hook(event) {
  const h = s.hook;
  if (!h || h.done || h.event !== event) return;
  h.seen = (h.seen || 0) + 1;
  if (h.seen !== (h.at || 1)) return;
  h.done = true;
  if (h.action === 'remote-ref') git(process.env.FIXTURE_REMOTE, ['update-ref', h.ref, h.oid]);
  else if (h.action === 'local-head') git(process.env.FIXTURE_REPO, ['update-ref', 'HEAD', h.oid]);
  else if (h.action === 'file') fs.writeFileSync(h.path, h.text);
  else if (h.action === 'gh-state') Object.assign(s, h.patch);
  else assert.fail('unknown fixture hook action');
}
let kind;
try {
  if (a[0] === 'label' && a[1] === 'create') {
    assert.deepEqual(a, ['label', 'create', 'okf-harvest', '--repo', repo, '--force', '--color', '0E8A16', '--description', 'OKF harvest PR (oats.okf)']); kind = 'label';
  } else if (a[0] === 'pr' && a[1] === 'view') {
    assert.deepEqual(a, ['pr', 'view', pr, '--repo', repo, '--json', 'state,headRefOid,headRefName,baseRefName,isCrossRepository,title,body']); kind = 'view';
  } else if (a[0] === 'pr' && a[1] === 'create') {
    assert.equal(a.length, 14);
    assert.deepEqual(a.slice(0, 7), ['pr', 'create', '--repo', repo, '--base', 'main', '--head']);
    assert.match(a[7], /^okf-harvest\//);
    assert.deepEqual(a.slice(8), ['--label', 'okf-harvest', '--title', 'OKF knowledge proposal', '--body-file', '-']);
    kind = 'create';
  } else if (a[0] === 'pr' && a[1] === 'edit') {
    assert.deepEqual(a, ['pr', 'edit', pr, '--repo', repo, '--title', 'OKF knowledge proposal', '--body-file', '-']); kind = 'edit';
  } else if (a[0] === 'pr' && a[1] === 'comment') {
    assert.deepEqual(a, ['pr', 'comment', pr, '--repo', repo, '--body-file', '-']); kind = 'comment';
  } else if (a[0] === 'pr' && a[1] === 'close') {
    assert.deepEqual(a, ['pr', 'close', pr, '--repo', repo]); kind = 'close';
  } else if (a[0] === 'pr' && a[1] === 'merge') {
    assert.equal(a.length, 12);
    assert.deepEqual(a.slice(0, 7), ['pr', 'merge', pr, '--repo', repo, '--squash', '--match-head-commit']);
    assert.match(a[7], /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/);
    assert.deepEqual(a.slice(8), ['--subject', 'OKF knowledge proposal', '--body-file', '-']); kind = 'merge';
  } else assert.fail('unsupported command');
} catch (e) {
  fs.appendFileSync(log, JSON.stringify({ unsupported: true, argv: a, error: e.message }) + '\n');
  process.exit(97);
}
const input = a.includes('--body-file') ? fs.readFileSync(0, 'utf8') : null;
const entry = { kind, argv: a, input, write: kind !== 'view', effect: false };
let response = '';
if (s.fail === kind) {
  fs.appendFileSync(log, JSON.stringify(entry) + '\n');
  console.error(s.failureText); process.exit(9);
}
// gh create/close have no atomic head predicate. A before-write race may
// legitimately change their target; only a subsequent read can detect it.
hook('before-' + kind);
if (kind === 'view') {
  response = JSON.stringify({ state: s.state, headRefOid: s.overrideHead || head(), headRefName: s.headRefName,
    baseRefName: s.baseRefName, isCrossRepository: s.isCrossRepository, title: s.title, body: s.body });
} else if (kind === 'merge' && a[7] !== head()) {
  fs.appendFileSync(log, JSON.stringify(entry) + '\n');
  console.error('fixture match-head-commit refused'); process.exit(8);
} else {
  entry.effect = true;
  if (kind === 'create') { s.headRefName = a[7]; s.title = a[11]; s.body = input; s.state = 'OPEN'; response = 'https://github.com/fixture-owner/fixture-knowledge/pull/17'; }
  if (kind === 'edit') { s.title = a[6]; s.body = input; }
  if (kind === 'comment') (s.comments ||= []).push(input);
  if (kind === 'close') s.state = 'CLOSED';
  if (kind === 'merge') { s.state = 'MERGED'; s.merge = { head: a[7], subject: a[9], body: input }; }
}
fs.appendFileSync(log, JSON.stringify(entry) + '\n');
hook(kind); save();
process.stdout.write(response + '\n');
`;

function fixture(t, { seed } = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'okf5-publication-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repo = join(root, 'work'), remote = join(root, 'origin.git'), bin = join(root, 'bin');
  const ghLog = join(root, 'gh.jsonl'), ghState = join(root, 'gh-state.json');
  fs.mkdirSync(bin); fs.mkdirSync(join(root, 'home'));
  const env = {
    PATH: `${bin}:${process.env.PATH}`, HOME: join(root, 'home'), XDG_CONFIG_HOME: join(root, 'home', '.config'),
    LANG: 'C', LC_ALL: 'C', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_DATE: '2026-10-10T00:00:00Z', GIT_COMMITTER_DATE: '2026-10-10T00:00:00Z',
    FIXTURE_GH_LOG: ghLog, FIXTURE_GH_STATE: ghState, FIXTURE_REPO: repo, FIXTURE_REMOTE: remote,
  };
  const rawGit = (where, args, extra = {}) => spawnSync('git', args, { cwd: where, env, encoding: 'utf8', timeout: 30000, ...extra });
  const git = (where, ...args) => {
    const r = rawGit(where, args);
    assert.equal(r.status, 0, `fixture git ${args.join(' ')}: ${r.stderr}`);
    return r.stdout.trim();
  };
  git(root, 'init', '-q', '--bare', '-b', 'main', remote);
  git(root, 'clone', '-q', remote, repo);
  git(repo, 'config', 'user.name', 'OKF fixture'); git(repo, 'config', 'user.email', 'fixture@localhost');
  git(repo, 'config', 'commit.gpgSign', 'false'); git(repo, 'config', 'core.autocrlf', 'false');
  // Even erroneous production code must not contact a network destination.
  git(repo, 'config', 'protocol.allow', 'never'); git(repo, 'config', 'protocol.file.allow', 'always');
  const put = (path, data) => { const p = join(repo, path); fs.mkdirSync(dirname(p), { recursive: true }); fs.writeFileSync(p, data); return p; };
  const artifact = (name, data) => { const p = join(root, name); fs.writeFileSync(p, data); return p; };
  const commit = (message = 'Synthetic knowledge change', options = []) => {
    git(repo, 'add', '-A');
    const msg = artifact('fixture-commit.txt', message);
    git(repo, ...IDENTITY, ...options, 'commit', '-q', '--allow-empty', '-F', msg);
    return git(repo, 'rev-parse', 'HEAD');
  };
  put('expert/decision.md', '# Synthetic accepted decision\n');
  seed?.({ repo, put, git });
  const base = commit('Synthetic accepted base'); git(repo, 'push', '-q', 'origin', 'HEAD:refs/heads/main');
  const bodyFile = artifact('body.md', body()), commitFile = artifact('replacement.txt', 'Sanitized synthetic knowledge proposal\n');
  fs.writeFileSync(join(bin, 'gh'), `#!${process.execPath}\n${FAKE_GH}`, { mode: 0o755 });
  const state = {
    state: 'OPEN', headRefName: BRANCH, baseRefName: 'main', isCrossRepository: false,
    title: 'OKF knowledge proposal', body: body(),
  };
  fs.writeFileSync(ghState, JSON.stringify(state));
  const patchGh = patch => fs.writeFileSync(ghState, JSON.stringify({ ...JSON.parse(fs.readFileSync(ghState, 'utf8')), ...patch }));
  const refs = () => git(remote, 'for-each-ref', '--format=%(refname) %(objectname)');
  // Object filenames, not just reachable OIDs: a refused push must not upload
  // objects and then merely roll back the ref. All fixture objects are immutable.
  const objects = () => fs.readdirSync(join(remote, 'objects'), { recursive: true }).sort();
  const snapshot = () => ({ refs: refs(), objects: objects() });
  const calls = () => jsonLines(ghLog);
  const options = (command, head, extra) => {
    const common = { repo, remote, github: GITHUB, base, 'base-branch': 'main', head };
    if (command === 'screen') return { repo, base, head, ...extra };
    if (command === 'screen-tree') return { repo, head, ...extra };
    if (command === 'commit') return { repo, base, head, branch: BRANCH, 'commit-file': commitFile, ...extra };
    if (command === 'create') return { ...common, branch: BRANCH, 'body-file': bodyFile, ...extra };
    if (command === 'rewrite' || command === 'amend-legacy') return { ...common, pr: PR, 'body-file': bodyFile, 'commit-file': commitFile, ...extra };
    const verdictFile = artifact('verdict.md', verdict(head, command.startsWith('close') ? 'close' : 'merge'));
    return { ...common, pr: PR, 'verdict-file': verdictFile, ...extra };
  };
  const run = (command, head, extra = {}) => {
    const args = Object.entries(options(command, head, extra)).flatMap(([k, v]) => v === undefined ? [] : (Array.isArray(v) ? v : [v]).flatMap(value => [`--${k}`, value]));
    const r = spawnSync(process.execPath, [SCRIPT, command, ...args], { cwd: root, env, encoding: 'utf8', timeout: 30000 });
    assert.equal(r.signal, null, 'publication CLI timed out or was signalled'); assert.equal(r.error, undefined);
    assert.equal(r.stderr, '', 'the CLI must not forward raw Git/gh stderr');
    assert.ok(r.stdout.trim(), 'the production CLI must return JSON');
    const out = JSON.parse(r.stdout);
    assert.deepEqual(calls().filter(c => c.unsupported), [], 'fake gh refused an unsupported argv, not a publication refusal');
    return { ...r, out };
  };
  const change = () => { put('expert/decision.md', '# Synthetic proposed decision\n'); return commit(); };
  const publish = (head, branch = BRANCH) => git(repo, 'push', '-q', 'origin', `${head}:refs/heads/${branch}`);
  const open = (head, patch = {}) => { publish(head, patch.headRefName ?? BRANCH); patchGh(patch); };
  const receiveHook = ({ where = remote, ref, oid }) => {
    // Git's supported receivepack transport override supplies a deterministic
    // pre-advertisement server boundary. The shim invokes REAL receive-pack;
    // it does not fabricate Git results or implement any lease decisions.
    const hook = join(root, 'receive-pack-boundary'), log = join(root, 'receive-pack.json');
    fs.writeFileSync(hook, `#!${process.execPath}\nconst fs = require('node:fs');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const argv = process.argv.slice(2);
assert.deepEqual(argv, [${JSON.stringify(remote)}]);
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^GIT_/.test(k)));
const change = spawnSync('git', ['-C', ${JSON.stringify(where)}, 'update-ref', ${JSON.stringify(ref)}, ${JSON.stringify(oid)}], { env, encoding: 'utf8' });
assert.equal(change.status, 0, change.stderr);
fs.writeFileSync(${JSON.stringify(log)}, JSON.stringify({ argv, changed: true }));
const result = spawnSync('git', ['receive-pack', ...argv], { env, stdio: 'inherit' });
process.exit(result.status ?? 98);\n`, { mode: 0o755 });
    git(repo, 'config', 'remote.origin.receivepack', hook);
    return () => {
      assert.ok(fs.existsSync(log), 'the race must actually execute at the real receive-pack boundary');
      assert.deepEqual(JSON.parse(fs.readFileSync(log)), { argv: [remote], changed: true });
    };
  };
  return { root, repo, remote, bin, env, git, rawGit, put, artifact, commit, base, bodyFile, commitFile, refs, snapshot, calls, patchGh, run, change, publish, open, receiveHook };
}
function success(r) {
  assert.equal(r.status, 0, JSON.stringify(r.out)); assert.equal(r.out.ok, true); return r.out;
}
function refusal(r, code = 'E_CONTENT_REFUSED') {
  assert.equal(r.out.ok, false, `expected ${code}, got ${JSON.stringify(r.out)}`);
  assert.equal(r.out.code, code); assert.equal(r.status, code === 'E_CONTENT_REFUSED' ? 1 : 2);
  for (const value of [SECRET, CONTACT]) assert.ok(!`${r.stdout}${r.stderr}`.includes(value), 'diagnostics must not echo refused values');
  if (code === 'E_CONTENT_REFUSED') {
    assert.ok(r.out.findings.length > 0);
    for (const finding of r.out.findings) {
      assert.deepEqual(Object.keys(finding).sort(), ['line', 'location', 'rule']);
      assert.ok(Number.isInteger(finding.line) && finding.line > 0);
      assert.equal(typeof finding.location, 'string'); assert.equal(typeof finding.rule, 'string');
    }
  }
}
function unchanged(f, before, since = 0) {
  assert.deepEqual(f.snapshot(), before, 'refusal/error changed remote refs or uploaded objects');
  assert.deepEqual(f.calls().slice(since).filter(c => c.write), [], 'refusal/error attempted a gh write');
}

test('rewrite refuses when accepted history already contains the old PR head', t => {
  const f = fixture(t);
  f.put('expert/removed.md', SECRET);
  const old = f.commit(); f.open(old);
  f.git(f.repo, 'push', '-q', 'origin', `${old}:refs/heads/main`);
  fs.unlinkSync(join(f.repo, 'expert/removed.md')); f.git(f.repo, 'add', '-A');
  const before = f.snapshot();
  refusal(f.run('rewrite', old, {base: old}), 'E_HISTORY');
  unchanged(f, before);
});

test('create refuses an apostrophe in literal URL credentials before remote writes', t => {
  const f = fixture(t); f.put('expert/decision.md', "https://synthetic-user:synthetic'password@example.com/resource\n");
  const head = f.commit(), before = f.snapshot();
  refusal(f.run('create', head)); unchanged(f, before);
});

for (const mode of ['rename', 'empty-file-deletion']) test(`amend-legacy refuses ${mode} even with zero deleted lines`, t => {
  const f = fixture(t); f.put('expert/old-private-context.md', mode === 'rename' ? 'Synthetic context\n' : '');
  const head = f.commit(); f.open(head, {body: body(provenance(1))});
  fs.writeFileSync(f.bodyFile, body(provenance(1)));
  if (mode === 'rename') f.git(f.repo, 'mv', 'expert/old-private-context.md', 'expert/safe.md');
  else f.git(f.repo, 'rm', 'expert/old-private-context.md');
  const before = f.snapshot(); refusal(f.run('amend-legacy', head), 'E_LEGACY_REMOVAL'); unchanged(f, before);
});

// Content screening covers every introduced commit, not only the final tree.
test('clean create publishes the supplied OID, screened stdin body and fixed title', t => {
  const f = fixture(t), head = f.change(), out = success(f.run('create', head));
  assert.deepEqual(out, { ok: true, head, branch: BRANCH, url: `https://github.com/${GITHUB}/pull/${PR}`, status: 'created' });
  assert.equal(f.git(f.remote, 'rev-parse', REF), head); assert.equal(f.git(f.remote, 'rev-parse', 'main'), f.base);
  const calls = f.calls(); assert.deepEqual(calls.map(c => c.kind), ['label', 'create', 'view']);
  assert.equal(calls[1].input, fs.readFileSync(f.bodyFile, 'utf8'));
  assert.equal(calls[1].argv[calls[1].argv.indexOf('--body-file') + 1], '-');
});

test('an unsafe blob in an intermediate, subsequently deleted commit refuses before any publication', t => {
  const f = fixture(t); f.put('expert/removed-private-fixture.md', `${SECRET}\n`);
  const intermediate = f.commit(), blob = f.git(f.repo, 'rev-parse', `${intermediate}:expert/removed-private-fixture.md`);
  fs.unlinkSync(join(f.repo, 'expert/removed-private-fixture.md')); const head = f.commit('Remove synthetic value');
  assert.equal(f.git(f.repo, 'diff', '--stat', f.base, head), '', 'final tree is exactly clean');
  const before = f.snapshot(), r = f.run('create', head); refusal(r); unchanged(f, before);
  assert.ok(r.out.findings.some(x => x.location.includes(intermediate) && x.location.includes(blob)));
  assert.ok(!r.stdout.includes('removed-private-fixture.md'), 'locations are opaque, not sensitive filenames');
});

for (const location of ['blob', 'message', 'author', 'committer', 'filename', 'ref', 'body', 'source', 'harvester', 'evidence', 'task']) {
  test(`create refuses synthetic content in ${location} with no remote/gh writes`, t => {
    const f = fixture(t); let extra = {}, message = 'Synthetic proposal', id = [];
    f.put('expert/decision.md', '# Synthetic proposed decision\n');
    if (location === 'blob') f.put('expert/decision.md', `${SECRET}\n`);
    if (location === 'message') message += `\n\n${SECRET}\n`;
    if (location === 'author') id = ['-c', `author.email=${CONTACT}`];
    if (location === 'committer') id = ['-c', `committer.email=${CONTACT}`];
    if (location === 'filename') f.put(`expert/${SECRET}.md`, 'Synthetic decision\n');
    if (location === 'ref') extra.branch = `okf-harvest/${SECRET}`;
    if (location === 'body') fs.writeFileSync(f.bodyFile, body(provenance(), SECRET));
    if (['source', 'harvester', 'evidence', 'task'].includes(location)) {
      const p = provenance();
      if (location === 'source') p.source.instance = SECRET;
      if (location === 'harvester') p.harvester.alias = SECRET;
      if (location === 'evidence') p.evidence[0].note = `notes/${SECRET}.md`;
      if (location === 'task') p.tasks.refs = [SECRET];
      fs.writeFileSync(f.bodyFile, body(p));
    }
    const head = f.commit(message, id), before = f.snapshot();
    refusal(f.run('create', head, extra)); unchanged(f, before);
  });
}

test('screen CLI checks all separately supplied outward text files', t => {
  const f = fixture(t), head = f.change();
  const safe = f.artifact('safe.md', 'Synthetic safe summary\n'), unsafe = f.artifact('unsafe.md', `${SECRET}\n`), before = f.snapshot();
  const r = f.run('screen', head, { 'text-file': [safe, unsafe] }); refusal(r); unchanged(f, before);
  assert.ok(r.out.findings.some(x => x.location === 'outward file 2'));
});

for (const mode of ['binary', 'invalid-utf8', 'oversize', 'symlink', 'gitlink']) {
  test(`create fails closed for ${mode} before remote/gh writes`, t => {
    const f = fixture(t);
    if (mode === 'binary') f.put('expert/opaque.bin', Buffer.from([0x41, 0, 0x42]));
    if (mode === 'invalid-utf8') f.put('expert/opaque.bin', Buffer.from([0xc3, 0x28]));
    if (mode === 'oversize') f.put('expert/large.md', Buffer.alloc(4 * 1024 * 1024 + 1, 0x41));
    if (mode === 'symlink') fs.symlinkSync('decision.md', join(f.repo, 'expert/link.md'));
    if (mode === 'gitlink') {
      f.git(f.repo, 'init', '-q', '--initial-branch=main', 'vendor');
      f.git(join(f.repo, 'vendor'), ...IDENTITY, 'commit', '-q', '--allow-empty', '-m', 'Synthetic submodule');
    }
    const head = f.commit(), before = f.snapshot();
    // git add -A must not silently erase the staged gitlink in this fixture.
    if (mode === 'gitlink') assert.match(f.git(f.repo, 'ls-tree', head, 'vendor'), /^160000 commit /);
    refusal(f.run('create', head), ['symlink', 'gitlink'].includes(mode) ? 'E_TREE' : 'E_CONTENT_INPUT');
    unchanged(f, before);
  });
}

for (const history of ['shallow', 'replacement', 'grafts']) {
  test(`create refuses ${history} history rather than treating it as complete`, t => {
    const f = fixture(t), head = f.change();
    if (history === 'shallow') fs.writeFileSync(join(f.repo, '.git/shallow'), `${f.base}\n`);
    if (history === 'replacement') f.git(f.repo, 'replace', head, f.base);
    if (history === 'grafts') fs.writeFileSync(join(f.repo, '.git/info/grafts'), `${head} ${f.base}\n`);
    const before = f.snapshot(); refusal(f.run('create', head), 'E_HISTORY'); unchanged(f, before);
  });
}

for (const input of ['missing-body', 'symlink-body', 'hardlink-body', 'malformed-provenance', 'duplicate-provenance', 'wrong-remote', 'pushurl', 'url-rewrite', 'moved-base', 'invalid-github']) {
  test(`create preflight ${input} errors cannot write refs, objects or gh state`, t => {
    const f = fixture(t), head = f.change(); let extra = {}, code;
    if (input === 'missing-body') { fs.unlinkSync(f.bodyFile); code = 'E_CONTENT_INPUT'; }
    if (input === 'symlink-body') { fs.renameSync(f.bodyFile, `${f.bodyFile}.real`); fs.symlinkSync(`${f.bodyFile}.real`, f.bodyFile); code = 'E_CONTENT_INPUT'; }
    if (input === 'hardlink-body') { fs.linkSync(f.bodyFile, `${f.bodyFile}.link`); code = 'E_CONTENT_INPUT'; }
    if (input === 'malformed-provenance') { fs.writeFileSync(f.bodyFile, 'No provenance\n'); code = 'E_PROVENANCE'; }
    if (input === 'duplicate-provenance') { fs.writeFileSync(f.bodyFile, body() + body()); code = 'E_PROVENANCE'; }
    if (input === 'wrong-remote') { extra.remote = join(f.root, 'wrong.git'); code = 'E_REMOTE'; }
    if (input === 'pushurl') { f.git(f.repo, 'config', 'remote.origin.pushurl', f.remote); code = 'E_REMOTE'; }
    if (input === 'url-rewrite') { f.git(f.repo, 'config', `url.${f.remote}.insteadOf`, 'fixture-prefix'); code = 'E_REMOTE'; }
    if (input === 'moved-base') { f.publish(head, 'main'); code = 'E_BASE_MOVED'; }
    if (input === 'invalid-github') { extra.github = 'invalid-repository-shape'; code = 'E_GITHUB'; }
    const before = f.snapshot(); refusal(f.run('create', head, extra), code); unchanged(f, before);
  });
}

for (const collision of ['ancestor', 'identical', 'unrelated']) {
  test(`create-only lease refuses an already existing ${collision} destination`, t => {
    const f = fixture(t), head = f.change(); let existing = collision === 'ancestor' ? f.base : head;
    if (collision === 'unrelated') {
      f.git(f.repo, 'checkout', '-q', '--detach', f.base); f.put('expert/other.md', 'Another synthetic writer\n'); existing = f.commit('Other writer');
    }
    f.publish(existing); const before = f.snapshot();
    refusal(f.run('create', head), 'E_HEAD_MOVED'); unchanged(f, before);
    assert.equal(f.git(f.remote, 'rev-parse', REF), existing);
  });
}

for (const collision of ['different', 'identical']) {
  test(`create-only lease catches a ${collision} ref created at the real receive-pack boundary`, t => {
    const f = fixture(t), head = f.change(), existing = collision === 'identical' ? head : f.base;
    if (collision === 'identical') f.publish(head, 'object-storage');
    const before = f.snapshot(), ran = f.receiveHook({ ref: REF, oid: existing });
    const r = f.run('create', head); ran();
    refusal(r, collision === 'identical' ? 'E_CREATE_NOT_CONFIRMED' : 'E_PUSH_UNCERTAIN');
    assert.equal(f.git(f.remote, 'rev-parse', REF), existing);
    assert.deepEqual(f.snapshot().objects, before.objects, 'no candidate object upload on a stale/identical lease');
    assert.deepEqual(f.calls(), [], 'a non-new destination must never create a PR');
  });
}

test('an exact OID push stays pinned when local HEAD moves at the transport boundary', t => {
  const f = fixture(t), head = f.change();
  f.put('expert/unsafe.md', SECRET); const moved = f.commit(); f.git(f.repo, 'reset', '--soft', head);
  const ran = f.receiveHook({ where: f.repo, ref: 'HEAD', oid: moved });
  success(f.run('create', head)); ran();
  assert.equal(f.git(f.repo, 'rev-parse', 'HEAD'), moved);
  assert.equal(f.git(f.remote, 'rev-parse', REF), head);
  assert.ok(!f.git(f.remote, 'rev-list', '--all').split('\n').includes(moved));
});

test('create disables configured automatic tag publication', t => {
  const f = fixture(t), head = f.change();
  f.git(f.repo, 'config', 'push.followTags', 'true');
  f.git(f.repo, ...IDENTITY, 'tag', '-a', 'synthetic-private-tag', '-m', SECRET, head);
  success(f.run('create', head));
  assert.equal(f.rawGit(f.remote, ['show-ref', '--verify', '--quiet', 'refs/tags/synthetic-private-tag']).status, 1);
});

test('create pins the requested OID even when local HEAD has moved to unsafe content', t => {
  const f = fixture(t), head = f.change();
  f.put('expert/unsafe.md', `${SECRET}\n`); const moved = f.commit(); assert.notEqual(moved, head);
  success(f.run('create', head));
  assert.equal(f.git(f.remote, 'rev-parse', REF), head);
  assert.equal(f.git(f.repo, 'rev-parse', 'HEAD'), moved);
  assert.ok(!f.git(f.remote, 'rev-list', '--all').split('\n').includes(moved));
});

test('the screened PR body is immutable across a gh label boundary', t => {
  const f = fixture(t), head = f.change(), original = fs.readFileSync(f.bodyFile, 'utf8');
  f.patchGh({ hook: { event: 'label', action: 'file', path: f.bodyFile, text: body(provenance(), SECRET) } });
  success(f.run('create', head)); assert.notEqual(fs.readFileSync(f.bodyFile, 'utf8'), original);
  assert.equal(f.calls().find(c => c.kind === 'create').input, original);
});

function rewriteFixture(t, version = 2) {
  const f = fixture(t); f.put('expert/removed-private-fixture.md', `${SECRET}\n`);
  const old = f.commit('Original synthetic proposal'), blob = f.git(f.repo, 'rev-parse', `${old}:expert/removed-private-fixture.md`);
  f.open(old, { body: body(provenance(version), SECRET), title: SECRET });
  fs.unlinkSync(join(f.repo, 'expert/removed-private-fixture.md'));
  f.put('expert/decision.md', '# Sanitized synthetic decision\n'); f.git(f.repo, 'add', '-A');
  return { ...f, old, blob };
}

test('rewrite reparents one sanitized commit to base; removed blob is unreachable from the actual remote PR head', t => {
  const f = rewriteFixture(t), out = success(f.run('rewrite', f.old));
  assert.equal(out.status, 'rewritten-review-required'); assert.notEqual(out.head, f.old);
  assert.equal(f.git(f.remote, 'rev-parse', REF), out.head);
  assert.equal(f.git(f.remote, 'show', '-s', '--format=%P', REF), f.base, 'exactly one parent, the accepted base');
  assert.equal(f.git(f.remote, 'rev-list', '--count', REF, `^${f.base}`), '1');
  const reachable = f.git(f.remote, 'rev-list', '--objects', '--no-object-names', REF).split('\n');
  assert.ok(!reachable.includes(f.blob)); assert.ok(!reachable.includes(f.old));
  assert.equal(f.git(f.remote, 'show', `${REF}:expert/decision.md`), '# Sanitized synthetic decision');
  assert.equal(f.git(f.remote, 'show', '-s', '--format=%an <%ae>%n%cn <%ce>', REF), 'OKF harvest <okf@localhost>\nOKF harvest <okf@localhost>');
  assert.equal(f.git(f.remote, 'show', '-s', '--format=%B', REF), fs.readFileSync(f.commitFile, 'utf8').trim());
  assert.equal(f.git(f.repo, 'rev-parse', 'HEAD'), f.old, 'commit-tree does not silently advance the reviewed local HEAD');
  assert.deepEqual(f.calls().map(c => c.kind), ['view', 'view', 'edit', 'view'], 'rewrite confirms its new head but never comments a verdict or merges');
  assert.equal(f.calls()[2].input, fs.readFileSync(f.bodyFile, 'utf8'));
});

test('a rewritten new-head receipt invalidates the old verdict and requires a fresh exact-head review', t => {
  const f = rewriteFixture(t), oldVerdict = f.artifact('old-verdict.md', verdict(f.old));
  const out = success(f.run('rewrite', f.old)), before = f.snapshot(), since = f.calls().length;
  refusal(f.run('merge', out.head, { 'verdict-file': oldVerdict }), 'E_VERDICT'); unchanged(f, before, since);
  success(f.run('merge', out.head));
  const merged = f.calls().find(c => c.kind === 'merge'); assert.ok(merged.effect);
  assert.equal(merged.argv[merged.argv.indexOf('--match-head-commit') + 1], out.head);
});

test('v1 removal cannot rewrite away the legacy completion ancestry', t => {
  const f = rewriteFixture(t, 1), before = f.snapshot();
  refusal(f.run('rewrite', f.old), 'E_LEGACY_REMOVAL'); unchanged(f, before);
  assert.equal(f.git(f.remote, 'rev-parse', REF), f.old);
});

for (const surface of ['tree', 'body', 'commit']) {
  test(`rewrite screens the sanitized replacement ${surface} before any remote/gh write`, t => {
    const f = rewriteFixture(t);
    if (surface === 'tree') { f.put('expert/unsafe.md', SECRET); f.git(f.repo, 'add', '-A'); }
    if (surface === 'body') fs.writeFileSync(f.bodyFile, body(provenance(), SECRET));
    if (surface === 'commit') fs.writeFileSync(f.commitFile, SECRET);
    const before = f.snapshot(); refusal(f.run('rewrite', f.old)); unchanged(f, before);
  });
}

test('rewrite refuses if local HEAD no longer equals the reviewed old head', t => {
  const f = rewriteFixture(t); f.commit('Local writer advanced HEAD'); const before = f.snapshot();
  refusal(f.run('rewrite', f.old), 'E_HEAD_MOVED'); unchanged(f, before);
});

test('rewrite exact old-head guard refuses a remote writer racing the initial PR read', t => {
  const f = rewriteFixture(t);
  // Seed the competing object on another ref without touching the reviewed ref.
  const competitor = f.commit('Concurrent synthetic writer'); f.publish(competitor, 'other-writer');
  f.git(f.repo, 'reset', '--soft', f.old);
  f.patchGh({ hook: { event: 'view', action: 'remote-ref', ref: REF, oid: competitor } });
  refusal(f.run('rewrite', f.old), 'E_HEAD_MOVED');
  assert.equal(f.git(f.remote, 'rev-parse', REF), competitor);
  assert.deepEqual(f.calls().filter(c => c.write), []);
});

test('rewrite exact old-head lease protects a concurrent writer at receive-pack, after all preflight reads', t => {
  const f = rewriteFixture(t), competitor = f.commit('Concurrent synthetic writer');
  f.publish(competitor, 'other-writer'); f.git(f.repo, 'reset', '--soft', f.old);
  const before = f.snapshot(), ran = f.receiveHook({ ref: REF, oid: competitor });
  const r = f.run('rewrite', f.old); ran(); refusal(r, 'E_PUSH_UNCERTAIN');
  assert.equal(f.git(f.remote, 'rev-parse', REF), competitor);
  assert.deepEqual(f.snapshot().objects, before.objects, 'stale old-head lease must not upload the replacement');
  assert.deepEqual(f.calls().filter(c => c.write), []);
});

for (const command of ['merge', 'close', 'close-unsafe']) {
  for (const mismatch of ['head', 'decision', 'duplicate', 'unsafe-text']) {
    test(`${command} binds a single screened verdict to its exact head (${mismatch})`, t => {
      const f = fixture(t), head = f.change(); f.open(head);
      let text = verdict(head, command.startsWith('close') ? 'close' : 'merge');
      if (mismatch === 'head') text = verdict(f.base, command.startsWith('close') ? 'close' : 'merge');
      if (mismatch === 'decision') text = verdict(head, command.startsWith('close') ? 'merge' : 'close');
      if (mismatch === 'duplicate') text += text;
      if (mismatch === 'unsafe-text') text += `${SECRET}\n`;
      const file = f.artifact('bad-verdict.md', text), before = f.snapshot();
      refusal(f.run(command, head, { 'verdict-file': file }), mismatch === 'unsafe-text' ? 'E_CONTENT_REFUSED' : 'E_VERDICT');
      unchanged(f, before);
    });
  }
}

for (const surface of ['title', 'body', 'history']) {
  test(`merge refuses unsafe PR ${surface} before posting a verdict or merging`, t => {
    const f = fixture(t); if (surface === 'history') f.put('expert/unsafe.md', SECRET);
    const head = f.commit(); f.open(head, surface === 'history' ? {} : { [surface]: SECRET });
    const before = f.snapshot(); refusal(f.run('merge', head)); unchanged(f, before);
  });
}

test('merge explicitly controls squash subject/body instead of allowing gh-generated commit summaries', t => {
  const f = fixture(t), head = f.change(); f.open(head);
  success(f.run('merge', head));
  assert.deepEqual(f.calls().map(c => c.kind), ['view', 'view', 'comment', 'view', 'merge']);
  const merge = f.calls().at(-1);
  assert.equal(merge.argv[merge.argv.indexOf('--subject') + 1], 'OKF knowledge proposal');
  assert.equal(merge.input, `Reviewed OKF head: ${head}\n`);
  assert.equal(merge.argv[merge.argv.indexOf('--body-file') + 1], '-');
  assert.equal(merge.argv.includes('--delete-branch'), false);
  assert.equal(merge.argv.includes('--auto'), false);
  assert.equal(f.git(f.remote, 'rev-parse', REF), head, 'the fake does not purport to implement a hosted squash merge');
});

for (const boundary of ['comment', 'final-view']) {
  test(`merge refuses a concurrent new head at the ${boundary} boundary`, t => {
    const f = fixture(t), head = f.change(); f.open(head);
    f.put('expert/other.md', 'Other synthetic writer\n'); const competitor = f.commit(); f.publish(competitor, 'other-writer');
    f.patchGh({ hook: { event: boundary === 'comment' ? 'comment' : 'view', at: boundary === 'comment' ? 1 : 3, action: 'remote-ref', ref: REF, oid: competitor } });
    refusal(f.run('merge', head), boundary === 'comment' ? 'E_HEAD_MOVED' : 'E_GH');
    assert.equal(f.git(f.remote, 'rev-parse', REF), competitor);
    assert.deepEqual(f.calls().filter(c => c.kind === 'merge' && c.effect), [], 'never merge the unreviewed new head');
    if (boundary === 'final-view') {
      const attempt = f.calls().at(-1); assert.equal(attempt.kind, 'merge'); assert.equal(attempt.effect, false);
      assert.equal(attempt.argv[attempt.argv.indexOf('--match-head-commit') + 1], head);
    }
  });
}

function additionalRefs(f, head) {
  f.publish(head, 'okf-harvest/unrelated');
  f.git(f.remote, 'update-ref', 'refs/pull/17/head', head);
  f.git(f.remote, 'update-ref', 'refs/tags/fixture-tag', head);
  return ['refs/heads/main', 'refs/heads/okf-harvest/unrelated', 'refs/pull/17/head', 'refs/tags/fixture-tag'].map(ref => [ref, f.git(f.remote, 'rev-parse', ref)]);
}
for (const command of ['close', 'close-unsafe']) {
  test(`${command} uses only safe outward text and never deletes any other remote ref`, t => {
    const f = rewriteFixture(t), others = additionalRefs(f, f.old), before = f.snapshot();
    const out = success(f.run(command, f.old));
    assert.equal(out.status, command === 'close' ? 'closed' : 'closed-branch-deleted-pull-ref-remains');
    assert.deepEqual(f.calls().map(c => c.kind), ['view', 'comment', 'view', 'close', 'view']);
    const comment = f.calls().find(c => c.kind === 'comment'); assert.equal(comment.input, verdict(f.old, 'close'));
    assert.ok(!comment.input.includes(SECRET));
    for (const [ref, oid] of others) assert.equal(f.git(f.remote, 'rev-parse', ref), oid, `must leave ${ref} alone`);
    if (command === 'close') assert.deepEqual(f.snapshot(), before, 'ordinary close does not delete the source branch');
    else {
      assert.equal(f.rawGit(f.remote, ['show-ref', '--verify', '--quiet', REF]).status, 1);
      // Pull refs and existing storage are explicitly NOT claimed to be erased.
      assert.ok(f.git(f.remote, 'rev-list', '--objects', '--no-object-names', 'refs/pull/17/head').split('\n').includes(f.blob));
    }
  });
}

test('close-unsafe never deletes a writer that advanced the reviewed ref during gh close', t => {
  const f = fixture(t), head = f.change(); f.open(head);
  f.put('expert/other.md', 'Concurrent synthetic writer\n'); const competitor = f.commit(); f.publish(competitor, 'other-writer');
  const others = additionalRefs(f, head);
  f.patchGh({ hook: { event: 'close', action: 'remote-ref', ref: REF, oid: competitor } });
  refusal(f.run('close-unsafe', head), 'E_PR_UNCERTAIN');
  assert.equal(f.git(f.remote, 'rev-parse', REF), competitor);
  for (const [ref, oid] of others) assert.equal(f.git(f.remote, 'rev-parse', ref), oid);
});

test('close-unsafe exact deletion lease protects a concurrent writer at receive-pack', t => {
  const f = fixture(t), head = f.change(); f.open(head);
  f.put('expert/other.md', 'Concurrent synthetic writer\n'); const competitor = f.commit(); f.publish(competitor, 'other-writer');
  const others = additionalRefs(f, head), ran = f.receiveHook({ ref: REF, oid: competitor });
  const r = f.run('close-unsafe', head); ran(); refusal(r, 'E_DELETE_UNCERTAIN');
  assert.equal(f.git(f.remote, 'rev-parse', REF), competitor);
  for (const [ref, oid] of others) assert.equal(f.git(f.remote, 'rev-parse', ref), oid);
});

test('close-unsafe validates the remote before any outward write', t => {
  const f = fixture(t), head = f.change(); f.open(head); const before = f.snapshot();
  refusal(f.run('close-unsafe', head, { remote: join(f.root, 'wrong.git') }), 'E_REMOTE'); unchanged(f, before);
});

test('gh read errors expose no synthetic stderr and perform no writes', t => {
  const f = fixture(t), head = f.change(); f.open(head);
  f.patchGh({ fail: 'view', failureText: `Synthetic rejected response: ${SECRET} ${CONTACT}` });
  const before = f.snapshot(); refusal(f.run('merge', head), 'E_PR_READ'); unchanged(f, before);
});

function legacyFixture(t) {
  const f = fixture(t), old = f.change(), branch = 'okf/synthetic-legacy';
  f.open(old, { headRefName: branch, body: body(provenance(1)) });
  fs.writeFileSync(f.bodyFile, body(provenance(1)));
  return { ...f, old, legacyRef: `refs/heads/${branch}` };
}

for (const addition of ['new-file', 'appended-lines']) {
  test(`amend-legacy preserves the v1 parent head for ${addition}, with a new review-required receipt`, t => {
    const f = legacyFixture(t);
    if (addition === 'new-file') f.put('expert/addition.md', 'A synthetic addition\n');
    else fs.appendFileSync(join(f.repo, 'expert/decision.md'), 'A synthetic added line\n');
    f.git(f.repo, 'add', '-A');
    const out = success(f.run('amend-legacy', f.old));
    assert.equal(out.status, 'rewritten-review-required'); assert.notEqual(out.head, f.old);
    assert.equal(f.git(f.remote, 'rev-parse', f.legacyRef), out.head);
    assert.equal(f.git(f.remote, 'show', '-s', '--format=%P', out.head), f.old, 'one parent: the original v1 head, NOT the accepted base');
    assert.equal(f.rawGit(f.remote, ['merge-base', '--is-ancestor', f.old, out.head]).status, 0);
    assert.equal(f.git(f.remote, 'rev-list', '--count', out.head, `^${f.old}`), '1');
    assert.deepEqual(f.calls().map(c => c.kind), ['view', 'view', 'edit', 'view']);
    const before = f.snapshot(), since = f.calls().length;
    refusal(f.run('merge', out.head, { 'verdict-file': f.artifact('old-review.md', verdict(f.old)) }), 'E_VERDICT');
    unchanged(f, before, since);
  });
}

for (const deletion of ['file', 'line', 'replacement']) {
  test(`amend-legacy refuses a ${deletion} deletion without changing the legacy head`, t => {
    const f = legacyFixture(t);
    if (deletion === 'file') fs.unlinkSync(join(f.repo, 'expert/decision.md'));
    if (deletion === 'line') f.put('expert/decision.md', '');
    if (deletion === 'replacement') f.put('expert/decision.md', 'A different synthetic decision\n');
    f.git(f.repo, 'add', '-A'); const before = f.snapshot();
    refusal(f.run('amend-legacy', f.old), 'E_LEGACY_REMOVAL'); unchanged(f, before);
    assert.equal(f.git(f.remote, 'rev-parse', f.legacyRef), f.old);
  });
}

test('amend-legacy cannot bypass old unsafe content with a clean append-only change', t => {
  const f = fixture(t); f.put('expert/unsafe.md', SECRET); const old = f.commit();
  f.open(old, { headRefName: 'okf/synthetic-legacy', body: body(provenance(1)) });
  fs.writeFileSync(f.bodyFile, body(provenance(1)));
  f.put('expert/addition.md', 'Clean synthetic addition\n'); f.git(f.repo, 'add', '-A');
  const before = f.snapshot(); refusal(f.run('amend-legacy', old)); unchanged(f, before);
});

test('amend-legacy refuses a v2 source rather than silently using the legacy ancestry path', t => {
  const f = fixture(t), old = f.change(); f.open(old);
  f.put('expert/addition.md', 'Clean synthetic addition\n'); f.git(f.repo, 'add', '-A');
  const before = f.snapshot(); refusal(f.run('amend-legacy', old), 'E_LEGACY_REMOVAL'); unchanged(f, before);
});

test('amend-legacy requires the replacement PR body to retain v1 provenance', t => {
  const f = legacyFixture(t); fs.writeFileSync(f.bodyFile, body(provenance(2)));
  f.put('expert/addition.md', 'Clean synthetic addition\n'); f.git(f.repo, 'add', '-A');
  const before = f.snapshot(); refusal(f.run('amend-legacy', f.old), 'E_PROVENANCE'); unchanged(f, before);
});

test('close-unsafe can delete the exact reviewed legacy okf/ ref, without deleting other refs or pull refs', t => {
  const f = fixture(t); f.put('expert/unsafe.md', SECRET); const old = f.commit(), legacyRef = 'refs/heads/okf/synthetic-legacy';
  f.open(old, { headRefName: 'okf/synthetic-legacy', body: body(provenance(1), SECRET), title: SECRET });
  const others = additionalRefs(f, old), out = success(f.run('close-unsafe', old));
  assert.equal(out.status, 'closed-branch-deleted-pull-ref-remains');
  assert.equal(f.rawGit(f.remote, ['show-ref', '--verify', '--quiet', legacyRef]).status, 1);
  for (const [ref, oid] of others) assert.equal(f.git(f.remote, 'rev-parse', ref), oid);
  assert.deepEqual(f.calls().map(c => c.kind), ['view', 'comment', 'view', 'close', 'view']);
  assert.equal(f.calls().find(c => c.kind === 'comment').input, verdict(old, 'close'));
});

test('unchanged accepted non-KB binary, symlink and screened text do not block knowledge publication', t => {
  const f = fixture(t, { seed: ({ repo, put }) => {
    put('code/binary.bin', Buffer.from([0x41, 0, 0x42]));
    put('code/accepted-fixture.txt', SECRET);
    fs.symlinkSync('accepted-fixture.txt', join(repo, 'code/link'));
  } });
  const head = f.change(); success(f.run('screen-tree', head, { root: 'expert' }));
  success(f.run('create', head)); assert.equal(f.git(f.remote, 'rev-parse', REF), head);
  for (const path of ['code/binary.bin', 'code/accepted-fixture.txt', 'code/link']) {
    assert.equal(f.git(f.remote, 'rev-parse', `${head}:${path}`), f.git(f.remote, 'rev-parse', `${f.base}:${path}`));
  }
});

for (const change of ['new-path-same-blob', 'mode-only', 'changed-content']) {
  test(`accepted content is screened again for ${change}, not exempted by its old object identity`, t => {
    const f = fixture(t, { seed: ({ put }) => put('code/accepted-fixture.txt', `${SECRET}\n`) });
    const blob = f.git(f.repo, 'rev-parse', `${f.base}:code/accepted-fixture.txt`);
    if (change === 'new-path-same-blob') f.put('expert/reused.md', `${SECRET}\n`);
    if (change === 'mode-only') fs.chmodSync(join(f.repo, 'code/accepted-fixture.txt'), 0o755);
    if (change === 'changed-content') fs.appendFileSync(join(f.repo, 'code/accepted-fixture.txt'), 'Added synthetic text\n');
    const head = f.commit();
    if (change !== 'changed-content') {
      const path = change === 'new-path-same-blob' ? 'expert/reused.md' : 'code/accepted-fixture.txt';
      assert.equal(f.git(f.repo, 'rev-parse', `${head}:${path}`), blob);
      assert.ok(!f.git(f.repo, 'rev-list', '--objects', '--no-object-names', head, `^${f.base}`).split('\n').includes(blob), 'the blob really is accepted, not newly introduced');
    }
    if (change === 'mode-only') assert.match(f.git(f.repo, 'ls-tree', head, 'code/accepted-fixture.txt'), /^100755 blob /);
    const before = f.snapshot(); refusal(f.run('create', head)); unchanged(f, before);
  });
}

test('a changed inherited symlink is still unsupported rather than inheriting the base exemption', t => {
  const f = fixture(t, { seed: ({ repo, put }) => { put('code/source.txt', 'Synthetic source\n'); fs.symlinkSync('source.txt', join(repo, 'code/link')); } });
  fs.unlinkSync(join(f.repo, 'code/link')); fs.symlinkSync('../expert/decision.md', join(f.repo, 'code/link'));
  const head = f.commit(), before = f.snapshot(); refusal(f.run('create', head), 'E_TREE'); unchanged(f, before);
});

test('screen-tree screens the selected root, refuses traversal and exposes no filesystem values', t => {
  const f = fixture(t); f.put('other/unsafe.md', SECRET); const head = f.commit(), before = f.snapshot();
  success(f.run('screen-tree', head, { root: 'expert' }));
  refusal(f.run('screen-tree', head)); refusal(f.run('screen-tree', head, { root: '../expert' }), 'E_ROOT');
  unchanged(f, before);
});

// Empty subtrees cannot be staged by ordinary git add, but they are real Git
// objects and their names are transmitted even when ls-tree -r omits them.
for (const placement of ['leaf', 'ancestor']) {
  test(`create refuses a prohibited empty-tree ${placement} path built with real mktree/commit-tree`, t => {
    const f = fixture(t);
    const inputGit = (args, input) => {
      const r = f.rawGit(f.repo, args, { input });
      assert.equal(r.status, 0, r.stderr); return r.stdout.trim();
    };
    const empty = inputGit(['mktree'], '');
    const nested = placement === 'leaf'
      ? inputGit(['mktree'], `040000 tree ${empty}\t${SECRET}\n`)
      : inputGit(['mktree'], `040000 tree ${empty}\tclean-empty-leaf\n`);
    const name = placement === 'leaf' ? 'synthetic-empty-container' : `synthetic-${SECRET}`;
    const accepted = f.rawGit(f.repo, ['ls-tree', '-z', f.base]);
    assert.equal(accepted.status, 0, accepted.stderr);
    const tree = inputGit(['mktree', '-z'], `${accepted.stdout}040000 tree ${nested}\t${name}\0`);
    const head = inputGit([...IDENTITY, 'commit-tree', tree, '-p', f.base], 'Synthetic empty subtree proposal\n');
    assert.equal(f.git(f.repo, 'ls-tree', '-r', head), f.git(f.repo, 'ls-tree', '-r', f.base), 'recursive leaf-only listings really omit the new subtree');
    assert.ok(f.git(f.repo, 'ls-tree', '-r', '-t', head).includes(SECRET), 'the transmitted tree really contains the prohibited name');
    const before = f.snapshot(), r = f.run('create', head);
    refusal(r); unchanged(f, before);
    assert.ok(r.out.findings.some(x => x.location.includes(head) && x.location.includes('tree-entry')));
  });
}

function pushOptionObserver(f) {
  const log = join(f.root, 'received-push-options.jsonl');
  f.git(f.remote, 'config', 'receive.advertisePushOptions', 'true');
  fs.writeFileSync(join(f.remote, 'hooks/pre-receive'), `#!${process.execPath}
const fs = require('node:fs');
const count = process.env.GIT_PUSH_OPTION_COUNT;
const values = Object.entries(process.env).filter(([k]) => /^GIT_PUSH_OPTION_[0-9]+$/.test(k)).sort();
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ count, values, updates: fs.readFileSync(0, 'utf8').trim().split('\\n') }) + '\\n');
`, { mode: 0o755 });
  // Positive control: this exact local transport and server hook must first
  // observe configured bytes. An unexecuted hook is not evidence of suppression.
  f.git(f.repo, 'config', '--add', 'push.pushOption', SECRET);
  f.git(f.repo, 'config', '--add', 'push.pushOption', CONTACT);
  f.publish(f.base, 'push-option-control');
  const control = jsonLines(log);
  assert.equal(control.length, 1, 'real bare pre-receive hook must execute');
  assert.equal(control[0].count, '2');
  assert.deepEqual(control[0].values, [['GIT_PUSH_OPTION_0', SECRET], ['GIT_PUSH_OPTION_1', CONTACT]]);
  return reference => {
    const received = jsonLines(log);
    assert.equal(received.length, 2, 'the helper must perform exactly one observed push');
    assert.equal(received[1].count, '0', 'configured push.pushOption bytes must never reach receive-pack');
    assert.deepEqual(received[1].values, [], 'no numbered push option may be received');
    assert.equal(received[1].updates.length, 1);
    assert.equal(received[1].updates[0].split(' ')[2], reference);
  };
}

for (const command of ['create', 'rewrite', 'close-unsafe']) {
  test(`${command} disables configured push.pushOption bytes at a real bare receive hook`, t => {
    const f = command === 'create' ? fixture(t) : rewriteFixture(t);
    const head = command === 'create' ? f.change() : f.old;
    const observed = pushOptionObserver(f), out = success(f.run(command, head));
    observed(REF);
    if (command === 'close-unsafe') assert.equal(f.rawGit(f.remote, ['show-ref', '--verify', '--quiet', REF]).status, 1);
    else assert.equal(f.git(f.remote, 'rev-parse', REF), out.head);
  });
}

for (const command of ['commit', 'rewrite', 'amend-legacy']) {
  for (const override of ['author-config', 'committer-config', 'inherited-identities', 'inherited-config', 'all-overrides']) {
    test(`${command} fixes both commit identities despite ${override}`, t => {
      const f = command === 'commit' ? fixture(t) : command === 'rewrite' ? rewriteFixture(t) : legacyFixture(t);
      if (command === 'commit') f.git(f.repo, 'checkout', '-q', '-b', BRANCH, f.base);
      if (command !== 'rewrite') { f.put('expert/addition.md', 'Synthetic append-only addition\n'); f.git(f.repo, 'add', '-A'); }
      const author = ['Synthetic overridden author', 'synthetic-author@example.com'];
      const committer = ['Synthetic overridden committer', 'synthetic-committer@example.com'];
      if (override === 'author-config' || override === 'all-overrides') {
        f.git(f.repo, 'config', 'author.name', author[0]); f.git(f.repo, 'config', 'author.email', author[1]);
      }
      if (override === 'committer-config' || override === 'all-overrides') {
        f.git(f.repo, 'config', 'committer.name', committer[0]); f.git(f.repo, 'config', 'committer.email', committer[1]);
      }
      if (override === 'inherited-identities' || override === 'all-overrides') {
        Object.assign(f.env, { GIT_AUTHOR_NAME: author[0], GIT_AUTHOR_EMAIL: author[1], GIT_COMMITTER_NAME: committer[0], GIT_COMMITTER_EMAIL: committer[1], EMAIL: 'synthetic-fallback@example.com' });
      }
      if (override === 'inherited-config' || override === 'all-overrides') {
        const entries = [['author.name', author[0]], ['author.email', author[1]], ['committer.name', committer[0]], ['committer.email', committer[1]]];
        f.env.GIT_CONFIG_COUNT = String(entries.length);
        entries.forEach(([key, value], i) => { f.env[`GIT_CONFIG_KEY_${i}`] = key; f.env[`GIT_CONFIG_VALUE_${i}`] = value; });
        f.env.GIT_CONFIG_PARAMETERS = entries.map(([key, value]) => `'${key}=${value}'`).join(' ');
      }
      const before = f.snapshot(), out = success(f.run(command, command === 'commit' ? f.base : f.old));
      const reference = command === 'amend-legacy' ? f.legacyRef : REF, where = command === 'commit' ? f.repo : f.remote;
      assert.equal(out.status, command === 'commit' ? 'committed' : 'rewritten-review-required');
      assert.equal(f.git(where, 'rev-parse', reference), out.head);
      assert.equal(f.git(where, 'show', '-s', '--format=%an <%ae>%n%cn <%ce>', reference), 'OKF harvest <okf@localhost>\nOKF harvest <okf@localhost>', 'both identities must be fixed, not merely detector-acceptable');
      assert.equal(f.git(where, 'show', '-s', '--format=%P', reference), command === 'amend-legacy' ? f.old : f.base);
      if (command === 'commit') {
        unchanged(f, before);
        assert.equal(f.git(f.repo, 'rev-parse', 'HEAD'), out.head, 'local commit advances only the intended harvest branch');
        assert.equal(f.git(f.repo, 'rev-parse', 'refs/heads/main'), f.base);
        assert.equal(f.git(f.repo, 'show', `${out.head}:expert/addition.md`), 'Synthetic append-only addition');
      }
    });
  }
}

test('close-unsafe deletes only the exact reviewed already-unsafe legacy okf/token ref', t => {
  const f = fixture(t); f.put('expert/unsafe.md', SECRET);
  const head = f.commit(), branch = `okf/${SECRET}`, reference = `refs/heads/${branch}`;
  f.open(head, { headRefName: branch, body: body(provenance(1), SECRET), title: SECRET });
  const others = additionalRefs(f, head), before = f.snapshot(), r = f.run('close-unsafe', head), out = success(r);
  assert.equal(out.status, 'closed-branch-deleted-pull-ref-remains');
  assert.equal(f.rawGit(f.remote, ['show-ref', '--verify', '--quiet', reference]).status, 1);
  assert.deepEqual(f.snapshot().objects, before.objects, 'cleanup does not upload objects or claim to purge storage');
  for (const [ref, id] of others) assert.equal(f.git(f.remote, 'rev-parse', ref), id);
  assert.deepEqual(f.calls().filter(c => c.write).map(c => c.kind), ['comment', 'close']);
  assert.equal(f.calls().find(c => c.kind === 'comment').input, verdict(head, 'close'));
  assert.ok(!r.stdout.includes(SECRET), 'the unsafe legacy name must not be echoed in a cleanup receipt');
});

for (const command of ['create', 'rewrite', 'amend-legacy', 'merge']) {
  test(`${command} still refuses publication through an already-unsafe legacy okf/token ref`, t => {
    const f = fixture(t), head = f.change(), branch = `okf/${SECRET}`;
    const version = command === 'rewrite' ? 2 : 1;
    if (command !== 'create') f.open(head, { headRefName: branch, body: body(provenance(version)) });
    if (command === 'rewrite' || command === 'amend-legacy') {
      fs.writeFileSync(f.bodyFile, body(provenance(version)));
      f.put('expert/addition.md', 'Synthetic safe addition\n'); f.git(f.repo, 'add', '-A');
    }
    const before = f.snapshot();
    refusal(f.run(command, head, command === 'create' ? { branch } : {}), command === 'create' ? 'E_BRANCH' : 'E_CONTENT_REFUSED');
    unchanged(f, before);
  });
}

test('close-unsafe still leases an already-unsafe legacy okf/token cleanup target', t => {
  const f = fixture(t), head = f.change(), branch = `okf/${SECRET}`, reference = `refs/heads/${branch}`;
  f.open(head, { headRefName: branch, body: body(provenance(1)) });
  f.put('expert/other.md', 'Synthetic concurrent writer\n'); const competitor = f.commit(); f.publish(competitor, 'other-writer');
  const others = additionalRefs(f, head), ran = f.receiveHook({ ref: reference, oid: competitor });
  const r = f.run('close-unsafe', head); ran(); refusal(r, 'E_DELETE_UNCERTAIN');
  assert.equal(f.git(f.remote, 'rev-parse', reference), competitor);
  for (const [ref, id] of others) assert.equal(f.git(f.remote, 'rev-parse', ref), id);
});

function concurrentHead(f) {
  f.put('expert/concurrent.md', 'Synthetic concurrent decision\n');
  const competitor = f.commit('Synthetic concurrent writer');
  f.publish(competitor, 'other-writer'); return competitor;
}
function hookRan(f) {
  assert.equal(JSON.parse(fs.readFileSync(f.env.FIXTURE_GH_STATE, 'utf8')).hook.done, true, 'the intended race boundary must execute');
}
function readAfterMutation(f, kind) {
  const calls = f.calls(), at = calls.findIndex(c => c.kind === kind && c.effect);
  assert.ok(at >= 0, `${kind} must actually take effect in this race`);
  assert.ok(calls.slice(at + 1).some(c => c.kind === 'view'), `gh PR state/head must be read back after ${kind}`);
}

test('create reports E_PR_UNCERTAIN and stops after the branch moves at the gh label boundary', t => {
  const f = fixture(t), head = f.change(), competitor = concurrentHead(f);
  f.patchGh({ hook: { event: 'label', action: 'remote-ref', ref: REF, oid: competitor } });
  const r = f.run('create', head); hookRan(f);
  assert.equal(f.git(f.remote, 'rev-parse', REF), competitor);
  assert.ok(f.calls().some(c => c.kind === 'label' && c.effect), 'push and label may already have happened');
  assert.deepEqual(f.calls().filter(c => c.kind === 'create'), [], 'a detected label-boundary move must stop before PR creation');
  refusal(r, 'E_PR_UNCERTAIN');
});

for (const boundary of ['before-create', 'create']) {
  test(`create reports E_PR_UNCERTAIN for a branch move at the gh ${boundary} boundary after a PR write`, t => {
    const f = fixture(t), head = f.change(), competitor = concurrentHead(f);
    f.patchGh({ hook: { event: boundary, action: 'remote-ref', ref: REF, oid: competitor } });
    const r = f.run('create', head); hookRan(f); refusal(r, 'E_PR_UNCERTAIN');
    assert.equal(f.git(f.remote, 'rev-parse', REF), competitor);
    readAfterMutation(f, 'create');
    assert.equal(JSON.parse(fs.readFileSync(f.env.FIXTURE_GH_STATE, 'utf8')).state, 'OPEN', 'uncertainty must not pretend the PR write was rolled back');
  });
}

for (const command of ['close', 'close-unsafe']) {
  for (const boundary of ['final-view', 'before-close', 'close']) {
    test(`${command} reports E_PR_UNCERTAIN for a branch move at the gh ${boundary} boundary`, t => {
      const f = fixture(t), head = f.change(); f.open(head);
      const competitor = concurrentHead(f), others = additionalRefs(f, head);
      f.patchGh({ hook: { event: boundary === 'final-view' ? 'view' : boundary, at: boundary === 'final-view' ? 2 : 1, action: 'remote-ref', ref: REF, oid: competitor } });
      const r = f.run(command, head); hookRan(f); refusal(r, 'E_PR_UNCERTAIN');
      assert.equal(f.git(f.remote, 'rev-parse', REF), competitor, 'the unreviewed new head must not be deleted');
      for (const [ref, id] of others) assert.equal(f.git(f.remote, 'rev-parse', ref), id);
      assert.ok(f.calls().some(c => c.kind === 'comment' && c.effect), 'an earlier exact-head verdict may already have been written');
      // A final-view race can be noticed before close, or only after close.
      // Neither native gh close nor this fake has a --match-head-commit flag.
      if (boundary !== 'final-view' || f.calls().some(c => c.kind === 'close' && c.effect)) {
        readAfterMutation(f, 'close');
        assert.equal(JSON.parse(fs.readFileSync(f.env.FIXTURE_GH_STATE, 'utf8')).state, 'CLOSED');
      }
    });
  }
}

for (const command of ['create', 'close', 'close-unsafe']) {
  for (const mismatch of ['state', 'head', 'read-error']) {
    test(`${command} reports E_PR_UNCERTAIN when post-write PR readback has ${mismatch}`, t => {
      const f = fixture(t), head = f.change();
      if (command !== 'create') f.open(head);
      const kind = command === 'create' ? 'create' : 'close';
      const patch = mismatch === 'state' ? { state: command === 'create' ? 'CLOSED' : 'OPEN' }
        : mismatch === 'head' ? { overrideHead: f.base }
          : { fail: 'view', failureText: `Synthetic readback failure ${SECRET} ${CONTACT}` };
      f.patchGh({ hook: { event: kind, action: 'gh-state', patch } });
      const r = f.run(command, head); hookRan(f); refusal(r, 'E_PR_UNCERTAIN');
      readAfterMutation(f, kind);
      assert.equal(f.git(f.remote, 'rev-parse', REF), head, 'uncertain PR confirmation must not permit destructive branch cleanup');
    });
  }
}
