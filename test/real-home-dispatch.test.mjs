import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// okf 4.2.0: the real kernel dispatches an instance home's commands and hooks
// with the settings captured at its spawn. Switching the deployment's harvest
// off must still stop that home's checkpoint and retirement capture.
// Opt-in: a real kernel (OATS_OKF_NATIVE_CLI or OATS_OKF_CONSUMER_CLI) runs a
// disposable v2 workspace of file:// repositories with this package pinned by
// commit. No model is launched (the harnesses on PATH refuse to run), no
// network, host timer or production setting is used, and nothing in an
// instance home or its environment is rewritten: only the deployment's
// oats-local.yaml changes, as a host would change it.
const cli = process.env.OATS_OKF_NATIVE_CLI || process.env.OATS_OKF_CONSUMER_CLI;
// Verified against OATS 0.43.0 (v2 workspaces, spawn origins, --provider);
// an older selected kernel skips it, saying so.
const kernel = cli ? /(\d+)\.(\d+)\.(\d+)/.exec(spawnSync(process.execPath, [cli, '--version'], { encoding: 'utf8' }).stdout || '') : null;
const skip = !cli ? true : !kernel || Number(kernel[1]) * 1e6 + Number(kernel[2]) * 1e3 + Number(kernel[3]) < 43000 ? `needs OATS >= 0.43.0 (selected: ${kernel?.[0] ?? 'unknown'})` : false;
const root = fileURLToPath(new URL('../', import.meta.url));
const write = (p, text) => { fs.mkdirSync(dirname(p), { recursive: true }); fs.writeFileSync(p, text); };

