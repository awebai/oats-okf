import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { nativeCapture, consumeAttempt, gatePath, captureRoot, RECEIPT_LIMIT } from '../oats-package/capabilities/oats-okf/lib/capture-attempt.mjs';
import { save } from '../oats-package/capabilities/oats-okf/lib/io.mjs';
const moduleURL = new URL('../oats-package/capabilities/oats-okf/lib/capture-attempt.mjs', import.meta.url).href;
const waitFor = async fn => {
  const end = Date.now() + 15000;
  while (!fn()) { if (Date.now() > end) assert.fail('fixture process did not reach expected state'); await new Promise(r => setTimeout(r, 20)); }
};
function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'okf-attempt-'))), old = { ...process.env };
  t.after(() => { for (const k of Object.keys(process.env)) delete process.env[k]; Object.assign(process.env, old); fs.rmSync(root, { recursive: true, force: true }); });
  const cli = join(root, 'kernel.mjs');
  fs.writeFileSync(cli, `#!${process.execPath}
import fs from 'node:fs';import {join} from 'node:path';
const root=process.env.FIXTURE_CAPTURE,home=process.argv[process.argv.indexOf('--home')+1];
fs.appendFileSync(join(root,'calls'),JSON.stringify({home,pid:process.pid,root:process.env.TURN_RECORD_ROOT,identity:process.env.OATS_INSTANCE_HOME??null})+'\\n');
while(fs.existsSync(join(root,'hold'))) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,20);
const mode=fs.existsSync(join(root,'mode'))?fs.readFileSync(join(root,'mode'),'utf8'):'complete';
const r={home,owner:process.env.TURN_RECORD_OWNER,status:mode,complete:mode==='complete',sourceRoots:'launch-history',sessions:[]};
if(mode==='skipped')r.skipped=true;
if(mode==='malformed')console.log('{');
else if(mode==='overflow')process.stdout.write('x'.repeat(${RECEIPT_LIMIT + 1}));
else {if(mode==='foreign')r.home='/foreign';console.log(JSON.stringify(r));}
if(mode==='failed')process.exitCode=1;
fs.appendFileSync(join(root,'ended'),home+'\\n');
`, { mode: 0o700 });
  Object.assign(process.env, { FIXTURE_CAPTURE: root, TURN_RECORD_ROOT: join(root, 'record'), TURN_RECORD_OWNER: 'fixture', OATS_CLI_BIN: cli, OATS_INSTANCE_HOME: '/must-be-cleaned' });
  const source = name => {
    const home = join(root, name), id = randomUUID(), file = join(root, name + '-state', 'source.json');
    fs.mkdirSync(home, { recursive: true, mode: 0o700 });
    save(join(home, 'instance.json'), { instance: name, launched: true });
    const s = { id, home, context: root, file }; save(file, { id, home, context: root }); return s;
  };
  const calls = () => fs.existsSync(join(root, 'calls')) ? fs.readFileSync(join(root, 'calls'), 'utf8').trim().split('\n').map(JSON.parse) : [];
  const attemptDir = r => join(dirname(r.attempt.source.file), 'capture-attempts', r.attempt.id);
  const receipt = r => fs.existsSync(join(attemptDir(r), 'receipt.json'));
  const observe = (s, ms = 50, extra = {}) => nativeCapture(s, { deadline: Date.now() + ms, ...extra });
  return { root, source, calls, observe, receipt, attemptDir };
}
test('bounded foreground return leaves native alive; restart/duplicate observes one attempt and preserves private receipts', async t => {
  const f = fixture(t), s = f.source('one'); fs.writeFileSync(join(f.root, 'hold'), '');
  const start = Date.now(), first = f.observe(s);
  assert.equal(first.observation.status, 'running'); assert.ok(Date.now() - start < 1500);
  assert.ok(first.observation.budgetSeconds <= .05); assert.match(first.observation.reason, /budget.*native capture continues/);
  await waitFor(() => f.calls().length === 1);
  const again = f.observe(s); assert.equal(again.attempt.id, first.attempt.id); assert.equal(f.calls().length, 1);
  const code = `import {nativeCapture} from ${JSON.stringify(moduleURL)};console.log(JSON.stringify(nativeCapture(${JSON.stringify(s)},{deadline:Date.now()+30})));`;
  const restarted = spawnSync(process.execPath, ['--input-type=module', '-e', code], { env: process.env, encoding: 'utf8' });
  assert.equal(restarted.status, 0, restarted.stderr); assert.equal(JSON.parse(restarted.stdout).attempt.id, first.attempt.id);
  assert.equal(f.calls().length, 1); assert.equal(f.calls()[0].identity, null);
  fs.rmSync(join(f.root, 'hold')); await waitFor(() => f.receipt(first));
  const done = f.observe(s); assert.equal(done.report.complete, true); assert.equal(done.attempt.id, first.attempt.id);
  assert.ok(!fs.existsSync(gatePath(process.env.TURN_RECORD_ROOT)));
  const file = join(f.attemptDir(done), 'receipt.json'); assert.equal(fs.statSync(file).mode & 0o077, 0);
  consumeAttempt(s, done.attempt); assert.ok(fs.existsSync(file));
  const next = f.observe(s, 5000); assert.notEqual(next.attempt.id, done.attempt.id); assert.equal(next.report.complete, true);
});
test('two state directories and canonical root aliases serialize and resume only on explicit retry', async t => {
  const f = fixture(t), one = f.source('one'), two = f.source('two'); fs.writeFileSync(join(f.root, 'hold'), '');
  const first = f.observe(one); await waitFor(() => f.calls().length === 1);
  const alias = join(f.root, 'alias'); fs.symlinkSync(process.env.TURN_RECORD_ROOT, alias); process.env.TURN_RECORD_ROOT = alias;
  assert.equal(captureRoot(f.root), join(f.root, 'record'));
  const second = f.observe(two); assert.equal(second.observation.status, 'queued'); assert.equal(f.calls().length, 1);
  fs.rmSync(join(f.root, 'hold')); await waitFor(() => f.receipt(first) && !fs.existsSync(gatePath(first.attempt.root)));
  assert.equal(f.calls().length, 1, 'queue has no resident dispatcher');
  const resumed = f.observe(two, 5000); assert.equal(resumed.attempt.id, second.attempt.id); assert.equal(resumed.report.complete, true);
  assert.deepEqual(f.calls().map(c => c.home), [one.home, two.home]);
});
test('native exit0 skipped and nonzero failed receipts defer; malformed, substituted and overflowing receipts remain uncertain', async t => {
  const f = fixture(t);
  for (const mode of ['skipped', 'failed', 'incomplete', 'held', 'malformed', 'foreign', 'overflow']) {
    const s = f.source(mode); fs.writeFileSync(join(f.root, 'mode'), mode);
    const r = f.observe(s); await waitFor(() => f.receipt(r));
    if (['malformed', 'foreign', 'overflow'].includes(mode)) {
      assert.throws(() => f.observe(s), { code: 'E_CAPTURE_UNCERTAIN' });
      assert.throws(() => f.observe(s), { code: 'E_CAPTURE_UNCERTAIN' });
    } else {
      const read = f.observe(s); assert.equal(read.report.complete, false); assert.equal(read.report.status, mode);
      const receipt = JSON.parse(fs.readFileSync(join(f.attemptDir(r), 'receipt.json')));
      assert.equal(receipt.exitCode, mode === 'failed' ? 1 : 0);
      consumeAttempt(s, read.attempt);
    }
    assert.ok(fs.existsSync(s.home));
  }
  assert.equal(f.calls().length, 7);
});
test('dead runner/PID and missing gate ownership never authorize duplicate dispatch or kernel-lock removal', async t => {
  const f = fixture(t), s = f.source('one'); fs.writeFileSync(join(f.root, 'hold'), '');
  const first = f.observe(s); await waitFor(() => f.calls().length === 1);
  const runner = JSON.parse(fs.readFileSync(join(f.attemptDir(first), 'runner.json')));
  process.kill(runner.pid, 'SIGKILL');
  const kernelLock = join(process.env.TURN_RECORD_ROOT, '.capture.lock'); fs.mkdirSync(kernelLock);
  save(join(kernelLock, 'owner.json'), { pid: f.calls()[0].pid, token: 'native-lock' });
  const again = f.observe(s); assert.equal(again.attempt.id, first.attempt.id); assert.equal(f.calls().length, 1);
  assert.ok(fs.existsSync(kernelLock));
  const other = f.observe(f.source('other')); assert.equal(other.observation.status, 'queued');
  // The controller lets the orphan native process end naturally; the provider
  // cannot infer completion from it, because the runner died before receipt.
  fs.rmSync(join(f.root, 'hold')); await waitFor(() => fs.existsSync(join(f.root, 'ended')));
  assert.equal(f.receipt(first), false); assert.equal(f.observe(s).attempt.id, first.attempt.id); assert.equal(f.calls().length, 1);
});
test('receipt identity, hardlinks, symlinks and changed source launch proof fail closed', async t => {
  const f = fixture(t), s = f.source('one'), first = f.observe(s); await waitFor(() => f.receipt(first));
  const file = join(f.attemptDir(first), 'receipt.json'), original = fs.readFileSync(file), receipt = JSON.parse(original);
  save(file, { ...receipt, attempt: randomUUID() }); assert.throws(() => f.observe(s), { code: 'E_CAPTURE_UNCERTAIN' });
  fs.writeFileSync(file, original); fs.linkSync(file, join(f.root, 'hardlink')); assert.throws(() => f.observe(s), { code: 'E_CAPTURE_UNCERTAIN' }); fs.rmSync(join(f.root, 'hardlink'));
  fs.renameSync(file, file + '.original'); fs.symlinkSync(file + '.original', file); assert.throws(() => f.observe(s)); fs.rmSync(file); fs.renameSync(file + '.original', file);
  save(join(s.home, 'instance.json'), { instance: 'replacement', launched: true }); assert.throws(() => f.observe(s), { code: 'E_CAPTURE_UNCERTAIN' });
  assert.equal(f.calls().length, 1);
});
test('foreground process death preserves dispatch and receipt for a new caller', async t => {
  const f = fixture(t), s = f.source('one'); fs.writeFileSync(join(f.root, 'hold'), '');
  const code = `import {nativeCapture} from ${JSON.stringify(moduleURL)};nativeCapture(${JSON.stringify(s)},{deadline:Date.now()+30000});`;
  const foreground = spawn(process.execPath, ['--input-type=module', '-e', code], { env: process.env, stdio: 'ignore' });
  await waitFor(() => f.calls().length === 1);
  const exited = new Promise(resolve => foreground.once('exit', resolve)); foreground.kill('SIGKILL'); await exited;
  const observed = f.observe(s); assert.equal(f.calls().length, 1);
  fs.rmSync(join(f.root, 'hold')); await waitFor(() => f.receipt(observed));
  assert.equal(f.observe(s).report.complete, true); assert.equal(f.calls().length, 1);
});
