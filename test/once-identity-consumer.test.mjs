import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const cli = process.env.OATS_OKF_NATIVE_CLI || process.env.OATS_OKF_CONSUMER_CLI;
const root = fileURLToPath(new URL('../', import.meta.url));
const write = (p, text) => { fs.mkdirSync(dirname(p), { recursive: true }); fs.writeFileSync(p, text); };
const json = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

test('released operator one-shots retain one qualified owner across changing preview soul directories', { skip: !cli }, t => {
  const version = spawnSync(process.execPath, [cli, 'version', '--json'], { encoding: 'utf8' });
  assert.equal(version.status, 0, version.stderr);
  const installed = JSON.parse(version.stdout); assert.equal(installed.name, '@awebai/oats');
  assert.match(installed.version, /^\d+\.\d+\.\d+$/);
  const [major, minor, patch] = installed.version.split('.').map(Number);
  assert.ok(major > 0 || minor > 43 || minor === 43 && patch >= 3, 'probe needs a kernel satisfying the package floor');
  const base = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'okf-once-identity-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const bin = join(base, 'bin'); fs.mkdirSync(bin); fs.mkdirSync(join(base, 'user'));
  fs.symlinkSync(process.execPath, join(bin, 'node'));
  fs.symlinkSync(execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim(), join(bin, 'git'));
  for (const name of ['pi', 'claude', 'codex']) { write(join(bin, name), '#!/bin/sh\necho NO_REAL_MODEL >&2\nexit 98\n'); fs.chmodSync(join(bin, name), 0o755); }
  const env = { HOME: join(base, 'user'), PATH: `${bin}:/usr/bin:/bin`, OATS_HOME_DIR: join(base, 'host'), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
  const git = (cwd, args) => execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', ...args], { cwd, env, encoding: 'utf8' }).trim();
  const repo = (dir, remote) => {
    git(dir, ['init', '-q', '-b', 'main']); git(dir, ['add', '-A']); git(dir, ['commit', '-qm', 'fixture']);
    execFileSync('git', ['clone', '-q', '--bare', dir, remote], { env }); return git(dir, ['rev-parse', 'HEAD']);
  };
  fs.cpSync(join(root, 'oats-package'), join(base, 'pkg/oats-package'), { recursive: true, verbatimSymlinks: true });
  const pkg = repo(join(base, 'pkg'), join(base, 'pkg.git'));
  const ws = join(base, 'ws'), soul = join(ws, 'souls/source');
  write(join(ws, 'oats-workspace.yaml'), `schemaVersion: 2\nname: once-identity\nmembers:\n  - file://${base}/ws.git\npackages:\n  oats.okf: git:file://${base}/pkg.git@${pkg}\ndefaults:\n  capabilities:\n    oats.core: off\n  knowledge: { oats.okf: { from: package } }\n  messaging: none\n  tasks: none\n`);
  write(join(ws, 'oats-membership.yaml'), `schemaVersion: 2\nworkspace: file://${base}/ws.git\n`);
  write(join(soul, 'soul.yaml'), 'schemaVersion: 2\nname: source\ndescription: Source expert.\nwork: directory\n');
  write(join(soul, 'AGENTS.md'), '# Source\nPrivate fixture evidence only.\n');
  write(join(soul, 'okf.json'), JSON.stringify({ version: 1, owner: 'source-owner', owns: ['project/expert'], reads: [] }));
  repo(ws, join(base, 'ws.git'));
  const dep = join(base, 'dep'), state = join(base, 'state');
  write(join(base, 'bindings.json'), JSON.stringify({ version: 1, stateDir: state, bases: { project: { id: 'test-base', kind: 'directory', path: join(base, 'accepted') } } }));
  write(join(base, 'nodes.json'), JSON.stringify({ expert: { path: 'expert', owner: 'source-owner' } }));
  write(join(dep, 'oats-local.yaml'), `schemaVersion: 2\nworkspace: file://${base}/ws.git\nsettings:\n  oats.okf:\n    bindings-file: ${base}/bindings.json\n    harvest: off\n`);
  const oats = args => {
    const out = spawnSync(process.execPath, [cli, ...args, '--json'], { cwd: dep, env, encoding: 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024 });
    assert.equal(out.status, 0, `${args.join(' ')}\n${out.stdout}\n${out.stderr}`); return JSON.parse(out.stdout);
  };
  oats(['sync']); oats(['okf', 'init', '--base', 'project', '--nodes', join(base, 'nodes.json'), '--confirm', '--soul', 'source']);
  oats(['spawn', 'source', '--name', 'source-one', '--no-launch']);
  const home = join(dep, 'agents/source/instances/source-one'), meta = json(join(home, 'instance.json'));
  assert.equal(fs.existsSync(join(home, '.okf-source.json')), false);
  const before = fs.readFileSync(join(home, 'instance.json'));
  const once = name => {
    const bytes = `# ${name}\nA distinct private fixture observation.\n`, file = join(base, `${name}.json`);
    write(join(home, 'notes', `${name}.md`), bytes);
    write(file, JSON.stringify({ version: 1, instance: meta.instance, notes: [{ path: `notes/${name}.md`, sha256: sha(bytes) }] }));
    const result = oats(['okf', 'harvest', '--once', '--home', home, '--records', file, '--no-launch', '--soul', 'source']).result;
    assert.equal(result.status, 'ready'); return { result, descriptor: json(result.source) };
  };
  const first = once('first'), second = once('second');
  assert.notEqual(first.descriptor.soulDir, second.descriptor.soulDir, 'actual operator dispatch uses different temporary copies');
  for (const { descriptor } of [first, second]) assert.equal(descriptor.soulId, meta.workspace.soul.id);
  assert.equal(json(join(state, 'owners.json'))['source-owner'], meta.workspace.soul.id);
  assert.notEqual(first.result.source, second.result.source);
  assert.equal(fs.existsSync(join(home, '.okf-source.json')), false, 'one-shots never register the seat');
  assert.deepEqual(fs.readFileSync(join(home, 'instance.json')), before, 'target metadata is not rewritten');
  // Complete fixture judgments, without any model. Then model the documented
  // old null-id/path record; this fixture conversion is NOT historical proof.
  for (const item of [first, second]) {
    const run = json(join(dirname(item.result.source), 'runs', item.result.run, 'run.json'));
    const judgment = join(base, `${run.id}-judgment.json`);
    write(judgment, JSON.stringify({ version: 1, exclusionsReviewed: true, outcomes: run.inputs.map(input => ({ input, verdict: 'drop', reason: 'Fixture only', concepts: [] })) }));
    oats(['okf', 'complete', '--source', item.result.source, '--run', run.id, '--judgment', judgment, '--soul', 'source']);
  }
  const pin = first.descriptor.soulDir;
  assert.equal(fs.existsSync(pin), false, 'the preview copy is gone');
  write(first.result.source, JSON.stringify({ ...first.descriptor, soulId: null }));
  write(join(state, 'owners.json'), JSON.stringify({ 'source-owner': pin }));
  const receiptFile = join(dirname(first.result.source), 'once.json'), oldReceipt = json(receiptFile), oldSource = fs.readFileSync(first.result.source);
  const args = ['okf', 'owner-rebind', '--source', first.result.source, '--expect-pin', pin, '--soul', 'source'];
  const plan = oats([...args, '--plan']).result; assert.equal(plan.changed, false); assert.equal(plan.to, meta.workspace.soul.id);
  assert.deepEqual(json(receiptFile), oldReceipt); assert.equal(json(join(state, 'owners.json'))['source-owner'], pin);
  const applied = oats(args).result; assert.equal(applied.changed, true);
  const { ownerDecisions, ...retained } = json(receiptFile); assert.deepEqual(retained, oldReceipt);
  assert.equal(ownerDecisions[0].kind, 'explicit-operator-rebind'); assert.equal(ownerDecisions[0].from, pin); assert.equal(ownerDecisions[0].to, meta.workspace.soul.id);
  assert.deepEqual(fs.readFileSync(first.result.source), oldSource, 'new decision is not a retroactive source identity');
  const third = once('third'); assert.equal(third.descriptor.soulId, meta.workspace.soul.id);
});
