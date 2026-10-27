import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, delimiter } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { inventory, noEffectsPreload } from './fixtures/no-effects.mjs';
// okf #106: the upgrade hook OATS 0.68's `oats instance upgrade` runs when a
// stopped home's oats.okf module moves. The homes here are made by released
// code (archived from this repository's history), so they hold exactly what
// that release wrote; then this tree's hook plans and applies the move under a
// preload that refuses every write and child process.
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const CAP = 'oats-package/capabilities/oats-okf';
const CLI = join(ROOT, CAP, 'bin/oats-okf.mjs');
const GIT_DIR = (process.env.PATH || '').split(delimiter).find(d => d && fs.existsSync(join(d, 'git')));
const write = (file, text) => { fs.mkdirSync(dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
const json = (file, value) => write(file, JSON.stringify(value, null, 2) + '\n');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));

const releases = new Map();
/** The released oats.okf CLI at `tag`, archived from history once per process. */
function released(tag) {
  if (!releases.has(tag)) {
    const dir = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), `okf-${tag}-`)));
    process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));
    execFileSync('tar', ['-x', '-C', dir], { input: execFileSync('git', ['archive', tag, CAP], { cwd: ROOT }) });
    releases.set(tag, join(dir, CAP, 'bin/oats-okf.mjs'));
  }
  return releases.get(tag);
}

/** A deployment with one directory base and a soul, and an instance home spawned by
 *  the oats.okf CLI `cli` (4.x: with the deployment's harvest switch at `harvest`). */
function fixture(t, cli, { harvest, kind = 'persistent' } = {}) {
  const dir = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'okf5-upgrade-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const context = join(dir, 'context'), soul = join(context, 'souls/source'), home = join(context, 'agents/source/instances/source-one'), user = join(dir, 'user');
  fs.mkdirSync(join(home, 'work'), { recursive: true }); fs.mkdirSync(user);
  write(join(soul, 'soul.yaml'), 'schemaVersion: 2\nname: source\nwork: directory\n');
  write(join(soul, 'AGENTS.md'), '# Source\nDomain expert.\n');
  json(join(soul, 'okf.json'), { version: 1, owner: 'owner-1', owns: ['project/expert'], reads: ['project/peer'] });
  json(join(home, 'instance.json'), { instance: 'source-one', agent: 'source', repo: context, work: 'directory', kind });
  const bindingsFile = join(dir, 'bindings.json');
  json(bindingsFile, { version: 1, stateDir: join(dir, 'state'), bases: { project: { id: 'base-1', kind: 'directory', path: join(dir, 'base') } } });
  json(join(dir, 'nodes.json'), { expert: { path: 'expert', owner: 'owner-1' }, peer: { path: 'peer', owner: 'owner-2' } });
  // The settings the kernel records for the home at its spawn, and hands its hooks.
  const settings = JSON.stringify({ 'bindings-file': bindingsFile, ...(harvest ? { harvest } : {}) });
  const env = {
    HOME: user, PATH: [dirname(process.execPath), GIT_DIR].filter(Boolean).join(delimiter), OATS_HOME_DIR: join(user, '.oats'),
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', OATS_SETTINGS: settings, OATS_SETTINGS_ORIGINS: harvest ? JSON.stringify({ '/harvest': { kind: 'host', at: 'oats-local.yaml' } }) : '{}',
    OATS_SOUL: soul, OATS_CONTEXT: context, OATS_WORKSPACE: context, OATS_TEAM_SCOPE: context, OATS_AGENT: 'source', OATS_INSTANCE: 'source-one',
    OATS_HOME: home, OATS_INSTANCE_HOME: home,
  };
  const run = (bin, args, extra = {}, preload) => {
    const r = spawnSync(process.execPath, [...(preload ? ['--import', preload] : []), bin, ...args], { cwd: home, env: { ...env, ...extra }, encoding: 'utf8', timeout: 60000 });
    let out; try { out = JSON.parse(r.stdout.trim().split('\n').at(-1)); } catch { /* asserted by the caller */ }
    return { ...r, out };
  };
  const init = run(cli, ['init', '--base', 'project', '--nodes', join(dir, 'nodes.json'), '--confirm', '--json']);
  assert.equal(init.status, 0, init.stdout + init.stderr);
  const spawned = run(cli, ['spawn'], { OATS_EVENT: 'spawn' });
  assert.equal(spawned.status, 0, spawned.stdout + spawned.stderr);
  const preload = noEffectsPreload(user);
  /** This tree's upgrade hook as the kernel runs it, under the no-effects preload.
   *  `meta` is the home's recorded capabilityMeta for oats.okf ({} when it has none). */
  const upgrade = (phase, meta, extra = {}) => run(CLI, ['upgrade'], { OATS_EVENT: 'upgrade', OATS_UPGRADE_PHASE: phase, OATS_META: typeof meta === 'string' ? meta : JSON.stringify(meta), ...extra }, preload);
  return { dir, home, run, upgrade, meta: spawned.out?.meta ?? {} };
}
const policy = f => join(f.home, 'okf-harvest-policy.json');
const respawn = /^respawn the instance: oats retire source-one \(its own hooks run\), then oats spawn/;

