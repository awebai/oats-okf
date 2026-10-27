import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { inventory, noEffectsPreload } from './helpers/no-effects.mjs';
// okf #106: the upgrade hook OATS 0.68's `oats instance upgrade` runs
// when a stopped home's oats.okf module moves. The homes here are made by the
// released v4.0.5 code itself (archived from history), so they carry exactly
// what that release recorded; then this tree's hook plans and applies the move
// under a preload that refuses every write and child process.
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const CAP = 'oats-package/capabilities/oats-okf';
const CLI = join(ROOT, CAP, 'bin/oats-okf.mjs');
const put = (p, text) => { fs.mkdirSync(dirname(p), { recursive: true }); fs.writeFileSync(p, text); };
const readJSON = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const save = (p, value) => put(p, JSON.stringify(value, null, 2) + '\n');

const releases = new Map();
/** The released capability at `tag`, archived from this repository's history once per process. */
function released(tag) {
  if (!releases.has(tag)) {
    const dir = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), `okf-${tag}-`)));
    process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));
    execFileSync('tar', ['-x', '-C', dir], { input: execFileSync('git', ['archive', tag, CAP], { cwd: ROOT }) });
    releases.set(tag, join(dir, CAP, 'bin/oats-okf.mjs'));
  }
  return releases.get(tag);
}

function fixture(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'okf-upgrade-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const bin = join(dir, 'bin'), context = join(dir, 'context'), soul = join(context, 'souls/source'), home = join(context, 'agents/source/instances/source-one');
  fs.mkdirSync(bin, { recursive: true }); fs.mkdirSync(join(home, 'work'), { recursive: true }); fs.mkdirSync(join(dir, 'user'));
  fs.symlinkSync(process.execPath, join(bin, 'node'));
  // The kernel CLI as okf <= 4.1 calls it at a harvest-on spawn: it registers
  // the source's scheduler job and answers its definition. Nothing else.
  const calls = join(dir, 'calls.jsonl'), fake = join(bin, 'oats');
  put(fake, `#!${process.execPath}
import * as fs from 'node:fs';
const a=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify(a)+'\\n');
if(a[0]==='schedule' && a[1]==='add') {const spec=JSON.parse(fs.readFileSync(a[a.indexOf('--file')+1],'utf8'));console.log(JSON.stringify({schemaVersion:1,ok:true,result:{schedule:spec}}));}
else {console.error('unexpected oats call '+JSON.stringify(a));process.exit(90);}
`); fs.chmodSync(fake, 0o755);
  put(join(soul, 'soul.yaml'), 'name: source\nwork: directory\n');
  put(join(soul, 'AGENTS.md'), '# Source\nDomain expert.\n');
  save(join(soul, 'okf.json'), { version: 1, owner: 'owner-1', owns: ['project/expert'], reads: ['project/peer'] });
  save(join(home, 'instance.json'), { instance: 'source-one', agent: 'source', repo: context, work: 'directory', kind: 'persistent' });
  const bindingFile = join(dir, 'bindings.json');
  save(bindingFile, { version: 1, stateDir: 'state', bases: { project: { id: 'base-1', kind: 'directory', path: 'base' } } });
  save(join(dir, 'nodes.json'), { expert: { path: 'expert', owner: 'owner-1' }, peer: { path: 'peer', owner: 'owner-2' } });
  const env = harvest => ({
    HOME: join(dir, 'user'), PATH: bin, OATS_HOME_DIR: join(dir, 'host-state'), OATS_CLI_BIN: fake,
    OATS_SETTINGS: JSON.stringify({ 'bindings-file': bindingFile, harvest }), OATS_SETTINGS_ORIGINS: '{}',
    OATS_SOUL: soul, OATS_CONTEXT: context, OATS_WORKSPACE: context, OATS_AGENT: 'source', OATS_INSTANCE: 'source-one',
    OATS_HOME: home, OATS_INSTANCE_HOME: home,
  });
  const run = (cli, args, extra = {}, { preload } = {}) => {
    const r = spawnSync(process.execPath, [...(preload ? ['--import', preload] : []), cli, ...args], { cwd: home, env: { ...env('off'), ...extra }, encoding: 'utf8', timeout: 30000 });
    let out; try { out = JSON.parse(r.stdout.trim().split('\n').at(-1)); } catch { /* reported by the caller's assertion */ }
    return { ...r, out };
  };
  /** A home spawned by `cli` with the deployment's harvest switch at `harvest`. */
  const spawn = (cli, harvest) => {
    const r = run(cli, ['spawn', '--json'], { ...env(harvest), OATS_EVENT: 'spawn' });
    assert.equal(r.status, 0, r.stdout + r.stderr); return r.out.meta;
  };
  const preload = noEffectsPreload(join(dir, 'user'));
  /** This tree's upgrade hook, as the kernel runs it, under the no-effects preload. */
  const upgrade = (phase, meta, extra = {}) => run(CLI, ['upgrade'], { OATS_EVENT: 'upgrade', OATS_UPGRADE_PHASE: phase, OATS_META: typeof meta === 'string' ? meta : JSON.stringify(meta), ...extra }, { preload });
  const init = cli => { const r = run(cli, ['init', '--base', 'project', '--nodes', join(dir, 'nodes.json'), '--confirm', '--json']); assert.equal(r.status, 0, r.stdout + r.stderr); };
  const callsMade = () => fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8').trim().split('\n').map(l => JSON.parse(l)) : [];
  return { dir, home, soul, context, bindingFile, run, spawn, upgrade, init, callsMade, env };
}
const marker = f => join(f.home, '.okf-source.json');
const record = f => join(f.home, '.okf-instance.json');
const respawn = /^respawn the instance: oats retire source-one, then oats spawn/;

