import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { join } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { kernelSkip, sandbox, write } from './helpers/real-kernel.mjs';
// okf #106: the real kernel's `oats instance upgrade` moves a home
// spawned on okf 4.0.5 with harvest off. The released 4.2.2, which declares no
// upgrade hook, is refused; this tree is adopted and the home keeps harvest off.
// Opt-in: OATS_OKF_UPGRADE_CLI names a real kernel (OATS >= 0.68.1). It runs a
// disposable v2 workspace of file:// repositories; the package repository holds
// v4.0.5, v4.2.2 and this tree, each pinned by its commit in turn. No model is
// launched and no network, host timer or production setting is used.
const cli = process.env.OATS_OKF_UPGRADE_CLI;
const skip = kernelSkip(cli, [0, 68, 1]);
const root = fileURLToPath(new URL('../', import.meta.url));

function workspace(t) {
  const { base, env, git } = sandbox(t, 'okf-kernel-upgrade-');
  // One package repository, one commit per payload.
  const pkg = join(base, 'pkg');
  fs.mkdirSync(pkg); git(pkg, ['init', '-q', '-b', 'main']);
  const commit = (payload, message) => {
    fs.rmSync(join(pkg, 'oats-package'), { recursive: true, force: true });
    payload();
    git(pkg, ['add', '-A']); git(pkg, ['commit', '-qm', message]); return git(pkg, ['rev-parse', 'HEAD']);
  };
  const release = tag => () => execFileSync('tar', ['-x', '-C', pkg], { input: execFileSync('git', ['archive', tag, 'oats-package'], { cwd: root }) });
  const commits = {
    v405: commit(release('v4.0.5'), 'okf 4.0.5'),
    v422: commit(release('v4.2.2'), 'okf 4.2.2'),
    tree: commit(() => fs.cpSync(join(root, 'oats-package'), join(pkg, 'oats-package'), { recursive: true, verbatimSymlinks: true }), 'this tree'),
  };
  execFileSync('git', ['clone', '-q', '--bare', pkg, join(base, 'pkg.git')], { env });
  const ws = join(base, 'ws'), soul = join(ws, 'souls/source');
  const pin = c => write(join(ws, 'oats-workspace.yaml'), `schemaVersion: 2\nname: okf-kernel-upgrade\nmembers:\n  - file://${base}/ws.git\npackages:\n  oats.okf: git:file://${base}/pkg.git@${c}\ndefaults:\n  capabilities:\n    oats.core: off\n  knowledge: { oats.okf: { from: package } }\n  messaging: none\n  tasks: none\n`);
  pin(commits.v405);
  write(join(ws, 'oats-membership.yaml'), `schemaVersion: 2\nworkspace: file://${base}/ws.git\n`);
  write(join(soul, 'soul.yaml'), 'schemaVersion: 2\nname: source\ndescription: Domain expert.\nwork: directory\n');
  write(join(soul, 'AGENTS.md'), '# Source\nDomain expert.\n');
  write(join(soul, 'okf.json'), JSON.stringify({ version: 1, owner: 'source-owner', owns: ['project/expert'], reads: [] }));
  git(ws, ['init', '-q', '-b', 'main']); git(ws, ['add', '-A']); git(ws, ['commit', '-qm', 'fixture']);
  execFileSync('git', ['clone', '-q', '--bare', ws, join(base, 'ws.git')], { env });
  const dep = join(base, 'dep');
  write(join(base, 'bindings.json'), JSON.stringify({ version: 1, stateDir: join(base, 'state'), bases: { project: { id: 'test-base', kind: 'directory', path: join(base, 'accepted') } } }));
  write(join(base, 'nodes.json'), JSON.stringify({ expert: { path: 'expert', owner: 'source-owner' } }));
  write(join(dep, 'oats-local.yaml'), `schemaVersion: 2\nworkspace: file://${base}/ws.git\nsettings:\n  oats.okf:\n    bindings-file: ${base}/bindings.json\n    harvest: off\n`);
  const oats = (args, { cwd = dep, home } = {}) => {
    const r = spawnSync(process.execPath, [cli, ...args, '--json'], { cwd, env: home ? { ...env, OATS_INSTANCE_HOME: home, OATS_HOME: home } : env, encoding: 'utf8', timeout: 180000, maxBuffer: 16 * 1024 * 1024 });
    let out; try { out = JSON.parse(r.stdout); } catch { assert.fail(`${args.join(' ')}: ${r.stdout}\n${r.stderr}`); }
    return out;
  };
  /** Pin the package at `c` in the shared workspace and sync the deployment to it. */
  const repin = c => {
    pin(c); git(ws, ['commit', '-qam', `pin ${c}`]); git(ws, ['push', '-q', join(base, 'ws.git'), 'main']);
    const r = oats(['sync']); assert.equal(r.ok, true, JSON.stringify(r));
  };
  assert.equal(oats(['sync']).ok, true);
  assert.equal(oats(['okf', 'init', '--base', 'project', '--nodes', join(base, 'nodes.json'), '--confirm', '--soul', 'source']).result.status, 'accepted');
  return { dep, commits, oats, repin };
}
const readJSON = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const okfRow = plan => plan.modules.find(m => m.capability === 'oats.okf');