function workspace(t) {
  const base = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'okf-home-dispatch-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const bin = join(base, 'bin');
  fs.mkdirSync(bin); fs.mkdirSync(join(base, 'user'));
  fs.symlinkSync(process.execPath, join(bin, 'node'));
  const gitBin = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
  fs.symlinkSync(gitBin, join(bin, 'git'));
  for (const harness of ['pi', 'claude', 'codex']) { write(join(bin, harness), '#!/bin/sh\necho NO_REAL_MODEL_IN_THIS_TEST >&2\nexit 98\n'); fs.chmodSync(join(bin, harness), 0o755); }
  const env = { HOME: join(base, 'user'), PATH: `${bin}:/usr/bin:/bin`, OATS_HOME_DIR: join(base, 'host'), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', LANG: 'en_US.UTF-8' };
  const git = (cwd, args) => execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', ...args], { cwd, env, encoding: 'utf8' }).trim();
  const repo = (dir, bare) => { git(dir, ['init', '-q', '-b', 'main']); git(dir, ['add', '-A']); git(dir, ['commit', '-qm', 'fixture']); execFileSync('git', ['clone', '-q', '--bare', dir, bare], { env }); return git(dir, ['rev-parse', 'HEAD']); };
  // The package under test, pinned by its commit.
  fs.cpSync(join(root, 'oats-package'), join(base, 'pkg/oats-package'), { recursive: true, verbatimSymlinks: true });
  const pkg = repo(join(base, 'pkg'), join(base, 'pkg.git'));
  const ws = join(base, 'ws'), soul = join(ws, 'souls/source');
  write(join(ws, 'oats-workspace.yaml'), `schemaVersion: 2\nname: okf-home-dispatch\nmembers:\n  - file://${base}/ws.git\npackages:\n  oats.okf: git:file://${base}/pkg.git@${pkg}\ndefaults:\n  capabilities:\n    oats.core: off\n  knowledge: { oats.okf: { from: package } }\n  messaging: none\n  tasks: none\n`);
  write(join(ws, 'oats-membership.yaml'), `schemaVersion: 2\nworkspace: file://${base}/ws.git\n`);
  const soulYaml = (extra = '') => write(join(soul, 'soul.yaml'), `schemaVersion: 2\nname: source\ndescription: Domain expert.\nwork: directory\n${extra}`);
  soulYaml(); write(join(soul, 'AGENTS.md'), '# Source\nDomain expert.\n');
  write(join(soul, 'okf.json'), JSON.stringify({ version: 1, owner: 'source-owner', owns: ['project/expert'], reads: [] }));
  repo(ws, join(base, 'ws.git'));
  const dep = join(base, 'dep'), state = join(base, 'state');
  write(join(base, 'bindings.json'), JSON.stringify({ version: 1, stateDir: state, bases: { project: { id: 'test-base', kind: 'directory', path: join(base, 'accepted') } } }));
  write(join(base, 'nodes.json'), JSON.stringify({ expert: { path: 'expert', owner: 'source-owner' } }));
  // What a host changes: the deployment's own oats-local.yaml.
  const host = value => write(join(dep, 'oats-local.yaml'), `schemaVersion: 2\nworkspace: file://${base}/ws.git\nsettings:\n  oats.okf:\n    bindings-file: ${base}/bindings.json\n    harvest: ${value}\n`);
  host('on');
  const oats = (args, { cwd = dep, home } = {}) => {
    const r = spawnSync(process.execPath, [cli, ...args, '--json'], { cwd, env: home ? { ...env, OATS_INSTANCE_HOME: home, OATS_HOME: home } : env, encoding: 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024 });
    let out; try { out = JSON.parse(r.stdout); } catch { assert.fail(`${args.join(' ')}: ${r.stdout}\n${r.stderr}`); }
    return out;
  };
  assert.equal(oats(['sync']).ok, true);
  assert.equal(oats(['okf', 'init', '--base', 'project', '--nodes', join(base, 'nodes.json'), '--confirm', '--soul', 'source']).result.status, 'accepted');
  const homeOf = name => join(dep, 'agents/source/instances', name);
  const spawn = (name, args = []) => { const r = oats(['spawn', 'source', '--name', name, '--no-launch', ...args]); assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.result.launched, false); return homeOf(name); };
  const captured = home => { const c = JSON.parse(fs.readFileSync(join(home, 'instance.json'), 'utf8')).capabilities.find(x => x.id === 'oats.okf'); return { harvest: c.settings.harvest, origin: c.settingsOrigins['/harvest']?.kind }; };
  const note = home => write(join(home, 'notes/decision.md'), '---\ntype: Decision\ntitle: Explicit custody\ndescription: Why custody is explicit.\n---\n\nThe human chose explicit custody.\n');
  const sourceFile = home => JSON.parse(fs.readFileSync(join(home, '.okf-source.json'), 'utf8')).source;
  const status = file => JSON.parse(fs.readFileSync(join(dirname(file), 'status.json'), 'utf8'));
  const harvesters = () => { const d = join(dep, 'agents/oats-okf--knowledge-harvester/instances'); return fs.existsSync(d) ? fs.readdirSync(d).filter(n => !n.startsWith('.')).length : 0; };
  // Bytes a home invocation reads its settings from: never rewritten here.
  const snapshot = home => ['instance.json', '.okf-source.json'].map(p => fs.readFileSync(join(home, p), 'utf8'));
  const publishSoul = extra => { soulYaml(extra); git(ws, ['commit', '-qam', 'soul']); git(ws, ['push', '-q', join(base, 'ws.git'), 'main']); };
  // The deployment's settings unreadable to its own dispatch: its workspace host is gone for now.
  const breakDeployment = () => fs.renameSync(join(base, 'ws.git'), join(base, 'ws.git.away'));
  const restoreDeployment = () => fs.renameSync(join(base, 'ws.git.away'), join(base, 'ws.git'));
  return { oats, host, spawn, captured, note, sourceFile, status, harvesters, snapshot, publishSoul, breakDeployment, restoreDeployment };
}

