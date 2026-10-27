// okf #106: this checkout's upgrade hook through the REAL released kernel's
// `oats instance upgrade` (@awebai/oats 0.68.1). CI-only: it runs only when
// OATS_OKF_UPGRADE_CLI names that kernel's bin/oats.mjs (the kernel-upgrade-0681
// CI job installs it and fails on any skip).
//
// One package repository holds four payloads, each pinned by commit in turn:
// the released v4.2.2, v5.2.1 and v5.3.0, and this checkout. Negative control:
// a home spawned on 5.2.1 cannot move to 5.3.0, which declares no upgrade hook.
// A home spawned on 5.3.0 is adopted by this checkout, its okf state
// byte-identical. A home
// spawned on 4.2.2 with harvest off is refused by this checkout with the
// respawn remedy; 4.2.2 records the same home state as 4.3.0 (the hook adds
// none), so it stands for any 4.x home. No model (the harnesses refuse to run,
// every spawn is --no-launch), network, host timer or production setting.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { machine } from './fixtures/real-machine.mjs';

const cli = process.env.OATS_OKF_UPGRADE_CLI;
const KERNEL = '0.68.1';
const root = fileURLToPath(new URL('../', import.meta.url));
const write = (file, text) => { fs.mkdirSync(dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));
/** oats.okf's state in a 5.x home: its spawn policy and the working memory. */
const okfState = home => Object.fromEntries(['okf-harvest-policy.json', 'STATE.md', 'log.md'].map(p => [p, fs.readFileSync(join(home, p), 'utf8')]).concat([['notes/', fs.readdirSync(join(home, 'notes')).sort()]]));
const okfRow = plan => plan.modules.find(m => m.capability === 'oats.okf');

