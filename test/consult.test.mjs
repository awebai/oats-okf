import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { tmpdir, hostname } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync, spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const CAP = join(ROOT, 'oats-package/capabilities/oats-okf');
const CLI = join(CAP, 'bin/oats-okf.mjs');
const mod = p => import(new URL(`../oats-package/capabilities/oats-okf/lib/${p}.mjs`, import.meta.url));
const { loadBindings } = await mod('config');
const { save, readJSON } = await mod('io');
const { register, homeSource } = await mod('sources');
const { initBase } = await mod('migration');
const { resolveBasePath, withBase, cat: catCmd, frontmatter, markdownLinks } = await mod('consult');
const { baseLock, journalPath } = await mod('stores');

const put = (p, text) => { fs.mkdirSync(dirname(p), { recursive: true }); fs.writeFileSync(p, text); };
const git = (cwd, args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const commit = (repo, message) => { git(repo, ['add', '-A']); git(repo, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', message]); };
const concept = (type, title, description, body) => `---\ntype: ${type}\ntitle: ${title}\ndescription: ${description}\n---\n\n${body}\n`;
const hostPath = process.env.PATH;

function seed(root) {
  put(join(root, 'expert/index.md'), '# expert\n\n* [Retry policy](decisions/retry-policy.md) - Why retries back off.\n* [Retry storm](lessons/storm.md) - A fixed delay caused a storm.\n');
  put(join(root, 'expert/decisions/retry-policy.md'), concept('Decision', 'Retry policy', 'Why retries back off.', 'Exponential backoff with jitter replaced the fixed delay.\nSee [the storm](../lessons/storm.md), the [peer index](/peer/index.md) and [docs](https://example.invalid/retry).'));
  put(join(root, 'expert/lessons/storm.md'), concept('Lesson', 'Retry storm', 'A fixed delay caused a storm.', 'A fixed retry delay synchronized every client into a storm.'));
}
/** A registered source whose one base is a real Git remote (bare, filtering
 *  allowed) or an in-place directory. Kernel calls go to a fake oats. */
function fixture(t, { kind = 'git', settings = {} } = {}) {
  const dir = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'okf-consult-'))); const old = { ...process.env };
  t.after(() => { for (const k of Object.keys(process.env)) delete process.env[k]; Object.assign(process.env, old); fs.rmSync(dir, { recursive: true, force: true }); });
  for (const k of Object.keys(process.env)) delete process.env[k];
  Object.assign(process.env, { HOME: join(dir, 'user'), PATH: `${join(dir, 'bin')}:${hostPath}`, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', FIXTURE_ROOT: dir });
  fs.mkdirSync(process.env.HOME); fs.mkdirSync(join(dir, 'bin'));
  const fake = join(dir, 'bin', 'oats-fake.mjs');
  put(fake, `#!${process.execPath}
import * as fs from 'node:fs';import {join} from 'node:path';
const a=process.argv.slice(2),root=process.env.FIXTURE_ROOT,out=result=>console.log(JSON.stringify({schemaVersion:1,ok:true,result}));
fs.appendFileSync(join(root,'calls.jsonl'),JSON.stringify(a)+'\\n');
if(a[0]==='schedule') {const p=join(root,'schedules.json'),jobs=fs.existsSync(p)?JSON.parse(fs.readFileSync(p,'utf8')):{};
  if(a[1]==='add') {if(jobs[a[2]]) {console.log(JSON.stringify({schemaVersion:1,ok:false,error:{code:'E_SCHEDULE_EXISTS',message:'exists'}}));process.exit(1);}jobs[a[2]]=JSON.parse(fs.readFileSync(a[a.indexOf('--file')+1],'utf8'));fs.writeFileSync(p,JSON.stringify(jobs));out({schedule:jobs[a[2]]});}
  else if(a[1]==='show') out({schedule:jobs[a[2]]});
  else out({schedules:Object.values(jobs),scheduler:{installed:false,active:false}});}
else {console.error('unexpected fixture call '+JSON.stringify(a));process.exit(90);}
`); fs.chmodSync(fake, 0o755); process.env.OATS_CLI_BIN = fake;
  const nodesFile = join(dir, 'nodes.json'); save(nodesFile, { expert: { path: 'expert', owner: 'owner-1' }, peer: { path: 'peer', owner: 'owner-2' } });
  const work = join(dir, 'work-repo'), remote = join(dir, 'remote.git');
  const base = kind === 'git' ? { id: 'base-1', kind, repository: remote, root: 'knowledge', acceptedBranch: 'main', pr: { repository: 'fixture/knowledge' } } : { id: 'base-1', kind, path: 'base' };
  const bindingFile = join(dir, 'bindings.json'); save(bindingFile, { version: 1, stateDir: 'state', bases: { project: base } });
  process.env.OATS_SETTINGS = JSON.stringify({ 'bindings-file': bindingFile, ...settings });
  const bindings = loadBindings();
  if (kind === 'git') {
    fs.mkdirSync(work); git(work, ['init', '-q', '--initial-branch=main']);
    initBase(bindings, 'project', nodesFile, join(dir, 'seed')); fs.cpSync(join(dir, 'seed'), join(work, 'knowledge'), { recursive: true });
    seed(join(work, 'knowledge')); put(join(work, 'code.txt'), 'not knowledge: backoff\n'); commit(work, 'baseline');
    git(dir, ['clone', '-q', '--bare', work, remote]); git(remote, ['config', 'uploadpack.allowFilter', 'true']);
    git(work, ['remote', 'add', 'origin', remote]);
  } else { initBase(bindings, 'project', nodesFile, undefined, { confirm: true }); seed(bindings.bases.project.path); }
  const context = join(dir, 'context'), home = join(context, 'home'), soul = join(context, 'soul');
  fs.mkdirSync(join(home, 'work'), { recursive: true }); fs.mkdirSync(soul);
  put(join(soul, 'AGENTS.md'), '# Expert\n'); save(join(soul, 'okf.json'), { version: 1, owner: 'owner-1', owns: ['project/expert'], reads: ['project/peer'] });
  save(join(home, 'instance.json'), { instance: 'source-one', agent: 'source', repo: context, work: 'directory', launched: true });
  Object.assign(process.env, { OATS_HOME: home, OATS_INSTANCE_HOME: home, OATS_INSTANCE: 'source-one', OATS_AGENT: 'source', OATS_SOUL: soul, OATS_CONTEXT: context });
  const cli = (cmd, args = [], env = {}) => {
    const r = spawnSync(process.execPath, [CLI, cmd, ...args], { cwd: home, env: { ...process.env, ...env }, encoding: 'utf8', timeout: 60000, maxBuffer: 16 * 1024 * 1024 });
    let out; try { out = JSON.parse(r.stdout); } catch { /* text mode */ } return { ...r, out };
  };
  const json = (cmd, args = [], env = {}) => { const r = cli(cmd, [...args, '--json'], env); assert.ok(r.out, `${cmd}: ${r.stdout}${r.stderr}`); return r.out; };
  const push = (files, message = 'update') => { for (const [p, text] of Object.entries(files)) text === null ? fs.rmSync(join(work, 'knowledge', p)) : put(join(work, 'knowledge', p), text); commit(work, message); git(work, ['push', '-q', 'origin', 'main']); return git(work, ['rev-parse', 'HEAD']); };
  const cache = join(bindings.stateDir, 'cache', 'base-1.git');
  const missing = () => new Set(spawnSync('git', ['-C', cache, 'rev-list', '--objects', '--missing=print', '--all'], { encoding: 'utf8' }).stdout.split('\n').filter(l => l.startsWith('?')).map(l => l.slice(1)));
  const blob = p => git(work, ['rev-parse', `HEAD:knowledge/${p}`]);
  return { dir, home, soul, bindings, base: bindings.bases.project, work, remote, cache, cli, json, push, missing, blob, context };
}
const registered = (t, opts) => { const f = fixture(t, opts); const s = register(f.home); return { ...f, s }; };

test('resolveBasePath: OKF link semantics and strict confinement', () => {
  assert.equal(resolveBasePath('/expert/x.md'), 'expert/x.md');
  assert.equal(resolveBasePath('expert/x.md'), 'expert/x.md', 'bare paths resolve from the root');
  assert.equal(resolveBasePath('../lessons/s.md', { from: 'expert/decisions/r.md' }), 'expert/lessons/s.md');
  assert.equal(resolveBasePath('s.md', { from: 'expert/decisions/r.md' }), 'expert/decisions/s.md');
  assert.equal(resolveBasePath('/peer/index.md', { from: 'expert/decisions/r.md' }), 'peer/index.md', 'absolute ignores --from');
  assert.equal(resolveBasePath('./a%20b.md#section', { from: 'expert/r.md' }), 'expert/a b.md');
  assert.equal(resolveBasePath('/'), '');
  for (const [input, from, pattern] of [
    ['../x.md', null, /escapes the base root/], ['/../x.md', null, /escapes/], ['expert/../../x.md', null, /escapes/],
    ['../../../x.md', 'expert/decisions/r.md', /escapes/], ['%2e%2e/x.md', null, /escapes/], ['..%2fx.md', null, /escapes/], ['..%2f..%2fx.md', 'expert/r.md', /escapes/],
    ['.git/config', null, /hidden/], ['expert/.hidden.md', null, /hidden/], ['a\\b.md', null, /not a base path/], ['a\0b.md', null, /not a base path/],
    ['https://example.invalid/x.md', null, /URL/], ['file:///etc/passwd', null, /URL/], ['//host/x.md', null, /URL/], ['', null, /required/],
  ]) assert.throws(() => resolveBasePath(input, { from }), pattern, `${JSON.stringify(input)} from ${from}`);
  assert.throws(() => resolveBasePath('/Users/someone/base/expert/x.md', { fsRoots: ['/Users/someone/base'] }), /filesystem path/);
  assert.equal(resolveBasePath('/expert/x.md', { fsRoots: ['/Users/someone/base'] }), 'expert/x.md');
});

test('frontmatter and link extraction are bounded to real Markdown links', () => {
  assert.deepEqual(frontmatter('---\ntype: Lesson\ntitle: "Quoted"\ndescription: One.\ntags: [a]\n---\nbody'), { type: 'Lesson', title: 'Quoted', description: 'One.' });
  assert.equal(frontmatter('# no frontmatter'), null);
  assert.deepEqual(markdownLinks('[a](x.md) `[code](no.md)`\n```\n[fenced](no.md)\n```\n![img](i.md "t")\n[ref]: /r.md\n[a](x.md)').map(l => l.target), ['x.md', 'i.md', '/r.md']);
});

test('Git base: spawn keeps no local copy; the brief names the CLI; inspect has receipts', t => {
  const f = fixture(t); put(join(f.home, 'knowledge/stale.md'), 'okf 2.x snapshot');
  const r = f.cli('spawn', [], { OATS_EVENT: 'spawn' }); assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.out.meta.memory, 'okf-v2', 'the working-memory protocol is unchanged');
  assert.match(r.out.brief, /oats okf index/); assert.match(r.out.brief, /owns: project\/expert; reads: project\/peer/); assert.doesNotMatch(r.out.brief, /\.\/knowledge/);
  assert.deepEqual(fs.readdirSync(f.home).filter(n => n.startsWith('.okf-view-')), []);
  assert.equal(fs.readFileSync(join(f.home, 'knowledge/stale.md'), 'utf8'), 'okf 2.x snapshot', 'a 2.x ./knowledge/ is left alone');
  const s = homeSource(f.home), head = git(f.work, ['rev-parse', 'HEAD']);
  assert.equal(s.acceptedView.project.commit, head); assert.ok(s.acceptedView.project.digest); assert.deepEqual(Object.keys(s.acceptedView.project.nodes), ['expert', 'peer']);
  assert.deepEqual(s.acceptedNodes.project.expert, { path: 'expert', owner: 'owner-1' });
  const inspected = f.json('inspect').result;
  assert.deepEqual(inspected.acceptedView, s.acceptedView);
  assert.equal(inspected.legacyLocalView.status, 'legacy-local-view'); assert.match(inspected.summary, /legacy-local-view/);
  fs.rmSync(join(f.home, 'knowledge'), { recursive: true });
  assert.equal(f.json('inspect').result.legacyLocalView, null);
  // The only copy is the host cache: one bare repository under the state dir.
  assert.equal(git(f.cache, ['rev-parse', '--is-bare-repository']), 'true');
  assert.deepEqual(fs.readdirSync(join(f.bindings.stateDir, 'cache')).sort(), ['base-1.git']);
});

test('Git base: every command answers from the accepted commit with a receipt', t => {
  const f = registered(t), head = git(f.work, ['rev-parse', 'HEAD']);
  const bases = f.json('bases').result.bases;
  assert.equal(bases.length, 1); assert.equal(bases[0].commit, head); assert.deepEqual(bases[0].validated, { ok: true });
  assert.deepEqual(bases[0].owns, ['expert']); assert.deepEqual(bases[0].reads, ['peer']); assert.equal(bases[0].stale, false);
  const all = f.json('index').result.indexes;
  assert.deepEqual(all.map(x => [x.base, x.node, x.relation, x.path]), [['project', 'expert', 'owns', 'expert/index.md'], ['project', 'peer', 'reads', 'peer/index.md']]);
  assert.match(all[0].text, /Retry policy/); assert.equal(all[0].receipt.commit, head);
  const text = f.cli('index'); assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /^## project\/expert \(owns\)/m); assert.match(text.stdout, /^## project\/peer \(reads\)/m);
  assert.match(text.stdout.trimEnd().split('\n').at(-1), new RegExp(`^— project@${head.slice(0, 12)} \\(fetched `));
  assert.equal(f.json('index', ['expert']).result.indexes[0].path, 'expert/index.md');
  assert.equal(f.json('index', ['project/peer']).result.indexes[0].path, 'peer/index.md');
  assert.match(f.json('index', ['--base', 'project']).result.indexes[0].text, /Knowledge base/);
  const policy = f.json('cat', ['--base', 'project', '/expert/decisions/retry-policy.md']).result;
  assert.equal(policy.path, 'expert/decisions/retry-policy.md'); assert.match(policy.text, /Exponential backoff/);
  assert.deepEqual(policy.receipt, { base: 'project', id: 'base-1', kind: 'git', commit: head, fetchedAt: policy.receipt.fetchedAt, stale: false });
  assert.equal(f.json('cat', ['--base', 'project', '../lessons/storm.md', '--from', '/expert/decisions/retry-policy.md']).result.path, 'expert/lessons/storm.md');
  assert.equal(f.json('cat', ['--base', 'project', 'expert/lessons/storm.md']).result.path, 'expert/lessons/storm.md');
  const listing = f.json('ls', ['--base', 'project', '/expert']).result.entries;
  assert.deepEqual(listing.map(e => [e.name, e.kind]), [['decisions', 'dir'], ['lessons', 'dir'], ['index.md', 'file'], ['log.md', 'file']]);
  const lessons = f.json('ls', ['--base', 'project', 'expert/lessons']).result.entries;
  assert.deepEqual(lessons, [{ name: 'storm.md', path: 'expert/lessons/storm.md', kind: 'file', type: 'Lesson', title: 'Retry storm', description: 'A fixed delay caused a storm.' }]);
  assert.deepEqual(f.json('ls', ['--base', 'project']).result.entries.map(e => e.name), ['expert', 'peer', 'index.md', 'log.md', 'okf-base.json'], 'root listing never leaves knowledge/');
  const out = f.json('links', ['--base', 'project', '/expert/decisions/retry-policy.md']).result.links;
  assert.deepEqual(out.map(l => [l.target, l.path, l.exists, !!l.external]), [['../lessons/storm.md', 'expert/lessons/storm.md', true, false], ['/peer/index.md', 'peer/index.md', true, false], ['https://example.invalid/retry', undefined, undefined, true]]);
  const found = f.json('search', ['BACKOFF']).result;
  assert.deepEqual(found.hits, [{ base: 'project', path: 'expert/decisions/retry-policy.md', line: 7, snippet: 'Exponential backoff with jitter replaced the fixed delay.' }], 'case-insensitive, knowledge only (code.txt excluded)');
  assert.equal(found.receipts.project.commit, head);
  assert.equal(f.json('search', ['--node', 'peer', 'backoff']).result.total, 0);
  assert.equal(f.json('search', ['--all', '"path"']).result.total, 0, 'only Markdown is searched: okf-base.json is not');
  assert.equal(f.json('search', ['--regex', 'fixed (retry )?delay']).result.total, 4);
  assert.equal(f.json('search', ['--case-sensitive', 'BACKOFF']).result.total, 0);
  const none = f.cli('search', ['no-such-phrase-anywhere']); assert.equal(none.status, 0); assert.match(none.stdout, /no matches/);
});

test('Git base: a blob is fetched lazily on first read, then served from the host cache', t => {
  const f = registered(t);
  const head = f.push({ 'expert/lessons/late.md': concept('Lesson', 'Late', 'Arrives after registration.', 'A lazily fetched lesson body.'), 'expert/index.md': '# expert\n\n* [Late](lessons/late.md) - Arrives after registration.\n* [Retry policy](decisions/retry-policy.md) - Why retries back off.\n* [Retry storm](lessons/storm.md) - A fixed delay caused a storm.\n' });
  const oid = f.blob('expert/lessons/late.md');
  assert.equal(f.json('index', ['expert', '--fresh']).result.indexes[0].receipt.commit, head, '--fresh fetched the accepted branch');
  assert.ok(f.missing().has(oid), 'the fetch brought commits and trees, not the new blob');
  const late = f.json('cat', ['--base', 'project', '/expert/lessons/late.md']).result;
  assert.match(late.text, /lazily fetched lesson/); assert.equal(late.receipt.commit, head);
  assert.equal(f.missing().has(oid), false, 'present after the first read');
  assert.equal(git(f.cache, ['cat-file', '-t', oid]), 'blob');
});

test('Git base: freshness honours consult-max-age and --fresh; only the accepted branch is served', t => {
  const f = registered(t, { settings: { 'consult-max-age': 3600 } }), first = git(f.work, ['rev-parse', 'HEAD']);
  git(f.work, ['checkout', '-qb', 'unaccepted']); put(join(f.work, 'knowledge/expert/lessons/storm.md'), concept('Lesson', 'Retry storm', 'X.', 'UNACCEPTED text')); commit(f.work, 'side'); git(f.work, ['push', '-q', 'origin', 'unaccepted']); git(f.work, ['checkout', '-q', 'main']);
  const second = f.push({ 'expert/lessons/storm.md': concept('Lesson', 'Retry storm', 'A fixed delay caused a storm.', 'Revised: jitter fixed the storm.') });
  let r = f.json('cat', ['--base', 'project', '/expert/lessons/storm.md']).result;
  assert.equal(r.receipt.commit, first, 'within max-age the cached accepted commit is served'); assert.doesNotMatch(r.text, /Revised/);
  r = f.json('cat', ['--base', 'project', '/expert/lessons/storm.md', '--fresh']).result;
  assert.equal(r.receipt.commit, second); assert.match(r.text, /Revised/); assert.doesNotMatch(r.text, /UNACCEPTED/);
  assert.equal(git(f.cache, ['for-each-ref', '--format=%(refname)']), 'refs/heads/main', 'no other ref is fetched or selectable');
  const third = f.push({ 'expert/lessons/storm.md': concept('Lesson', 'Retry storm', 'A fixed delay caused a storm.', 'Third revision.') });
  assert.equal(f.json('cat', ['--base', 'project', '/expert/lessons/storm.md'], { OATS_SETTINGS: JSON.stringify({ 'bindings-file': f.bindings.file, 'consult-max-age': 0 }) }).result.receipt.commit, third, 'max-age 0 fetches on every read');
  assert.equal(f.cli('cat', ['--base', 'project', '/expert/lessons/storm.md', '--json'], { OATS_SETTINGS: JSON.stringify({ 'bindings-file': f.bindings.file, 'consult-max-age': -1 }) }).out.error.code, 'E_CONFIG');
});

test('Git base: a failed fetch serves the cached accepted commit as stale; no cache offline is a typed error', t => {
  const f = registered(t), head = git(f.work, ['rev-parse', 'HEAD']);
  fs.renameSync(f.remote, `${f.remote}.offline`);
  const r = f.json('cat', ['--base', 'project', '/expert/index.md', '--fresh']).result;
  assert.equal(r.receipt.commit, head); assert.equal(r.receipt.stale, true); assert.match(r.receipt.reason, /fetch of the accepted branch failed at .* \(reason: [a-z-]+\); serving the last fetched accepted commit/);
  const text = f.cli('index', ['expert']); assert.equal(text.status, 0); assert.match(text.stdout, /STALE: fetch of the accepted branch failed/);
  assert.equal(f.json('bases').result.bases[0].stale, true, 'stale until a later fetch succeeds');
  fs.renameSync(`${f.remote}.offline`, f.remote);
  assert.equal(f.json('bases', ['--fresh']).result.bases[0].stale, false);
  fs.renameSync(f.remote, `${f.remote}.offline`); fs.rmSync(join(f.bindings.stateDir, 'cache'), { recursive: true });
  const cold = f.cli('cat', ['--base', 'project', '/expert/index.md', '--json']);
  assert.equal(cold.status, 1); assert.equal(cold.out.error.code, 'E_BASE_UNAVAILABLE'); assert.match(cold.out.error.message, /repository .* is required .* clone failed/);
  const plain = f.cli('cat', ['--base', 'project', '/expert/index.md']); assert.equal(plain.stdout, ''); assert.match(plain.stderr, /^oats okf cat: E_BASE_UNAVAILABLE: /);
});

test('Git base: two parallel cats on a cold cache serialize on the lock and both succeed', async t => {
  const f = registered(t), head = git(f.work, ['rev-parse', 'HEAD']);
  fs.rmSync(join(f.bindings.stateDir, 'cache'), { recursive: true });
  const run = () => new Promise((done, reject) => {
    const child = spawn(process.execPath, [CLI, 'cat', '--base', 'project', '/expert/lessons/storm.md', '--json'], { cwd: f.home, env: process.env });
    let out = ''; child.stdout.on('data', d => { out += d; }); child.on('error', reject); child.on('close', code => done({ code, out }));
  });
  const results = await Promise.all([run(), run(), run()]);
  for (const r of results) { assert.equal(r.code, 0, r.out); const o = JSON.parse(r.out); assert.equal(o.result.receipt.commit, head); assert.match(o.result.text, /synchronized every client/); }
  assert.equal(new Set(results.map(r => JSON.parse(r.out).result.receipt.fetchedAt)).size, 1, 'one locked clone served every reader (no duplicate clones)');
  assert.deepEqual(fs.readdirSync(join(f.bindings.stateDir, 'cache')).sort(), ['base-1.git'], 'no temp clone or lock left behind');
  git(f.cache, ['fsck', '--connectivity-only']);
});

test('Git base: a dead owner cache lock is released; a live one serves the cached commit as stale', t => {
  const f = registered(t), head = git(f.work, ['rev-parse', 'HEAD']), lock = join(f.bindings.stateDir, 'cache', 'base-1.lock');
  const dead = spawnSync(process.execPath, ['-e', '0']).pid;
  fs.mkdirSync(lock); save(join(lock, 'owner.json'), { token: 'dead', pid: dead, host: hostname() });
  const r = f.json('cat', ['--base', 'project', '/expert/index.md', '--fresh']).result;
  assert.equal(r.receipt.stale, false); assert.equal(r.receipt.commit, head); assert.equal(fs.existsSync(lock), false);
  fs.mkdirSync(lock); save(join(lock, 'owner.json'), { token: 'live', pid: process.pid, host: hostname() });
  const busy = f.json('cat', ['--base', 'project', '/expert/index.md', '--fresh'], { OATS_SETTINGS: JSON.stringify({ 'bindings-file': f.bindings.file, 'git-timeout': 1 }) }).result;
  assert.equal(busy.receipt.stale, true); assert.match(busy.receipt.reason, /host cache lock is busy/); assert.equal(busy.receipt.commit, head);
  assert.equal(readJSON(join(lock, 'owner.json')).token, 'live', 'a live owner is never reclaimed');
});
test('Git base: typed, actionable errors; symlinks and submodules in the base are refused', t => {
  const f = registered(t);
  const err = (cmd, args) => { const r = f.cli(cmd, [...args, '--json']); assert.equal(r.status, 1, r.stdout); return r.out.error; };
  let e = err('cat', ['--base', 'nope', '/expert/index.md']); assert.equal(e.code, 'E_BASE_UNKNOWN'); assert.match(e.message, /bound bases: project/);
  e = err('cat', ['/expert/index.md']); assert.equal(e.code, 'E_USAGE'); assert.match(e.message, /--base ALIAS is required; bound bases: project/);
  e = err('cat', ['--base', 'project', '/expert/lessons/nope.md']); assert.equal(e.code, 'E_NOT_FOUND'); assert.match(e.message, /oats okf ls --base project \/expert\/lessons` lists: storm\.md/);
  e = err('cat', ['--base', 'project', '/okf-base.json']); assert.equal(e.code, 'E_NOT_MARKDOWN');
  e = err('cat', ['--base', 'project', '/expert']); assert.equal(e.code, 'E_NOT_MARKDOWN');
  for (const p of ['../code.txt', '/../code.txt', 'expert/../../code.txt', '.git/config']) assert.equal(err('cat', ['--base', 'project', p]).code, 'E_PATH', p);
  assert.equal(err('cat', ['--base', 'project', '../../x.md', '--from', '/expert/index.md']).code, 'E_PATH');
  assert.equal(err('cat', ['--base', 'project', join(f.bindings.stateDir, 'cache/base-1.git/config.md')]).code, 'E_PATH', 'filesystem paths are refused');
  assert.equal(err('ls', ['--base', 'project', '..']).code, 'E_PATH');
  assert.equal(err('search', ['--node', 'expert']).code, 'E_USAGE');
  assert.equal(err('index', ['ghost']).code, 'E_USAGE');
  fs.symlinkSync('../lessons/storm.md', join(f.work, 'knowledge/expert/decisions/alias.md'));
  f.push({}, 'symlink');
  e = err('cat', ['--base', 'project', '/expert/decisions/alias.md', '--fresh']); assert.equal(e.code, 'E_PATH'); assert.match(e.message, /symlink or submodule/);
  assert.equal(f.json('ls', ['--base', 'project', '/expert/decisions']).result.entries.find(x => x.name === 'alias.md').kind, 'unsupported');
  const bases = f.json('bases').result.bases[0]; assert.equal(bases.validated.ok, false, 'the new accepted commit fails validation and bases says so');
  assert.equal(err('refresh', []).code, 'E_REMOVED');
});

test('Git base: links report missing targets; bases caches the validation verdict per commit', t => {
  const f = registered(t);
  const head = f.push({ 'expert/decisions/retry-policy.md': concept('Decision', 'Retry policy', 'Why retries back off.', 'See [jitter](jitter.md) and [escape](../../../outside.md).') });
  const links = f.json('links', ['--base', 'project', '/expert/decisions/retry-policy.md', '--fresh']).result.links;
  assert.deepEqual(links.map(l => [l.target, l.path ?? null, l.exists]), [['jitter.md', 'expert/decisions/jitter.md', false], ['../../../outside.md', null, false]]);
  assert.match(links[1].refused, /escapes the base root/);
  const text = f.cli('links', ['--base', 'project', '/expert/decisions/retry-policy.md']).stdout; assert.match(text, /MISSING .*jitter\.md/); assert.match(text, /REFUSED/);
  assert.equal(f.json('bases').result.bases[0].validated.ok, false, 'a dangling link fails strict validation');
  assert.ok(fs.existsSync(join(f.cache, 'okf-validation', `${head}.json`)), 'verdict cached per accepted commit');
  assert.deepEqual(fs.readdirSync(join(f.bindings.stateDir, 'cache')).filter(n => n.startsWith('.validate-')), [], 'validation scratch removed');
});

test('search caps hits at 50 and says how many more', t => {
  const f = registered(t);
  const lines = Array.from({ length: 70 }, (_, i) => `needle line ${i}`).join('\n');
  f.push({ 'expert/lessons/storm.md': concept('Lesson', 'Retry storm', 'A fixed delay caused a storm.', lines) });
  const r = f.json('search', ['needle', '--fresh']).result;
  assert.equal(r.hits.length, 50); assert.equal(r.total, 70); assert.equal(r.more, 20);
  assert.match(f.cli('search', ['needle']).stdout, /… and 20 more/);
});

test('read stays an alias of cat; refresh is removed and creates nothing', t => {
  const f = registered(t);
  const read = f.json('read', ['--base', 'project', '--path', 'expert/index.md']).result, cat = f.json('cat', ['--base', 'project', 'expert/index.md']).result;
  assert.deepEqual(Object.keys(read), ['path', 'text', 'receipt']); assert.equal(read.path, cat.path); assert.equal(read.text, cat.text); assert.equal(read.receipt.commit, cat.receipt.commit);
  assert.match(f.json('read', ['--base', 'project']).result.path, /^index\.md$/, 'read defaults to the base index as before');
  const before = fs.readdirSync(f.home).sort();
  const r = f.cli('refresh', ['--json']); assert.equal(r.status, 1); assert.equal(r.out.error.code, 'E_REMOVED');
  assert.match(r.out.error.message, /no per-instance views.*oats okf index.*oats okf cat/);
  assert.deepEqual(fs.readdirSync(f.home).sort(), before, 'no view directory');
  assert.equal(f.cli('read', ['--base', 'project', 'expert/index.md', '--json']).out.error.code, 'E_USAGE', 'read keeps its flag-only form');
});

test('directory base: commands read in place under the base lock, with digest receipts', t => {
  const f = registered(t, { kind: 'directory' });
  assert.ok(f.s.acceptedView.project.digest); assert.equal(f.s.acceptedView.project.kind, 'directory');
  assert.equal(fs.existsSync(join(f.home, 'knowledge')), false);
  const b = f.json('bases').result.bases[0]; assert.equal(b.kind, 'directory'); assert.deepEqual(b.validated, { ok: true });
  const policy = f.json('cat', ['--base', 'project', '/expert/decisions/retry-policy.md']).result;
  assert.match(policy.text, /Exponential backoff/); assert.equal(policy.receipt.kind, 'directory'); assert.equal(policy.receipt.digest, f.s.acceptedView.project.digest); assert.equal(policy.receipt.stale, false);
  assert.match(f.cli('cat', ['--base', 'project', '/expert/lessons/storm.md']).stdout.trimEnd().split('\n').at(-1), /^— project@dir:[0-9a-f]{12} \(fetched just now\)$/);
  assert.equal(f.json('cat', ['--base', 'project', '../lessons/storm.md', '--from', 'expert/decisions/retry-policy.md']).result.path, 'expert/lessons/storm.md');
  assert.deepEqual(f.json('index').result.indexes.map(x => x.path), ['expert/index.md', 'peer/index.md']);
  assert.deepEqual(f.json('ls', ['--base', 'project', 'expert/lessons']).result.entries[0].title, 'Retry storm');
  assert.equal(f.json('links', ['--base', 'project', '/expert/decisions/retry-policy.md']).result.links[0].exists, true);
  assert.equal(f.json('search', ['backoff']).result.hits[0].path, 'expert/decisions/retry-policy.md');
  assert.equal(f.json('search', ['--node', 'project/peer', 'backoff']).result.total, 0);
  assert.equal(fs.existsSync(baseLock(f.base)), false, 'the lock is released after every read');
  // Strict confinement for directory bases: escapes, filesystem paths, symlinks.
  const err = args => f.cli('cat', ['--base', 'project', ...args, '--json']).out.error;
  assert.equal(err(['../bindings.json']).code, 'E_PATH');
  assert.equal(err([join(f.base.path, 'expert/index.md')]).code, 'E_PATH');
  put(join(f.dir, 'outside/secret.md'), concept('Lesson', 'Secret', 'Outside the base.', 'must not be readable'));
  fs.symlinkSync(join(f.dir, 'outside'), join(f.base.path, 'expert/linked'));
  fs.symlinkSync(join(f.dir, 'outside/secret.md'), join(f.base.path, 'expert/secret.md'));
  for (const p of ['/expert/linked/secret.md', '/expert/secret.md']) { const e = err([p]); assert.equal(e.code, 'E_PATH', p); assert.doesNotMatch(JSON.stringify(e), /must not be readable/); }
});

test('directory base: a pending publication refuses reads; a busy lock is waited for', async t => {
  const f = registered(t, { kind: 'directory' });
  fs.writeFileSync(journalPath(f.base), '{}');
  const e = f.cli('cat', ['--base', 'project', '/expert/index.md', '--json']).out.error;
  assert.equal(e.code, 'E_RECOVERY'); assert.match(e.message, /publication pending: .*retry its recorded run before reading/);
  fs.rmSync(journalPath(f.base));
  fs.mkdirSync(baseLock(f.base)); save(join(baseLock(f.base), 'owner.json'), { token: 'x', pid: process.pid, host: 'fixture' });
  setTimeout(() => fs.rmSync(baseLock(f.base), { recursive: true }), 600);
  const r = await new Promise(done => { const c = spawn(process.execPath, [CLI, 'cat', '--base', 'project', '/expert/index.md', '--json'], { cwd: f.home, env: process.env }); let out = ''; c.stdout.on('data', d => { out += d; }); c.on('close', code => done({ code, out })); });
  assert.equal(r.code, 0, r.out); assert.match(JSON.parse(r.out).result.text, /Retry policy/);
});

test('withBase reads no base without a bound alias or cache and never creates instance files', t => {
  const f = registered(t); const s = homeSource(f.home);
  const before = fs.readdirSync(f.home).sort();
  const r = catCmd(s, { base: 'project' }, ['/expert/index.md']);
  assert.match(r.text, /— project@/); assert.deepEqual(fs.readdirSync(f.home).sort(), before);
  assert.throws(() => withBase(s.bindings, 'constructor', {}, () => {}), /unknown base/);
});

test('package: inject carries the consult rules and points at the okf-consultation skill', () => {
  const m = readJSON(join(CAP, 'oats.json'));
  for (const c of ['bases', 'index', 'cat', 'ls', 'links', 'search', 'read', 'refresh']) assert.equal(m.commands[c], `bin/oats-okf.mjs ${c}`);
  assert.ok(m.settings['consult-max-age'].description); assert.equal(Object.hasOwn(m.settings['consult-max-age'], 'default'), false, 'default lives in code; the binding wire rejects unknown setting keys');
  assert.equal(Object.hasOwn(m.settings, 'materialize'), false);
  const inject = fs.readFileSync(join(CAP, m.inject), 'utf8');
  assert.match(inject, /no local copy/); assert.match(inject, /At the start of every task, and after compaction:\*\* `oats okf index`/);
  assert.match(inject, /Regularly while working, not only at the start/); assert.match(inject, /oats okf search/); assert.match(inject, /\*\*Consultation\*\*/); assert.match(inject, /Load the\s+\*\*okf-consultation\*\* skill at the start of every task/);
  assert.match(inject, /alias\/node\/concept\.md@<short-oid>/); assert.doesNotMatch(inject, /\.\/knowledge\/|view\.json|refresh/);
  const skill = fs.readFileSync(join(CAP, 'skills/okf-consultation/SKILL.md'), 'utf8'), fm = /^---\n([\s\S]*?)\n---\n/.exec(skill)[1];
  assert.equal(/^name: (.+)$/m.exec(fm)[1], 'okf-consultation', 'name matches the skill directory');
  assert.match(fm, /^description: >-\n/m); const description = fm.slice(fm.indexOf('>-') + 2).replace(/\s+/g, ' ').trim();
  assert.ok(description.length <= 1024, `description ${description.length} chars`);
  for (const trigger of [/starting a task/, /compaction/, /prior decision/, /what do we know about X/, /check the knowledge base/]) assert.match(description, trigger);
  for (const section of ['## The model', '## At the start of every task, and after compaction', '## Consult again while working', '## Navigating', '## Searching', '## Citing', '## Freshness', '## Gotchas']) assert.match(skill, new RegExp(`^${section}$`, 'm'), section);
  assert.match(skill, /references\/consult\.md/); assert.ok(skill.split('\n').length <= 200, 'skill-craft size');
  const okf = fs.readFileSync(join(CAP, 'skills/okf/SKILL.md'), 'utf8');
  assert.match(okf, /okf-consultation/, 'the format skill points consulting at okf-consultation'); assert.doesNotMatch(okf, /^## Navigating$/m, 'no duplicated procedure');
  assert.equal(fs.existsSync(join(CAP, 'skills/okf/references')), false);
  const reference = fs.readFileSync(join(CAP, 'skills/okf-consultation/references/consult.md'), 'utf8');
  for (const section of ['## Navigation, worked example', '## Search', '## Citing', '## Freshness', '## Errors']) assert.ok(reference.includes(section), section);
});