test('upgrade hook: a 4.0.5 harvest-off home plans adopt and apply keeps its meta and its home exactly, with no effects', t => {
  const f = fixture(t), v405 = released('v4.0.5');
  f.init(v405);
  const meta = f.spawn(v405, 'off');
  assert.equal(meta.harvest, 'off'); assert.equal(fs.existsSync(marker(f)), false); assert.equal(readJSON(record(f)).harvest, 'off');
  const before = inventory(f.dir);
  const plan = f.upgrade('plan', meta);
  assert.equal(plan.status, 0, plan.stdout + plan.stderr); assert.equal(plan.stderr, ''); assert.deepEqual(plan.out, { adopt: true });
  const apply = f.upgrade('apply', meta);
  assert.equal(apply.status, 0, apply.stdout + apply.stderr); assert.equal(apply.stderr, ''); assert.deepEqual(apply.out, { meta });
  assert.deepEqual(inventory(f.dir), before, 'no byte of the home, custody or host changed');
  assert.deepEqual(f.callsMade(), [], 'no kernel call');
  // The adopted home consults as before, with harvest still off.
  const inspect = f.run(CLI, ['inspect', '--json']);
  assert.equal(inspect.status, 0, inspect.stdout + inspect.stderr); assert.equal(inspect.out.result.harvest.status, 'off');
});