test('4.2.0 real home dispatch: a source spawned while the deployment was on stops capturing at its checkpoint and its retirement once ONLY the deployment switches off', { skip }, t => {
  const w = workspace(t);
  const a = w.spawn('src-a'), b = w.spawn('src-b');
  assert.deepEqual(w.captured(a), { harvest: 'on', origin: 'host' }, 'the home captured the host value at spawn');
  w.note(a); w.note(b);
  const files = { a: w.sourceFile(a), b: w.sourceFile(b) }, before = { a: w.snapshot(a), b: w.snapshot(b) };
  w.host('off');
  const checkpoint = w.oats(['okf', 'harvest', '--no-launch'], { cwd: a, home: a });
  assert.equal(checkpoint.ok, false, JSON.stringify(checkpoint)); assert.equal(checkpoint.error.code, 'E_HARVEST_OFF');
  assert.match(checkpoint.error.message, /deployment's current switch is off/);
  assert.deepEqual(w.status(files.a).captured.inputs, [], 'nothing captured'); assert.equal(w.status(files.a).activeRun, null); assert.equal(w.harvesters(), 0, 'no harvester spawned');
  assert.deepEqual(w.snapshot(a), before.a, 'the home and its captured settings are unchanged');
  const retired = w.oats(['retire', 'src-b']);
  const meta = retired.capabilityMeta?.['oats.okf'];
  assert.equal(meta?.retired, true, JSON.stringify(retired)); assert.equal(meta.reason, 'harvest-off'); assert.equal(meta.capture, undefined, 'no final capture');
  assert.deepEqual(w.status(files.b).captured.inputs, [], 'the retirement captured nothing'); assert.equal(w.status(files.b).drain, undefined); assert.equal(w.harvesters(), 0);
  // Control: the deployment on again, the same old home harvests.
  w.host('on');
  const on = w.oats(['okf', 'harvest', '--no-launch'], { cwd: a, home: a });
  assert.equal(on.result?.status, 'started', JSON.stringify(on)); assert.equal(on.result.launched, false);
  assert.equal(w.status(files.a).captured.inputs.length, 1); assert.equal(w.harvesters(), 1);
});

test('4.2.0 real home dispatch: an explicit source spawn override admits its own first batch with the deployment off; an absolute soul opt-out published after the spawn stops it', { skip }, t => {
  const w = workspace(t);
  w.host('off');
  const c = w.spawn('src-c', ['--provider', 'oats.okf', 'harvest=on']);
  assert.deepEqual(w.captured(c), { harvest: 'on', origin: 'spawn' }, 'the kernel records the override as the spawn\'s');
  w.note(c);
  const admitted = w.oats(['okf', 'harvest', '--no-launch'], { cwd: c, home: c });
  assert.equal(admitted.result?.status, 'started', JSON.stringify(admitted)); assert.equal(w.harvesters(), 1);
  // The soul opts out after the spawn: absolute, whatever the deployment or a spawn says.
  w.host('on');
  const d = w.spawn('src-d'); w.note(d);
  w.publishSoul('knowledge:\n  harvest: off\n');
  const optedOut = w.oats(['okf', 'harvest', '--no-launch'], { cwd: d, home: d });
  assert.equal(optedOut.ok, false, JSON.stringify(optedOut)); assert.equal(optedOut.error.code, 'E_HARVEST_OFF'); assert.match(optedOut.error.message, /soul opts out/);
  assert.deepEqual(w.status(w.sourceFile(d)).captured.inputs, []); assert.equal(w.harvesters(), 1, 'no second harvester');
});

test('4.2.0 real home dispatch: when the deployment\'s switch cannot be read, the old home\'s checkpoint and retire hook capture nothing and certify no retirement', { skip }, t => {
  const w = workspace(t);
  const a = w.spawn('src-a'); w.note(a);
  const file = w.sourceFile(a), before = w.snapshot(a);
  // The deployment's own settings are unreadable now; the home's snapshot still says on.
  w.breakDeployment();
  const checkpoint = w.oats(['okf', 'harvest', '--no-launch'], { cwd: a, home: a });
  assert.equal(checkpoint.ok, false, JSON.stringify(checkpoint)); assert.equal(checkpoint.error.code, 'E_HARVEST_CONSENT_UNKNOWN');
  assert.deepEqual(w.status(file).captured.inputs, []); assert.equal(w.harvesters(), 0); assert.deepEqual(w.snapshot(a), before);
  w.restoreDeployment();
  w.breakDeployment();
  const retired = w.oats(['retire', 'src-a'], { cwd: a });
  w.restoreDeployment();
  // The kernel ran the okf retire hook, which refused: the home is not removed.
  assert.equal(retired.removedDir, false, JSON.stringify(retired)); assert.notEqual(retired.capabilityMeta?.['oats.okf']?.retired, true);
  assert.ok((retired.rollbackIncomplete || []).some(line => /retire hook oats\.okf: .*E_HARVEST_CONSENT_UNKNOWN/.test(line)), JSON.stringify(retired));
  assert.equal(fs.existsSync(a), true, 'the home is kept'); assert.equal(w.status(file).retired, false); assert.equal(w.status(file).harvestOff, undefined);
  assert.deepEqual(w.status(file).captured.inputs, []); assert.equal(w.harvesters(), 0);
});
