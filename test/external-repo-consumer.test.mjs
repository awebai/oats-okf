// okf 4.2.0 (#55): CI-only, a real released kernel (0.41.0) with a source
// spawned on an external --repo. Its checkpoint goes all the way to the real
// harvester spawn (--no-launch), then the source retires. No model (the
// harnesses on PATH refuse to run, and record that they were asked), no
// messaging provider, host timer or production deployment.
// OATS_OKF_EXTERNAL_PAYLOAD replaces the package under test (CI runs the
// released v4.1.1 payload as the negative control).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cli = process.env.OATS_OKF_EXTERNAL_CLI;
const root = fileURLToPath(new URL('../', import.meta.url));
const write = (file, text) => { fs.mkdirSync(dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));

test('4.2.0 real OATS 0.41 external-repo source: checkpoint to the real harvester spawn and retire run in the deployment; no scheduler job, no model', { skip: !cli }, t => {
  const base = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'okf-external-repo-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const bin = join(base, 'bin'), asked = join(base, 'model-start-attempted'); fs.mkdirSync(bin); fs.mkdirSync(join(base, 'user'));
  fs.symlinkSync(process.execPath, join(bin, 'node'));
  fs.symlinkSync(execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim(), join(bin, 'git'));
  for (const name of ['pi', 'claude', 'codex']) { write(join(bin, name), `#!/bin/sh\necho ${name} >> '${asked}'\necho NO_MODELS_IN_FIXTURE >&2\nexit 98\n`); fs.chmodSync(join(bin, name), 0o755); }
  const env = { HOME: join(base, 'user'), PATH: `${bin}:/usr/bin:/bin`, OATS_HOME_DIR: join(base, 'host'), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
  const git = (cwd, args) => execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', ...args], { cwd, env, encoding: 'utf8' }).trim();
  const repo = (dir, remote) => {
    git(dir, ['init', '-q', '-b', 'main']); git(dir, ['add', '-A']); git(dir, ['commit', '-qm', 'fixture']);
    execFileSync('git', ['clone', '-q', '--bare', dir, remote], { env }); return git(dir, ['rev-parse', 'HEAD']);
  };
  fs.cpSync(process.env.OATS_OKF_EXTERNAL_PAYLOAD || join(root, 'oats-package'), join(base, 'pkg/oats-package'), { recursive: true, verbatimSymlinks: true });
  const pkg = repo(join(base, 'pkg'), join(base, 'pkg.git'));
  const ws = join(base, 'ws'), soul = join(ws, 'souls/source');
  write(join(ws, 'oats-workspace.yaml'), `schemaVersion: 2\nname: external-repo\nmembers:\n  - file://${base}/ws.git\npackages:\n  oats.okf: git:file://${base}/pkg.git@${pkg}\ndefaults:\n  capabilities:\n    oats.core: off\n  knowledge: { oats.okf: { from: package } }\n  messaging: none\n  tasks: none\n`);
  write(join(ws, 'oats-membership.yaml'), `schemaVersion: 2\nworkspace: file://${base}/ws.git\n`);
  write(join(soul, 'soul.yaml'), 'schemaVersion: 2\nname: source\ndescription: External repository fixture.\nwork: worktree\n');
  write(join(soul, 'AGENTS.md'), '# Source\nNo model or production operations in this fixture.\n');
  write(join(soul, 'okf.json'), JSON.stringify({ version: 1, owner: 'source-owner', owns: ['project/expert'], reads: [] }));
  repo(ws, join(base, 'ws.git'));
  const external = join(base, 'external-repo');
  execFileSync('git', ['clone', '-q', join(base, 'ws.git'), external], { env });
  const dep = join(base, 'deployment'), state = join(base, 'state');
  write(join(base, 'bindings.json'), JSON.stringify({ version: 1, stateDir: state, bases: { project: { id: 'test-base', kind: 'directory', path: join(base, 'accepted') } } }));
  write(join(base, 'nodes.json'), JSON.stringify({ expert: { path: 'expert', owner: 'source-owner' } }));
  write(join(dep, 'oats-local.yaml'), `schemaVersion: 2\nworkspace: file://${base}/ws.git\nsettings:\n  oats.okf:\n    bindings-file: ${base}/bindings.json\n    harvest: on\n`);
  const oats = (args, { cwd = dep, home } = {}) => {
    const out = spawnSync(process.execPath, [cli, ...args, '--json'], { cwd, env: home ? { ...env, OATS_INSTANCE_HOME: home, OATS_HOME: home } : env, encoding: 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024 });
    assert.equal(out.status, 0, `${args.join(' ')}\n${out.stdout}\n${out.stderr}`); return JSON.parse(out.stdout);
  };
  assert.equal(oats(['version']).version, '0.41.0', 'this regression qualifies the old supported kernel, not a newer checkout');
  assert.equal(fs.existsSync(join(external, 'oats-local.yaml')), false);
  assert.equal(fs.existsSync(join(base, 'oats-local.yaml')), false, 'walking up from the external repo cannot find the deployment');
  oats(['sync']);
  oats(['okf', 'init', '--base', 'project', '--nodes', join(base, 'nodes.json'), '--confirm', '--soul', 'source']);
  const spawned = oats(['spawn', 'source', '--repo', external, '--name', 'external-seat', '--no-launch']).result;
  const home = spawned.home;
  assert.equal(spawned.launched, false);
  const marker = json(join(home, '.okf-source.json')), source = json(marker.source), descriptor = fs.readFileSync(marker.source);
  assert.equal(source.context, fs.realpathSync(external), 'the repository context stays external');
  assert.equal(source.work, fs.realpathSync(join(home, 'work')));
  // An eligible note, then the working agent's explicit checkpoint from its home.
  write(join(home, 'notes/decision.md'), '---\ntype: Decision\ntitle: Explicit custody\ndescription: Why custody is explicit.\n---\n\nThe human chose explicit custody.\n');
  const checkpoint = oats(['okf', 'harvest', '--no-launch'], { cwd: home, home }).result;
  assert.equal(checkpoint.status, 'started', JSON.stringify(checkpoint)); assert.equal(checkpoint.launched, false);
  const harvesterHome = join(dep, 'agents/oats-okf--knowledge-harvester/instances', checkpoint.instance);
  assert.ok(fs.existsSync(join(harvesterHome, 'instance.json')), 'the real harvester was spawned in the deployment');
  const status = json(join(dirname(marker.source), 'status.json'));
  assert.equal(status.captured.inputs.length, 1, 'the note is in custody'); assert.equal(status.activeRun, checkpoint.run);
  const run = json(join(dirname(marker.source), 'runs', checkpoint.run, 'run.json'));
  assert.equal(run.noLaunch, true); assert.equal(run.worker.home, harvesterHome); assert.equal(run.launch, undefined, 'never launched');
  // The deployment's own view names the held run, with commands for the deployment, not the repository.
  const view = oats(['okf', 'harvest-status', '--soul', 'source']).result;
  const row = view.sources.find(r => r.file === marker.source);
  assert.ok(row?.outstanding.some(o => o.run === checkpoint.run), JSON.stringify(row));
  assert.equal(JSON.stringify(row.outstanding).includes(`cd ${fs.realpathSync(external)}`), false, 'no printed command runs from the repository');
  oats(['retire', 'external-seat', '--plan']);
  oats(['retire', 'external-seat']);
  assert.equal(fs.existsSync(home), false, 'real retire completed, not a failed-hook compensation');
  const after = json(join(dirname(marker.source), 'status.json'));
  assert.equal(after.retired, true); assert.equal(after.activeRun, checkpoint.run, 'the held run and its custody stay');
  assert.equal(after.captured.inputs.length >= 1, true);
  assert.deepEqual(fs.readFileSync(marker.source), descriptor, 'nothing rewrites the frozen descriptor or its repository context');
  const jobs = oats(['schedule', 'list', '--dir', dep]).result;
  assert.deepEqual(jobs.schedules, [], 'no scheduler job: none at spawn, none after the checkpoint or retirement');
  assert.notEqual(jobs.scheduler.installed, true, 'no host timer');
  assert.equal(fs.existsSync(asked), false, 'no harness was ever asked to start a model');
});