test('upgrade hook: a 5.3.0 home plans adopt; apply returns its empty meta and changes nothing', t => {
  const f = fixture(t, released('v5.3.0'));
  assert.deepEqual(f.meta, {}, '5.x records no meta');
  assert.deepEqual(read(policy(f)), { version: 1, harvest: 'on', reason: 'default' });
  const before = inventory(f.dir);
  const plan = f.upgrade('plan', {});
  assert.equal(plan.status, 0, plan.stdout + plan.stderr); assert.equal(plan.stderr, ''); assert.deepEqual(plan.out, { adopt: true });
  const apply = f.upgrade('apply', {});
  assert.equal(apply.status, 0, apply.stdout + apply.stderr); assert.equal(apply.stderr, ''); assert.deepEqual(apply.out, { meta: {} });
  assert.deepEqual(inventory(f.dir), before, 'no byte of the home, base or host changed');
  // The adopted home reads its spawn policy as before.
  const status = f.run(CLI, ['status', '--json']);
  assert.equal(status.status, 0, status.stdout + status.stderr); assert.equal(status.out.result.harvest, 'on');
});

test('upgrade hook: a 5.1.0 home, spawned before the policy file, adopts and stays unknown', t => {
  const f = fixture(t, released('v5.1.0'));
  assert.equal(fs.existsSync(policy(f)), false, '5.1.0 writes no policy');
  const before = inventory(f.dir);
  assert.deepEqual(f.upgrade('plan', {}).out, { adopt: true });
  assert.deepEqual(f.upgrade('apply', {}).out, { meta: {} });
  assert.deepEqual(inventory(f.dir), before);
  assert.equal(f.run(CLI, ['status', '--json']).out.result.harvest, 'unknown');
});

test('upgrade hook: a 5.3.0 service home adopts', t => {
  const f = fixture(t, released('v5.3.0'), { kind: 'capability' });
  assert.equal(fs.existsSync(policy(f)), false);
  assert.deepEqual(f.upgrade('plan', {}).out, { adopt: true });
  assert.deepEqual(f.upgrade('apply', {}).out, { meta: {} });
});

test('upgrade hook: an invalid spawn policy is refused, plan and apply', t => {
  const f = fixture(t, released('v5.3.0'));
  json(policy(f), { version: 1, harvest: 'on', reason: 'operator' });
  const plan = f.upgrade('plan', {});
  assert.equal(plan.status, 0, plan.stdout + plan.stderr); assert.equal(plan.out.adopt, false);
  assert.match(plan.out.reason, /spawn policy is invalid/); assert.match(plan.out.remedy, respawn);
  const apply = f.upgrade('apply', {});
  assert.equal(apply.status, 1); assert.equal(apply.out.meta, undefined); assert.match(apply.out.warning, /spawn policy is invalid/);
});

for (const harvest of ['off', 'on']) test(`upgrade hook: a 4.2.2 home spawned with harvest ${harvest} is refused with the respawn remedy`, t => {
  const f = fixture(t, released('v4.2.2'), { harvest });
  assert.equal(f.meta.harvest, harvest, JSON.stringify(f.meta));
  assert.equal(fs.existsSync(join(f.home, harvest === 'on' ? '.okf-source.json' : '.okf-instance.json')), true);
  const before = inventory(f.dir);
  // The hook answers before any 5.x settings check: the home's recorded 4.x harvest key does not stop it.
  const plan = f.upgrade('plan', f.meta);
  assert.equal(plan.status, 0, plan.stdout + plan.stderr); assert.equal(plan.out.adopt, false);
  assert.match(plan.out.reason, /spawned by oats\.okf 4\.x/); assert.match(plan.out.remedy, respawn);
  const apply = f.upgrade('apply', f.meta);
  assert.equal(apply.status, 1); assert.match(apply.out.warning, /spawned by oats\.okf 4\.x/);
  assert.deepEqual(inventory(f.dir), before);
});

test('upgrade hook: any one 4.x sign refuses: a 4.x home file, or a recorded 4.x meta', t => {
  for (const name of ['.okf-source.json', '.okf-instance.json', '.okf-harvest-record.json', '.okf-harvest-record.next.json']) {
    const f = fixture(t, released('v5.3.0'));
    write(join(f.home, name), '{}');
    const plan = f.upgrade('plan', {});
    assert.equal(plan.out.adopt, false, name); assert.match(plan.out.reason, /spawned by oats\.okf 4\.x/, name);
  }
  const f = fixture(t, released('v5.3.0'));
  const plan = f.upgrade('plan', { memory: 'okf-v2', harvest: 'off', reason: 'x' });
  assert.equal(plan.out.adopt, false); assert.match(plan.out.reason, /spawned by oats\.okf 4\.x/);
});

test('upgrade hook: malformed OATS_META is refused without echoing it; an unknown phase fails', t => {
  const f = fixture(t, released('v5.3.0'));
  for (const meta of ['{secret', '[]', 'null', '"secret"']) {
    const r = f.upgrade('plan', meta);
    assert.equal(r.status, 0, r.stdout + r.stderr); assert.equal(r.out.adopt, false); assert.match(r.out.reason, /OATS_META/);
    assert.doesNotMatch(JSON.stringify(r.out), /secret/); assert.match(r.out.remedy, respawn);
  }
  const phase = f.upgrade('undo', {});
  assert.equal(phase.status, 1); assert.match(phase.out.warning, /OATS_UPGRADE_PHASE must be plan or apply/);
});