test('upgrade hook: a 4.0.5 registered source plans adopt; apply records checkpoint for its schedule and names the job the operator removes', t => {
  const f = fixture(t), v405 = released('v4.0.5');
  f.init(v405);
  const meta = f.spawn(v405, 'on');
  assert.equal(meta.harvest, 'on'); assert.ok(meta.schedule, 'okf 4.0.5 records its scheduler job'); assert.equal(fs.existsSync(marker(f)), true);
  const { id } = readJSON(marker(f)), calls = f.callsMade().length, before = inventory(f.dir);
  const plan = f.upgrade('plan', meta);
  assert.equal(plan.status, 0, plan.stdout + plan.stderr); assert.deepEqual(plan.out, { adopt: true });
  const apply = f.upgrade('apply', meta);
  assert.equal(apply.status, 0, apply.stdout + apply.stderr);
  const { schedule, ...rest } = meta;
  assert.deepEqual(apply.out.meta, { ...rest, checkpoint: 'oats okf harvest' });
  assert.match(apply.out.warning, new RegExp(`oats schedule remove okf-${id} --dir ${f.context}`));
  assert.match(apply.out.warning, /README#upgrading-from-41/);
  assert.deepEqual(inventory(f.dir), before, 'custody and home unchanged'); assert.equal(f.callsMade().length, calls, 'the job is not touched');
  // Applying the migrated meta again is a no-op.
  assert.deepEqual(f.upgrade('apply', apply.out.meta).out, { meta: apply.out.meta });
});

test('upgrade hook: a 4.2 registered source keeps its meta', t => {
  const f = fixture(t);
  f.init(CLI);
  const meta = f.spawn(CLI, 'on');
  assert.equal(meta.checkpoint, 'oats okf harvest');
  assert.deepEqual(f.upgrade('plan', meta).out, { adopt: true });
  const apply = f.upgrade('apply', meta);
  assert.equal(apply.status, 0, apply.stdout + apply.stderr); assert.deepEqual(apply.out, { meta });
});

test('upgrade hook: a registered source whose custody no longer loads is refused, plan and apply', t => {
  const f = fixture(t), v405 = released('v4.0.5');
  f.init(v405);
  const meta = f.spawn(v405, 'on'), file = readJSON(marker(f)).source;
  for (const [what, damage, why] of [
    ['status', () => fs.rmSync(join(dirname(file), 'status.json')), /status/],
    ['descriptor', () => { const d = readJSON(file); d.bindingFingerprint = 'x'; save(file, d); }, /fingerprint/],
    ['home identity', () => { const d = readJSON(file); d.home = join(f.dir, 'elsewhere'); save(file, d); }, /home identity/],
  ]) {
    const kept = fs.readFileSync(file), status = fs.readFileSync(join(dirname(file), 'status.json'));
    damage();
    const plan = f.upgrade('plan', meta);
    assert.equal(plan.status, 0, what + plan.stdout + plan.stderr); assert.equal(plan.out.adopt, false, what);
    assert.match(plan.out.reason, why, what); assert.match(plan.out.remedy, /oats okf inspect --home/, what);
    const apply = f.upgrade('apply', meta);
    assert.equal(apply.status, 1, what); assert.equal(apply.out.meta, undefined, what); assert.match(apply.out.warning, why, what);
    fs.writeFileSync(file, kept); fs.writeFileSync(join(dirname(file), 'status.json'), status);
  }
  assert.deepEqual(f.upgrade('plan', meta).out, { adopt: true }, 'repaired custody adopts again');
});

test('upgrade hook: a captured home is refused: the hook has no binding snapshot to verify it against', t => {
  const f = fixture(t), v405 = released('v4.0.5');
  f.init(v405);
  const meta = f.spawn(v405, 'off');
  const doc = readJSON(join(f.home, 'instance.json'));
  save(join(f.home, 'instance.json'), { ...doc, executionBinding: { schemaVersion: 1, deployment: f.context, resolution: { schemaVersion: 1, id: `sha256-${'a'.repeat(64)}` } } });
  const plan = f.upgrade('plan', meta);
  assert.equal(plan.status, 0, plan.stdout + plan.stderr); assert.equal(plan.out.adopt, false);
  assert.match(plan.out.reason, /captured/); assert.match(plan.out.remedy, respawn);
  assert.equal(f.upgrade('apply', meta).status, 1);
});

test('upgrade hook: a service home adopts with its meta unchanged', t => {
  const f = fixture(t), v405 = released('v4.0.5');
  save(join(f.home, 'instance.json'), { ...readJSON(join(f.home, 'instance.json')), kind: 'capability' });
  const meta = f.spawn(v405, 'on');
  assert.deepEqual(meta, { memory: 'none' });
  assert.deepEqual(f.upgrade('plan', meta).out, { adopt: true });
  assert.deepEqual(f.upgrade('apply', meta).out, { meta });
});

test('upgrade hook: a home with neither a registered source nor a harvest-off record is refused, naming what it holds', t => {
  const f = fixture(t);
  const none = f.upgrade('plan', {});
  assert.equal(none.status, 0, none.stdout + none.stderr); assert.equal(none.out.adopt, false);
  assert.match(none.out.reason, /no registered okf source and no harvest-off record/); assert.match(none.out.remedy, respawn);
  put(join(f.home, '.okf-harvest-record.json'), '{}');
  const legacy = f.upgrade('plan', {});
  assert.equal(legacy.out.adopt, false); assert.match(legacy.out.reason, /legacy source watermarks/); assert.match(legacy.out.remedy, /oats okf migrate --source-home/);
  put(record(f), JSON.stringify({ version: 1, harvest: 'on' }));
  fs.rmSync(join(f.home, '.okf-harvest-record.json'));
  assert.equal(f.upgrade('plan', {}).out.adopt, false, 'a record that does not say harvest off is not a harvest-off home');
});

test('upgrade hook: malformed OATS_META is refused without echoing it; an unknown phase fails', t => {
  const f = fixture(t), v405 = released('v4.0.5');
  f.init(v405); f.spawn(v405, 'off');
  for (const meta of ['{secret', '[]', 'null', '"secret"']) {
    const r = f.upgrade('plan', meta);
    assert.equal(r.status, 0, r.stdout + r.stderr); assert.equal(r.out.adopt, false); assert.match(r.out.reason, /OATS_META/);
    assert.doesNotMatch(JSON.stringify(r.out), /secret/); assert.match(r.out.remedy, respawn);
  }
  const phase = f.upgrade('undo', { memory: 'okf-v2', harvest: 'off' });
  assert.equal(phase.status, 1); assert.match(phase.out.warning, /OATS_UPGRADE_PHASE must be plan or apply/);
});