test('real kernel upgrade (#106): a home spawned on okf 4.0.5 with harvest off is refused by 4.2.2 and adopted by this tree, keeping harvest off', { skip }, t => {
  const w = workspace(t), name = 'src-a';
  const spawned = w.oats(['spawn', 'source', '--name', name, '--no-launch']);
  assert.equal(spawned.ok, true, JSON.stringify(spawned));
  const home = join(w.dep, 'agents/source/instances', name), instance = () => readJSON(join(home, 'instance.json'));
  assert.equal(instance().modules['oats.okf'].commit, w.commits.v405);
  const meta = instance().capabilityMeta['oats.okf'];
  assert.equal(meta.harvest, 'off', JSON.stringify(meta));
  assert.equal(fs.existsSync(join(home, '.okf-source.json')), false, 'no source registered');
  const record = fs.readFileSync(join(home, '.okf-instance.json'));
  // Negative control: the released 4.2.2 declares no upgrade hook.
  w.repin(w.commits.v422);
  const refused = w.oats(['instance', 'upgrade', name, '--plan']);
  assert.equal(refused.ok, true, JSON.stringify(refused));
  assert.equal(okfRow(refused.result).provider.decision, 'refuse', JSON.stringify(refused.result));
  assert.match(okfRow(refused.result).provider.reason, /does not declare an upgrade hook/);
  // This tree adopts it.
  w.repin(w.commits.tree);
  const plan = w.oats(['instance', 'upgrade', name, '--plan']);
  assert.equal(plan.ok, true, JSON.stringify(plan));
  const row = okfRow(plan.result);
  assert.deepEqual(row.provider, { decision: 'adopt', reason: null }, JSON.stringify(plan.result));
  assert.equal(row.from.commit, w.commits.v405); assert.equal(row.to.commit, w.commits.tree);
  const applied = w.oats(['instance', 'upgrade', name, '--plan-revision', plan.result.planRevision, '--idempotency-key', 'okf106-upgrade']);
  assert.equal(applied.ok, true, JSON.stringify(applied)); assert.equal(applied.result.status, 'complete', JSON.stringify(applied.result));
  // Composed on this tree, with the recorded state kept exactly.
  assert.equal(instance().modules['oats.okf'].commit, w.commits.tree);
  assert.ok(fs.existsSync(join(home, '.oats/modules/oats.okf/lib/upgrade.mjs')), 'the home carries this tree\'s module');
  assert.deepEqual(instance().capabilityMeta['oats.okf'], meta, 'the recorded meta is unchanged');
  assert.deepEqual(fs.readFileSync(join(home, '.okf-instance.json')), record, 'the harvest-off record is unchanged');
  assert.equal(fs.existsSync(join(home, '.okf-source.json')), false, 'still no source');
  assert.match(fs.readFileSync(join(home, 'AGENTS.md'), 'utf8'), /With harvest off, do not run it/, 'AGENTS.md is composed from this tree\'s inject');
  // The upgraded home works through the kernel's dispatch: it consults with harvest off.
  const inspect = w.oats(['okf', 'inspect'], { cwd: home, home });
  assert.equal(inspect.ok, true, JSON.stringify(inspect)); assert.equal(inspect.result.harvest.status, 'off');
  // Nothing is left to move.
  const again = w.oats(['instance', 'upgrade', name, '--plan']);
  assert.equal(again.ok, true, JSON.stringify(again)); assert.equal(okfRow(again.result), undefined, JSON.stringify(again.result));
});