test(`real OATS ${KERNEL} instance upgrade: a 5.2.1 home cannot move to the hook-less 5.3.0; a 5.3.0 home is adopted by this checkout, its state unchanged; a 4.x home is refused with the respawn remedy`, { skip: !cli }, t => {
  const base = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'okf5-kernel-upgrade-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const { env, git, asked } = machine(base);

  // ---- one package repository, one commit per payload ----
  const pkg = join(base, 'pkg');
  fs.mkdirSync(pkg); git(pkg, ['init', '-q', '-b', 'main']);
  const commit = (payload, message) => {
    fs.rmSync(join(pkg, 'oats-package'), { recursive: true, force: true });
    payload();
    git(pkg, ['add', '-A']); git(pkg, ['commit', '-qm', message]); return git(pkg, ['rev-parse', 'HEAD']);
  };
  const archived = rev => () => execFileSync('tar', ['-x', '-C', pkg], { input: execFileSync('git', ['archive', rev, 'oats-package'], { cwd: root }) });
  const commits = {
    v422: commit(archived('v4.2.2'), 'okf 4.2.2'),
    v521: commit(archived('v5.2.1'), 'okf 5.2.1'),
    v530: commit(archived('v5.3.0'), 'okf 5.3.0'),
    tree: commit(() => fs.cpSync(join(root, 'oats-package'), join(pkg, 'oats-package'), { recursive: true, verbatimSymlinks: true }), 'this checkout'),
  };
  execFileSync('git', ['clone', '-q', '--bare', pkg, join(base, 'pkg.git')], { env });

  // ---- a workspace with one source soul, pinning one payload at a time ----
  const ws = join(base, 'ws'), soul = join(ws, 'souls/source');
  const pin = c => write(join(ws, 'oats-workspace.yaml'), `schemaVersion: 2\nname: okf5-kernel-upgrade\nmembers:\n  - file://${base}/ws.git\npackages:\n  oats.okf: git:file://${base}/pkg.git@${c}\ndefaults:\n  capabilities:\n    oats.core: off\n  knowledge: { oats.okf: { from: package } }\n  messaging: none\n  tasks: none\n`);
  pin(commits.v422);
  write(join(ws, 'oats-membership.yaml'), `schemaVersion: 2\nworkspace: file://${base}/ws.git\n`);
  write(join(soul, 'soul.yaml'), 'schemaVersion: 2\nname: source\ndescription: Domain expert fixture.\nwork: directory\n');
  write(join(soul, 'AGENTS.md'), '# Source\nNo model or production operations in this fixture.\n');
  write(join(soul, 'okf.json'), JSON.stringify({ version: 1, owner: 'source-owner', owns: ['project/expert'], reads: [] }));
  git(ws, ['init', '-q', '-b', 'main']); git(ws, ['add', '-A']); git(ws, ['commit', '-qm', 'fixture']);
  execFileSync('git', ['clone', '-q', '--bare', ws, join(base, 'ws.git')], { env });

  // ---- the deployment: one directory base, no 4.x harvest key ----
  const dep = join(base, 'deployment');
  write(join(base, 'bindings.json'), JSON.stringify({ version: 1, stateDir: join(base, 'state'), bases: { project: { id: 'kb-1', kind: 'directory', path: join(base, 'accepted') } } }));
  write(join(base, 'nodes.json'), JSON.stringify({ expert: { path: 'expert', owner: 'source-owner' } }));
  write(join(dep, 'oats-local.yaml'), `schemaVersion: 2\nworkspace: file://${base}/ws.git\nsettings:\n  oats.okf:\n    bindings-file: ${base}/bindings.json\n`);
  const run = (args, { cwd = dep, home } = {}) => {
    const r = spawnSync(process.execPath, [cli, ...args, '--json'], { cwd, env: home ? { ...env, OATS_INSTANCE_HOME: home, OATS_HOME: home } : env, encoding: 'utf8', timeout: 180000, maxBuffer: 16 * 1024 * 1024 });
    let out; try { out = JSON.parse(r.stdout); } catch { assert.fail(`${args.join(' ')}: ${r.stdout}\n${r.stderr}`); }
    return out;
  };
  /** Pin `c` in the shared workspace and sync the deployment to it. */
  const repin = c => {
    pin(c); git(ws, ['commit', '-qam', `pin ${c}`]); git(ws, ['push', '-q', join(base, 'ws.git'), 'main']);
    const r = run(['sync']); assert.equal(r.ok, true, JSON.stringify(r));
  };
  const homeOf = name => join(dep, 'agents/source/instances', name);
  const instance = name => json(join(homeOf(name), 'instance.json'));
  const spawn = name => { const r = run(['spawn', 'source', '--name', name, '--no-launch']); assert.equal(r.ok, true, JSON.stringify(r)); return homeOf(name); };
  const plan = name => { const r = run(['instance', 'upgrade', name, '--plan']); assert.equal(r.ok, true, JSON.stringify(r)); return r.result; };

  assert.equal(run(['version']).version, KERNEL, 'this test qualifies the released kernel that ships instance upgrade');
  assert.equal(run(['sync']).ok, true);
  assert.equal(run(['okf', 'init', '--base', 'project', '--nodes', join(base, 'nodes.json'), '--confirm', '--soul', 'source']).result.status, 'accepted');

  // ---- a 4.x home: spawned on 4.2.2 with harvest off (its default) ----
  const old = spawn('src-4x');
  assert.equal(instance('src-4x').capabilityMeta['oats.okf'].harvest, 'off');
  assert.equal(fs.existsSync(join(old, '.okf-instance.json')), true);

  // ---- a 5.x home without the hook in reach: spawned on 5.2.1 ----
  repin(commits.v521);
  spawn('src-52');

  // ---- a 5.x home: spawned on 5.3.0 ----
  repin(commits.v530);
  const home = spawn('src-5x');
  assert.equal(instance('src-5x').modules['oats.okf'].commit, commits.v530);
  assert.equal(Object.hasOwn(instance('src-5x').capabilityMeta || {}, 'oats.okf'), false, '5.x records no meta');
  const state = okfState(home);
  assert.deepEqual(JSON.parse(state['okf-harvest-policy.json']), { version: 1, harvest: 'on', reason: 'default' });

  // ---- negative control: 5.3.0 declares no upgrade hook, so the 5.2.1 home cannot move to it ----
  const refused = okfRow(plan('src-52'));
  assert.equal(refused.provider.decision, 'refuse', JSON.stringify(refused)); assert.match(refused.provider.reason, /does not declare an upgrade hook/);

  // ---- this checkout adopts the 5.x home ----
  repin(commits.tree);
  const p = plan('src-5x'), row = okfRow(p);
  assert.deepEqual(row.provider, { decision: 'adopt', reason: null }, JSON.stringify(p));
  assert.equal(row.from.commit, commits.v530); assert.equal(row.to.commit, commits.tree);
  const applied = run(['instance', 'upgrade', 'src-5x', '--plan-revision', p.planRevision, '--idempotency-key', 'okf106-5x']);
  assert.equal(applied.ok, true, JSON.stringify(applied)); assert.equal(applied.result.status, 'complete', JSON.stringify(applied.result));
  assert.equal(instance('src-5x').modules['oats.okf'].commit, commits.tree);
  assert.ok(fs.existsSync(join(home, '.oats/modules/oats.okf/lib/upgrade.mjs')), 'the home carries this checkout\'s module');
  assert.deepEqual(instance('src-5x').capabilityMeta['oats.okf'], {}, 'apply recorded the empty meta as given');
  assert.deepEqual(okfState(home), state, 'the spawn policy and working memory are byte-identical');
  const status = run(['okf', 'status'], { cwd: home, home });
  assert.equal(status.ok, true, JSON.stringify(status)); assert.equal(status.result.harvest, 'on');
  assert.equal(okfRow(plan('src-5x')), undefined, 'nothing is left to move');

  // ---- this checkout refuses the 4.x home, naming the respawn ----
  const old4 = okfRow(plan('src-4x'));
  assert.equal(old4.provider.decision, 'refuse', JSON.stringify(old4));
  assert.match(old4.provider.reason, /spawned by oats\.okf 4\.x/);
  assert.match(old4.provider.remedy, /^respawn the instance: oats retire src-4x \(its own hooks run\), then oats spawn/);
  assert.equal(fs.existsSync(join(old, '.okf-instance.json')), true, 'the refused home is untouched');
  assert.equal(fs.existsSync(asked), false, 'no harness was asked to start');
});
