import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import childProcess, { spawn, spawnSync } from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { fileURLToPath } from 'node:url';
import { nativeCapture, consumeAttempt, gatePath, captureRoot, releaseGate, settleCaptureOff, RECEIPT_LIMIT } from '../oats-package/capabilities/oats-okf/lib/capture-attempt.mjs';
import { save, hash } from '../oats-package/capabilities/oats-okf/lib/io.mjs';
const moduleURL = new URL('../oats-package/capabilities/oats-okf/lib/capture-attempt.mjs', import.meta.url).href;
const waitFor = async fn => {
  const end = Date.now() + 15000;
  while (!fn()) { if (Date.now() > end) assert.fail('fixture process did not reach expected state'); await new Promise(r => setTimeout(r, 20)); }
};
function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'okf-attempt-'))), old = { ...process.env };
  t.after(async () => {
    // Receipt publication can precede the runner's final metadata cleanup.
    // Wait only for fixture teardown; PID exit never certifies production custody.
    for(const file of fs.readdirSync(root,{recursive:true}).filter(p=>p.endsWith('/runner.json'))) {
      const {pid}=JSON.parse(fs.readFileSync(join(root,file)));
      await waitFor(()=>{try{process.kill(pid,0);return false;}catch(e){return e.code==='ESRCH';}});
    }
    for (const k of Object.keys(process.env)) delete process.env[k]; Object.assign(process.env, old); fs.rmSync(root, { recursive: true, force: true });
  });
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
  const calls = () => fs.existsSync(join(root, 'calls')) ? fs.readFileSync(join(root, 'calls'), 'utf8').split('\n').slice(0,-1).map(JSON.parse) : [];
  const attemptDir = r => join(dirname(r.attempt.source.file), 'capture-attempts', r.attempt.id);
  const receipt = r => fs.existsSync(join(attemptDir(r), 'receipt.json'));
  const observe = (s, ms = 50, extra = {}) => nativeCapture(s, { deadline: Date.now() + ms, ...extra });
  return { root, source, calls, observe, receipt, attemptDir };
}
test('bounded foreground return leaves native alive; restart/duplicate observes one attempt and preserves private receipts', async t => {
  const f = fixture(t), s = f.source('one'); fs.writeFileSync(join(f.root, 'hold'), '');
  const start = Date.now(), first = f.observe(s);
  assert.equal(first.observation.status, 'running'); assert.ok(Date.now() - start < 1500);
  assert.ok(first.observation.budgetSeconds <= .05);
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

test('kernel restart and post-spawn bookkeeping updates preserve in-flight receipt observation', async t => {
  const f = fixture(t), s = f.source('restart'); fs.writeFileSync(join(f.root, 'hold'), '');
  const first = f.observe(s);
  const metaFile = join(s.home, 'instance.json'), meta = JSON.parse(fs.readFileSync(metaFile));
  // This may land before runner validation, while native runs, or after its
  // receipt. None of these fields changes the identity of the same home.
  save(metaFile, { ...meta, startId: randomUUID(), restartCount: 1, restarts: ['first'], tmux: { session: 'new' }, launchPrompts: { status: 'completed' }, wake: { status: 'registered' }, spawnCompleted: true });
  await waitFor(() => f.calls().length === 1);
  save(metaFile, { ...JSON.parse(fs.readFileSync(metaFile)), restartCount: 2 });
  fs.rmSync(join(f.root, 'hold')); await waitFor(() => f.receipt(first));
  save(metaFile, { ...JSON.parse(fs.readFileSync(metaFile)), restartCount: 3 });
  assert.equal(f.observe(s).report.complete, true); consumeAttempt(s, first.attempt);
  assert.ok(!fs.existsSync(gatePath(first.attempt.root))); assert.equal(f.calls().length, 1);
});
test('kernel CLI replacement does not invalidate an existing native receipt', async t => {
  const f = fixture(t), s = f.source('upgrade'); fs.writeFileSync(join(f.root, 'hold'), '');
  const first = f.observe(s); await waitFor(() => f.calls().length === 1);
  const replacement = join(f.root, 'replacement.mjs'); fs.copyFileSync(process.env.OATS_CLI_BIN, replacement); fs.chmodSync(replacement, 0o700); process.env.OATS_CLI_BIN = replacement;
  fs.rmSync(join(f.root, 'hold')); await waitFor(() => f.receipt(first));
  assert.equal(f.observe(s).report.complete, true); consumeAttempt(s, first.attempt);
  assert.equal(f.observe(s, 5000).report.complete, true); assert.equal(f.calls().length, 2);
});
test('missing native executable is a closed not-dispatched result that frees the root for retry', async t => {
  const f = fixture(t), s = f.source('missing'), good = process.env.OATS_CLI_BIN;
  process.env.OATS_CLI_BIN = join(f.root, 'missing-executable');
  const first = f.observe(s); await waitFor(() => f.receipt(first));
  const result = f.observe(s); assert.equal(result.report.status, 'not-dispatched'); assert.equal(result.report.complete, false);
  assert.equal(JSON.parse(fs.readFileSync(join(f.attemptDir(first), 'receipt.json'))).nativeDispatched, false);
  assert.ok(!fs.existsSync(gatePath(first.attempt.root))); settleCaptureOff(s); consumeAttempt(s, first.attempt);
  process.env.OATS_CLI_BIN = good; assert.equal(f.observe(s, 5000).report.complete, true); assert.equal(f.calls().length, 1);
});
test('proven runner spawn failures are retryable without blocking other sources', async t => {
  const f = fixture(t), s = f.source('bootstrap'), original = childProcess.spawn;
  for (const behavior of [() => { throw new Error('spawn refused'); }, () => ({ pid: undefined, on() { return this; }, unref() {} })]) {
    let result;
    try {
      childProcess.spawn = behavior; syncBuiltinESMExports(); result = f.observe(s, 5000);
    } finally { childProcess.spawn = original; syncBuiltinESMExports(); }
    assert.equal(result.report.status, 'not-dispatched'); assert.ok(!fs.existsSync(gatePath(result.attempt.root))); consumeAttempt(s, result.attempt);
  }
  assert.equal(f.observe(f.source('other'), 5000).report.complete, true); assert.equal(f.calls().length, 1);
});
test('failure before atomic gate publication leaves no ownerless gate and permits retry', async t => {
  const f = fixture(t), s = f.source('publication'), rename = fs.renameSync;
  try {
    fs.renameSync = (from, to) => { if (to === gatePath(process.env.TURN_RECORD_ROOT)) throw Object.assign(new Error('publication failed'), { code: 'EIO' }); return rename(from, to); }; syncBuiltinESMExports();
    assert.throws(() => f.observe(s), { code: 'E_CAPTURE_UNCERTAIN' });
  } finally { fs.renameSync = rename; syncBuiltinESMExports(); }
  assert.ok(!fs.existsSync(gatePath(process.env.TURN_RECORD_ROOT)));
  assert.equal(f.observe(s, 5000).report.complete, true); assert.equal(f.calls().length, 1);
});
test('runner validation before native spawn records no-dispatch but a duplicate runner cannot overwrite a live attempt', async t => {
  const f = fixture(t), s = f.source('changed');
  const preload = join(f.root, 'hold-runner.mjs'), hold = join(f.root, 'hold-bootstrap'), ready = join(f.root, 'bootstrap-ready');
  fs.writeFileSync(hold, '');
  fs.writeFileSync(preload, `import fs from 'node:fs';if(process.argv[1]?.endsWith('/capture-runner.mjs')){fs.writeFileSync(${JSON.stringify(ready)},'');while(fs.existsSync(${JSON.stringify(hold)}))Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,20);}`);
  process.env.NODE_OPTIONS = `--import=${preload}`;
  const first = f.observe(s); await waitFor(() => fs.existsSync(ready));
  save(join(s.home, 'instance.json'), { instance: 'reused-home', launched: true });
  fs.rmSync(hold); await waitFor(() => f.receipt(first)); delete process.env.NODE_OPTIONS;
  const failed = JSON.parse(fs.readFileSync(join(f.attemptDir(first), 'receipt.json')));
  assert.equal(failed.nativeDispatched, false); assert.equal(failed.reason, 'source-changed'); assert.equal(f.calls().length, 0);
  await waitFor(() => !fs.existsSync(gatePath(first.attempt.root)));
  const other = f.source('other'); fs.writeFileSync(join(f.root, 'hold'), ''); const live = f.observe(other); await waitFor(() => f.calls().length === 1);
  const runner = fileURLToPath(new URL('../oats-package/capabilities/oats-okf/lib/capture-runner.mjs', import.meta.url));
  const duplicate = spawnSync(process.execPath, [runner, f.attemptDir(live)], { env: process.env, encoding: 'utf8' });
  assert.equal(duplicate.status, 1); assert.equal(f.receipt(live), false); assert.ok(fs.existsSync(gatePath(live.attempt.root))); assert.equal(f.calls().length, 1);
  fs.rmSync(join(f.root, 'hold')); await waitFor(() => f.receipt(live)); assert.equal(f.observe(other).report.complete, true);
});

test('partial cleanup after atomic gate release cannot strand the published root gate', async t => {
  const f=fixture(t),s=f.source('released'),first=f.observe(s);await waitFor(()=>f.receipt(first)&&!fs.existsSync(gatePath(first.attempt.root)));
  // Simulate a runner that published its terminal receipt but had not yet
  // removed its gate. The controller interrupts recursive cleanup after unlink.
  const gate=gatePath(first.attempt.root);fs.mkdirSync(gate,{mode:0o700});save(join(gate,'owner.json'),{version:1,attempt:first.attempt.id,directory:f.attemptDir(first),requestHash:hash(first.attempt)});
  const rm=fs.rmSync;let interrupted=false;
  try {
    fs.rmSync=(path,options)=>{if(String(path).includes('/.released-')){interrupted=true;rm(join(path,'owner.json'));throw Object.assign(new Error('partial cleanup'),{code:'EIO'});}return rm(path,options);};syncBuiltinESMExports();
    releaseGate(f.attemptDir(first),first.attempt);
  } finally {fs.rmSync=rm;syncBuiltinESMExports();}
  assert.equal(interrupted,true);assert.equal(fs.existsSync(gate),false);
  assert.equal(f.observe(f.source('next'),5000).report.complete,true);assert.equal(f.calls().length,2);
});

test('consent-off settles a provably queued request without touching another sources native attempt',async t=>{
  const f=fixture(t),one=f.source('running'),two=f.source('queued');fs.writeFileSync(join(f.root,'hold'),'');
  const active=f.observe(one);await waitFor(()=>f.calls().length===1);const queued=f.observe(two);assert.equal(queued.observation.status,'queued');
  assert.deepEqual(queued.observation.blocker,{attempt:active.attempt.id,state:'uncertain'});
  const gate=gatePath(active.attempt.root),owner=fs.readFileSync(join(gate,'owner.json'));
  settleCaptureOff(two);assert.equal(fs.existsSync(join(f.attemptDir(queued),'dispatch.json')),false);
  assert.equal(JSON.parse(fs.readFileSync(join(f.attemptDir(queued),'consumed.json'))).settlement,'settled-under-harvest-off');
  assert.deepEqual(fs.readFileSync(join(gate,'owner.json')),owner);assert.equal(f.calls().length,1);settleCaptureOff(two);
  fs.rmSync(join(f.root,'hold'));await waitFor(()=>f.receipt(active)&&!fs.existsSync(gate));
});
test('consent-off retains running, corrupt, foreign and overflowed native receipts',async t=>{
  const f=fixture(t),s=f.source('unsettled');fs.writeFileSync(join(f.root,'hold'),'');const active=f.observe(s);await waitFor(()=>f.calls().length===1);
  assert.throws(()=>settleCaptureOff(s),{code:'E_CAPTURE_PENDING'});
  const meta=JSON.parse(fs.readFileSync(join(s.home,'instance.json')));save(join(s.home,'instance.json'),{...meta,instance:'replacement'});assert.throws(()=>settleCaptureOff(s),{code:'E_CAPTURE_UNCERTAIN'});save(join(s.home,'instance.json'),meta);
  fs.rmSync(join(f.root,'hold'));
  await waitFor(()=>f.receipt(active)&&!fs.existsSync(gatePath(active.attempt.root)));
  const dir=f.attemptDir(active),file=join(dir,'receipt.json'),good=JSON.parse(fs.readFileSync(file));
  for(const bad of [{...good,overflow:true},{...good,stdout:'{'},{...good,stdout:JSON.stringify({...JSON.parse(good.stdout),home:'/foreign'})},{...good,attempt:randomUUID()}]) {
    save(file,bad);assert.throws(()=>settleCaptureOff(s),{code:'E_CAPTURE_UNCERTAIN'});assert.equal(fs.existsSync(join(dir,'consumed.json')),false);
  }
  save(file,good);settleCaptureOff(s);assert.equal(f.calls().length,1);assert.equal(fs.existsSync(file),true);
});
test('consent-off does not mistake own unpublished dispatch or redirected metadata for a queued request',async t=>{
  const f=fixture(t),one=f.source('one'),two=f.source('two');fs.writeFileSync(join(f.root,'hold'),'');const active=f.observe(one);await waitFor(()=>f.calls().length===1);const queued=f.observe(two);
  fs.rmSync(join(f.root,'hold'));await waitFor(()=>f.receipt(active)&&!fs.existsSync(gatePath(active.attempt.root)));
  const gate=gatePath(queued.attempt.root),dir=f.attemptDir(queued);fs.mkdirSync(gate,{mode:0o700});save(join(gate,'owner.json'),{version:1,attempt:queued.attempt.id,directory:dir,requestHash:hash(queued.attempt)});
  assert.throws(()=>settleCaptureOff(two),{code:'E_CAPTURE_PENDING'});assert.equal(fs.existsSync(join(dir,'consumed.json')),false);
  fs.writeFileSync(join(gate,'owner.json'),'{');assert.throws(()=>settleCaptureOff(two),{code:'E_CAPTURE_UNCERTAIN'});fs.rmSync(gate,{recursive:true});
  fs.symlinkSync(join(f.root,'absent'),join(dir,'runner.json'));assert.throws(()=>settleCaptureOff(two),{code:'E_CAPTURE_UNCERTAIN'});fs.rmSync(join(dir,'runner.json'));
  const current=join(dirname(dir),'current.json'),pointer=JSON.parse(fs.readFileSync(current));save(join(dir,'dispatch.json'),{attempt:queued.attempt.id,requestHash:hash(queued.attempt)});fs.rmSync(current);assert.throws(()=>settleCaptureOff(two),{code:'E_CAPTURE_UNCERTAIN'});fs.rmSync(join(dir,'dispatch.json'));save(current,pointer);
  settleCaptureOff(two);assert.equal(f.calls().length,1);
});

test('consent-off preserves an existing normal consumption record byte-for-byte',t=>{
  const f=fixture(t),s=f.source('already-recalled'),result=f.observe(s,5000);assert.equal(result.report.complete,true);consumeAttempt(s,result.attempt);
  const file=join(f.attemptDir(result),'consumed.json'),before=fs.readFileSync(file),stat=fs.statSync(file);
  settleCaptureOff(s);settleCaptureOff(s);
  assert.deepEqual(fs.readFileSync(file),before);assert.equal(fs.statSync(file).mtimeMs,stat.mtimeMs);assert.equal(JSON.parse(before).settlement,undefined);assert.equal(f.calls().length,1);
});
