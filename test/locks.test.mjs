import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { tmpdir, hostname } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
const { withLock, save, readJSON } = await import(new URL('../oats-package/capabilities/oats-okf/lib/io.mjs', import.meta.url));

function scratch(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'okf-locks-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
/** A pid that belonged to a process which has exited. */
function deadPid() {
  const r = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' });
  return Number(r.stdout);
}
function held(lock, owner) { fs.mkdirSync(lock); save(join(lock, 'owner.json'), owner); }

test('a lock whose owner pid is dead is reclaimed when the caller asks for it', t => {
  const lock = join(scratch(t), 'worker.lock');
  held(lock, { token: 'dead-owner', pid: deadPid(), host: hostname() });
  assert.equal(withLock(lock, () => readJSON(join(lock, 'owner.json')).pid, { reclaimDead: true }), process.pid);
  assert.equal(fs.existsSync(lock), false, 'released after use');
  assert.equal(fs.existsSync(`${lock}.reclaim`), false, 'the reclaim guard is released');
});

test('a dead owner is never reclaimed by a caller that did not ask for it', t => {
  const lock = join(scratch(t), 'base.okf-lock');
  held(lock, { token: 'dead-owner', pid: deadPid(), host: hostname() });
  assert.throws(() => withLock(lock, () => 1), e => e.code === 'E_LOCKED' && e.message.includes(lock) && /process \d+, which is gone/.test(e.message) && e.message.includes(`oats okf unlock --lock '${lock}' --token 'dead-owner'`));
  assert.equal(readJSON(join(lock, 'owner.json')).token, 'dead-owner');
});

test('a live holder is never stolen from: the wait is bounded and the lock is kept', t => {
  const lock = join(scratch(t), 'worker.lock');
  const child = spawn(process.execPath, ['-e', 'setTimeout(()=>{},60000)'], { stdio: 'ignore' });
  t.after(() => child.kill('SIGKILL'));
  held(lock, { token: 'live-owner', pid: child.pid, host: hostname() });
  const started = Date.now();
  assert.throws(() => withLock(lock, () => 1, { reclaimDead: true, waitMs: 300 }), /busy lock: .* held by running process \d+/);
  assert.ok(Date.now() - started < 5000, 'bounded wait');
  assert.equal(readJSON(join(lock, 'owner.json')).token, 'live-owner');
});

test('a lock on another host or without a readable owner is only reclaimed when provably abandoned', t => {
  const dir = scratch(t);
  const remote = join(dir, 'remote.lock');
  held(remote, { token: 'other-host', pid: deadPid(), host: `not-${hostname()}` });
  assert.throws(() => withLock(remote, () => 1, { reclaimDead: true }), /busy or abandoned/, 'a pid on another host cannot be checked');
  const young = join(dir, 'young.lock'); fs.mkdirSync(young);
  assert.throws(() => withLock(young, () => 1, { reclaimDead: true }), /busy or abandoned/, 'a holder may not have written its owner yet');
  const old = join(dir, 'old.lock'); fs.mkdirSync(old);
  const past = new Date(Date.now() - 120000); fs.utimesSync(old, past, past);
  assert.equal(withLock(old, () => 'taken', { reclaimDead: true }), 'taken', 'an ownerless lock past the grace period is abandoned');
});

test('a reclaimer that died holding the reclaim guard is reported, never raced', t => {
  const lock = join(scratch(t), 'worker.lock');
  held(lock, { token: 'dead-owner', pid: deadPid(), host: hostname() });
  save(`${lock}.reclaim`, { token: 'dead-reclaimer', pid: deadPid(), host: hostname() });
  assert.throws(() => withLock(lock, () => 1, { reclaimDead: true }), /reclaim/);
  assert.equal(readJSON(join(lock, 'owner.json')).token, 'dead-owner', 'the lock is left as it was');
});
