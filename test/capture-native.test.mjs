// Opt-in released-kernel rehearsal. Synthetic native transcripts and managed
// history stay under one disposable root; no model, deployment or host state.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { loadBindings } from '../oats-package/capabilities/oats-okf/lib/config.mjs';
import { initBase } from '../oats-package/capabilities/oats-okf/lib/migration.mjs';
import { register, capture, loadStatus, input } from '../oats-package/capabilities/oats-okf/lib/sources.mjs';
import { save, readJSON } from '../oats-package/capabilities/oats-okf/lib/io.mjs';
const cli = process.env.OATS_OKF_NATIVE_CLI;
const waitFor = async (fn, timeout = 20000) => {
  const end = Date.now() + timeout;
  while (!fn()) { if (Date.now() > end) assert.fail('native fixture did not reach expected state'); await new Promise(r => setTimeout(r, 2)); }
};
async function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'okf-native-capture-'))), old = { ...process.env };
  t.diagnostic('disposable native evidence ' + root);
  t.after(() => { for (const k of Object.keys(process.env)) delete process.env[k]; Object.assign(process.env, old); });
  // Retain the fixture as evidence. All explicit roots are disposable, including
  // the independent native-history sibling of each instance home.
  const put = (p, text) => { fs.mkdirSync(dirname(p), { recursive: true }); fs.writeFileSync(p, text); };
  for (const key of Object.keys(process.env)) if (/^(OATS_|PI_AGENT|GIT_|CLAUDE_|CODEX_|TURN_RECORD_)/.test(key)) delete process.env[key];
  Object.assign(process.env, { HOME: join(root, 'user'), OATS_HOME_DIR: join(root, 'host'), CLAUDE_CONFIG_DIR: join(root, 'claude'), CODEX_HOME: join(root, 'codex'), PI_CODING_AGENT_DIR: join(root, 'pi'), PI_CODING_AGENT_SESSION_DIR: join(root, 'pi-sessions'), TURN_RECORD_ROOT: join(root, 'record'), TURN_RECORD_OWNER: 'native-fixture', OATS_CLI_BIN: resolve(cli), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' });
  for (const p of [process.env.HOME, process.env.OATS_HOME_DIR, process.env.CLAUDE_CONFIG_DIR, process.env.CODEX_HOME, process.env.PI_CODING_AGENT_DIR, process.env.PI_CODING_AGENT_SESSION_DIR]) fs.mkdirSync(p, { recursive: true });
  const native = await import(pathToFileURL(join(dirname(dirname(resolve(cli))), 'packages/record/lib/native-history.mjs')));
  const source = (name, count = 1) => {
    const home = join(root, name, 'home'), soul = join(root, name, 'soul'), bindingsFile = join(root, name, 'bindings.json');
    fs.mkdirSync(join(home, 'work'), { recursive: true });
    save(join(home, 'instance.json'), { instance: name, agent: name, launched: true, repo: root, work: 'directory' });
    put(join(soul, 'soul.yaml'), `name: ${name}\nwork: directory\n`); put(join(soul, 'AGENTS.md'), '# Disposable native source\n');
    save(join(soul, 'okf.json'), { version: 1, owner: name, owns: ['base/expert'], reads: [] });
    save(bindingsFile, { version: 1, stateDir: 'state', bases: { base: { id: 'native-base', kind: 'directory', path: 'accepted' } } });
    process.env.OATS_SETTINGS = JSON.stringify({ 'bindings-file': bindingsFile, harvest: 'on' });
    const nodes = join(root, name, 'nodes.json'); save(nodes, { expert: { path: 'expert', owner: name } }); initBase(loadBindings(), 'base', nodes, undefined, { confirm: true });
    Object.assign(process.env, { OATS_INSTANCE: name, OATS_INSTANCE_HOME: home, OATS_AGENT: name, OATS_CONTEXT: root, OATS_SOUL: soul });
    native.initializeNativeHistory(home); const launch = native.prepareNativeStart(home, 'claude'); native.recordNativeStart(home, launch, 'claude', [], process.env);
    const transcript = join(process.env.CLAUDE_CONFIG_DIR, 'projects', name, name + '.jsonl');
    put(transcript, Array.from({ length: count }, (_, i) => JSON.stringify({ type: 'assistant', cwd: home, sessionId: name, timestamp: '2026-10-17T00:00:00Z', message: { role: 'assistant', content: [{ type: 'text', text: `${name} turn ${i} ` + 'x'.repeat(1000) }] } })).join('\n') + '\n');
    return register(home);
  };
  const current = s => { const pointer = readJSON(join(dirname(s.file), 'capture-attempts', 'current.json')); const dir = join(dirname(s.file), 'capture-attempts', pointer.id); return { ...pointer, dir, receipt: join(dir, 'receipt.json') }; };
  return { root, source, current };
}
test('released 0.62.0 exact-home capture survives >60s paused with native lock, bounded callers, restart and root contention', { skip: !cli }, async t => {
  const f = await fixture(t), s = f.source('slow', 256), other = f.source('queued');
  const version = spawnSync(process.execPath, [resolve(cli), 'version', '--json'], { env: process.env, encoding: 'utf8' });
  assert.match(version.stdout, /0\.62\.0/);
  const start = Date.now();
  assert.throws(() => capture(s, { final: true, deadlineMs: 50 }), { code: 'E_CAPTURE_PENDING' });
  assert.ok(Date.now() - start < 2000, 'foreground is bounded');
  const attempt = f.current(s), lock = join(process.env.TURN_RECORD_ROOT, '.capture.lock', 'owner.json');
  await waitFor(() => fs.existsSync(lock));
  const owner = readJSON(lock); process.kill(owner.pid, 'SIGSTOP');
  let resumed = false;
  t.after(() => { if (!resumed) { try { process.kill(owner.pid, 'SIGCONT'); } catch {} } });
  const stoppedAt = Date.now();
  assert.throws(() => capture(other, { final: true, deadlineMs: 100 }), { code: 'E_CAPTURE_PENDING' });
  assert.equal(loadStatus(other).lastCapture.status, 'queued');
  assert.throws(() => capture(s, { final: true, deadlineMs: 100 }), { code: 'E_CAPTURE_PENDING' });
  assert.equal(f.current(s).id, attempt.id);
  await new Promise(r => setTimeout(r, 61000));
  process.kill(owner.pid, 0); assert.equal(readJSON(lock).pid, owner.pid); assert.ok(Date.now() - stoppedAt > 60000);
  process.kill(owner.pid, 'SIGCONT'); resumed = true;
  await waitFor(() => fs.existsSync(attempt.receipt));
  const receipt = readJSON(attempt.receipt), report = JSON.parse(receipt.stdout);
  assert.equal(report.complete, true); assert.equal(report.sourceRoots, 'launch-history'); assert.equal(report.owner, 'native-fixture'); assert.equal(report.home, s.home);
  assert.equal(capture(s, { final: true, deadlineMs: 20000 }).complete, true);
  const turns = loadStatus(s).captured.inputs.map(id => input(s, id)).filter(i => i.kind === 'record').flatMap(i => i.turns);
  assert.equal(turns.length, 256); assert.equal(loadStatus(s).retired, true);
  assert.equal(capture(other, { final: true, deadlineMs: 20000 }).complete, true);
  assert.ok(!fs.existsSync(dirname(lock)), 'native finally released the lock'); assert.ok(fs.existsSync(attempt.receipt));
  t.diagnostic(JSON.stringify({ attempt: attempt.id, elapsedMs: Date.now() - start, pausedMs: Date.now() - stoppedAt, turns: turns.length, root: process.env.TURN_RECORD_ROOT, receipt: attempt.receipt }));
});
test('real lock skipped exit0 and failed nonzero receipts retain source without recall or final certification', { skip: !cli }, async t => {
  const f = await fixture(t), s = f.source('skipped');
  const { acquireCaptureLock } = await import(pathToFileURL(join(dirname(dirname(resolve(cli))), 'packages/record/lib/capture-lock.mjs')));
  const nativeLock = acquireCaptureLock(process.env.TURN_RECORD_ROOT); assert.equal(typeof nativeLock.release, 'function');
  try {
    assert.throws(() => capture(s, { final: true, deadlineMs: 5000 }), { code: 'E_CAPTURE_PENDING' });
    const receipt = readJSON(f.current(s).receipt); assert.equal(receipt.exitCode, 0); assert.equal(JSON.parse(receipt.stdout).status, 'skipped');
    assert.equal(loadStatus(s).retired, false); assert.deepEqual(loadStatus(s).captured.threads, {});
    // Exercise the RELEASED kernel's actual provider-check runner/closed codec,
    // not just our consumer test's JSON shape assumptions.
    const {runProviderCheck}=await import(pathToFileURL(join(dirname(dirname(resolve(cli))),'lib/instance-inspect.mjs')));
    const cap=fileURLToPath(new URL('../oats-package/capabilities/oats-okf/',import.meta.url)),manifest=readJSON(join(cap,'oats.json'));
    const checked=runProviderCheck({workspace:{key:'local:disposable-capture',name:'fixture'},deployment:f.root,home:null,meta:null,soul:{name:s.agent,soulDir:s.soulDir},teams:[],defaultTeam:null,teamsSource:null,payloads:{'oats.okf':{'bindings-file':s.bindings.file,harvest:'off'}}},{name:'oats.okf',manifest},cap);
    assert.equal(checked.outcome,'result',JSON.stringify(checked));assert.equal(checked.result.status,'ready');assert.deepEqual(checked.result.problems,[]);
    assert.ok(checked.result.warnings.some(w=>w.code==='retirement-capture-deferred'&&/1 source/.test(w.message)));

  } finally { nativeLock.release(); }
  // A missing historical root is an actual kernel failed/nonzero JSON outcome.
  fs.rmSync(join(process.env.CLAUDE_CONFIG_DIR, 'projects'), { recursive: true });
  assert.throws(() => capture(s, { final: true, deadlineMs: 5000 }), { code: 'E_CAPTURE_PENDING' });
  const failed = readJSON(f.current(s).receipt); assert.equal(failed.exitCode, 1); assert.equal(JSON.parse(failed.stdout).complete, false);
  assert.equal(loadStatus(s).retired, false); assert.ok(fs.existsSync(s.home));
});
