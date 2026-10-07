// #55: CI-only real released kernel, real external --repo and scheduler.
// No model, messaging provider, host timer, or production deployment.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cli = process.env.OATS_OKF_SCHEDULE_CLI;
const root = fileURLToPath(new URL('../', import.meta.url));
const write = (file, text) => { fs.mkdirSync(dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));

test('4.1.2 real OATS 0.41 external-repo spawn, scheduler setup/inspect and retire use the deployment', { skip: !cli }, t => {
  const base = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'okf-schedule-scope-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const bin = join(base, 'bin'); fs.mkdirSync(bin); fs.mkdirSync(join(base, 'user'));
  fs.symlinkSync(process.execPath, join(bin, 'node'));
  fs.symlinkSync(execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim(), join(bin, 'git'));
  for (const name of ['pi', 'claude', 'codex']) { write(join(bin, name), '#!/bin/sh\necho NO_MODELS_IN_FIXTURE >&2\nexit 98\n'); fs.chmodSync(join(bin, name), 0o755); }
  const env = { HOME: join(base, 'user'), PATH: `${bin}:/usr/bin:/bin`, OATS_HOME_DIR: join(base, 'host'), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
  const git = (cwd, args) => execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', ...args], { cwd, env, encoding: 'utf8' }).trim();
  const repo = (dir, remote) => {
    git(dir, ['init', '-q', '-b', 'main']); git(dir, ['add', '-A']); git(dir, ['commit', '-qm', 'fixture']);
    execFileSync('git', ['clone', '-q', '--bare', dir, remote], { env }); return git(dir, ['rev-parse', 'HEAD']);
  };
  fs.cpSync(process.env.OATS_OKF_SCHEDULE_PAYLOAD || join(root, 'oats-package'), join(base, 'pkg/oats-package'), { recursive: true, verbatimSymlinks: true });
  const pkg = repo(join(base, 'pkg'), join(base, 'pkg.git'));
  const ws = join(base, 'ws'), soul = join(ws, 'souls/source');
  write(join(ws, 'oats-workspace.yaml'), `schemaVersion: 2\nname: schedule-scope\nmembers:\n  - file://${base}/ws.git\npackages:\n  oats.okf: git:file://${base}/pkg.git@${pkg}\ndefaults:\n  capabilities:\n    oats.core: off\n  knowledge: { oats.okf: { from: package } }\n  messaging: none\n  tasks: none\n`);
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
  const oats = (args, cwd = dep) => {
    const out = spawnSync(process.execPath, [cli, ...args, '--json'], { cwd, env, encoding: 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024 });
    assert.equal(out.status, 0, `${args.join(' ')}\n${out.stdout}\n${out.stderr}`); return JSON.parse(out.stdout);
  };
  assert.equal(oats(['version']).version, '0.41.0', 'this regression qualifies the old supported kernel, not a newer checkout');
  assert.equal(fs.existsSync(join(external, 'oats-local.yaml')), false);
  assert.equal(fs.existsSync(join(base, 'oats-local.yaml')), false, 'walking up from external repo cannot find the deployment');
  oats(['sync']);
  oats(['okf', 'init', '--base', 'project', '--nodes', join(base, 'nodes.json'), '--confirm', '--soul', 'source']);
  const spawned = oats(['spawn', 'source', '--repo', external, '--name', 'external-seat', '--no-launch']).result;
  const home = spawned.home;
  assert.equal(spawned.launched, false);
  const marker = json(join(home, '.okf-source.json')), source = json(marker.source), descriptor = fs.readFileSync(marker.source);
  assert.equal(source.context, fs.realpathSync(external), 'repository context stays external');
  assert.equal(source.work, fs.realpathSync(join(home, 'work')));
  const id = `okf-${source.id}`, spec = json(join(dirname(marker.source), 'schedule.json'));
  assert.equal(spec.cwd, dep, 'the real kernel requires a command-job cwd inside the deployment');
  assert.ok(spec.argv.includes(marker.source));
  const job = () => oats(['schedule', 'list', '--dir', dep]).result.schedules.find(row => row.id === id);
  assert.equal(job().enabled, true);
  // The released provider verb is setup, not an invented `okf schedule` alias.
  oats(['okf', 'setup', '--disable'], home); assert.equal(job().enabled, false);
  oats(['okf', 'setup', '--source', marker.source, '--enable', '--soul', 'source']); assert.equal(job().enabled, true);
  const inspect = oats(['okf', 'inspect', '--source', marker.source, '--soul', 'source']).result;
  assert.equal(inspect.scheduler.error, undefined);
  assert.notEqual(inspect.scheduler.installed, true); assert.notEqual(inspect.scheduler.active, true);
  oats(['retire', 'external-seat', '--plan']);
  oats(['retire', 'external-seat']);
  assert.equal(fs.existsSync(home), false, 'real retire completed, not a failed-hook compensation');
  assert.equal(job(), undefined, 'drained source job is removed');
  const status = json(join(dirname(marker.source), 'status.json'));
  assert.equal(status.retired, true); assert.equal(status.schedule.removed, true);
  assert.deepEqual(fs.readFileSync(marker.source), descriptor, 'retire never rewrites repository context');
});
