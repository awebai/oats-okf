// One durable native attempt per source. Foreground deadlines bound observation,
// never the kernel process. Only a runner's closed-output receipt permits replay
// or gate release; process age/liveness never resolves an uncertain dispatch.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { homedir, hostname } from 'node:os';
import { fileURLToPath } from 'node:url';
import { fs, join, dirname, resolve, safePath, save, hash, fail, cleanEnv, cliPath, bounded, within, syncDir, withLock } from './io.mjs';
export const RECEIPT_LIMIT = 16 * 1024 * 1024;
const runner = fileURLToPath(new URL('./capture-runner.mjs', import.meta.url));
const pause = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const uuid = v => typeof v === 'string' && /^[a-f0-9-]{36}$/.test(v);
const unknown = () => fail('E_CAPTURE_UNCERTAIN', 'capture ownership or receipt is uncertain; retain source and attempt for explicit recovery');
export function privateDirectory(path) {
  safePath(path);
  const s = fs.lstatSync(path);
  if (!s.isDirectory() || s.uid !== process.getuid?.() || (s.mode & 0o077)) unknown();
}
export function privateJSON(path, limit = RECEIPT_LIMIT * 2) {
  safePath(path); let fd;
  try {
    fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    const a = fs.fstatSync(fd);
    if (!a.isFile() || a.nlink !== 1 || a.uid !== process.getuid?.() || (a.mode & 0o077) || a.size > limit) unknown();
    const b = Buffer.alloc(a.size + 1); let n = 0, k;
    while (n < b.length && (k = fs.readSync(fd, b, n, b.length - n, null))) n += k;
    const z = fs.fstatSync(fd);
    if (n !== a.size || a.size !== z.size || a.mtimeMs !== z.mtimeMs || a.ctimeMs !== z.ctimeMs) unknown();
    return JSON.parse(b.subarray(0, n).toString('utf8'));
  } finally { if (fd !== undefined) fs.closeSync(fd); }
}
// Canonicalize BEFORE placing the gate: aliases, owners and state directories
// must all meet the same queue. This directory is ours, never .capture.lock.
export function captureRoot(cwd, env = process.env) {
  const selected = resolve(cwd, env.TURN_RECORD_ROOT ?? join(homedir(), '.turn-record'));
  fs.mkdirSync(selected, { recursive: true, mode: 0o700 });
  return fs.realpathSync(selected);
}
export const gatePath = root => join(root, '.oats-okf-capture', 'gate');
export function sourceProof(source) {
  safePath(source.home);
  const s = fs.lstatSync(source.home);
  if (!s.isDirectory()) unknown();
  return { id: source.id, file: source.file, descriptor: hash(fs.readFileSync(source.file)),
    home: source.home, homeDirectory: { dev: s.dev, ino: s.ino },
    // Keep only a digest, never launch recipes, auth or environment in custody.
    launch: hash(fs.readFileSync(join(source.home, 'instance.json'))) };
}
function same(a, b) { return hash(a) === hash(b); }
export function readAttempt(dir) {
  privateDirectory(dir);
  const request = privateJSON(join(dir, 'request.json'));
  if (request.version !== 1 || !uuid(request.id) || join(dirname(dir), request.id) !== dir || typeof request.root !== 'string') unknown();
  return request;
}
export function receiptFor(dir, request) {
  const receipt = privateJSON(join(dir, 'receipt.json'));
  if (receipt.version !== 1 || receipt.attempt !== request.id || receipt.requestHash !== hash(request)
    || receipt.closed !== true || typeof receipt.overflow !== 'boolean' || typeof receipt.stdout !== 'string'
    || Buffer.byteLength(receipt.stdout) > RECEIPT_LIMIT) unknown();
  return receipt;
}
function releaseGateLocked(dir, request) {
  // The durable close receipt proves that this attempt's native child ended.
  receiptFor(dir, request);
  const gate = gatePath(request.root);
  if (!fs.existsSync(gate)) return;
  privateDirectory(gate);
  const owner = privateJSON(join(gate, 'owner.json'));
  if (owner.attempt !== request.id || owner.directory !== dir || owner.requestHash !== hash(request)) return;
  // No other contender removes an occupied gate. Rename is unnecessary because
  // mkdir contenders cannot enter until this exact owned directory is removed.
  fs.rmSync(gate, { recursive: true }); syncDir(dirname(gate));
}
export function releaseGate(dir, request) {
  try { return withLock(join(dirname(gatePath(request.root)), 'coordination.lock'), () => releaseGateLocked(dir, request), { reclaimDead: true, waitMs: 100 }); }
  catch (e) { if (e.code !== 'E_LOCKED' && e.code !== 'E_DEADLINE') throw e; }
}
function acquireGateLocked(dir, request) {
  const gate = gatePath(request.root);
  safePath(dirname(gate)); fs.mkdirSync(dirname(gate), { recursive: true, mode: 0o700 }); privateDirectory(dirname(gate));
  try { fs.mkdirSync(gate, { mode: 0o700 }); }
  catch (e) {
    if (e.code !== 'EEXIST') throw e;
    privateDirectory(gate);
    // An abandoned runner can leave a gate AFTER publishing its receipt. Only
    // that exact request/receipt pair permits release, never a dead owner PID.
    try {
      const owner = privateJSON(join(gate, 'owner.json'));
      const other = readAttempt(owner.directory);
      if (owner.attempt !== other.id || owner.requestHash !== hash(other) || other.root !== request.root) unknown();
      releaseGateLocked(owner.directory, other);
    } catch { return false; }
    if (fs.existsSync(gate)) return false;
    return acquireGateLocked(dir, request);
  }
  save(join(gate, 'owner.json'), { version: 1, attempt: request.id, directory: dir, requestHash: hash(request) });
  return true;
}
function acquireGate(dir, request) {
  const parent = dirname(gatePath(request.root));
  safePath(parent); fs.mkdirSync(parent, { recursive: true, mode: 0o700 }); privateDirectory(parent);
  try { return withLock(join(parent, 'coordination.lock'), () => acquireGateLocked(dir, request), { reclaimDead: true, waitMs: 100 }); }
  catch (e) { if (e.code === 'E_LOCKED' || e.code === 'E_DEADLINE') return false; throw e; }
}
export function assertCaptureSettled(source) {
  const base = join(dirname(source.file), 'capture-attempts'), current = join(base, 'current.json');
  if (!fs.existsSync(current)) return;
  const pointer = privateJSON(current);
  if (!uuid(pointer.id)) unknown();
  const dir = join(base, pointer.id), request = readAttempt(dir);
  if (pointer.requestHash !== hash(request)) unknown();
  let done; try { done = privateJSON(join(dir, 'consumed.json')); }
  catch { fail('E_CAPTURE_PENDING', `capture attempt ${request.id} still needs capture/recall observation; retain source before retirement, including when harvest is off`); }
  if (done.attempt !== request.id || done.requestHash !== hash(request)) unknown();
}
export function consumeAttempt(source, attempt) {
  const dir = join(dirname(source.file), 'capture-attempts', attempt.id);
  receiptFor(dir, attempt);
  save(join(dir, 'consumed.json'), { version: 1, attempt: attempt.id, requestHash: hash(attempt) });
}
function reportFrom(receipt, request) {
  if (receipt.overflow) unknown();
  let r; try { r = JSON.parse(receipt.stdout); } catch { unknown(); }
  if (!r || r.home !== request.source.home || r.owner !== request.owner || r.sourceRoots !== 'launch-history'
    || !Array.isArray(r.sessions) || typeof r.complete !== 'boolean' || typeof r.status !== 'string') unknown();
  // Validate boundaries before ANY recall. A failed/skipped receipt may still
  // list older turns, but those do not certify this capture and are never read.
  if (r.complete) {
    if (r.status !== 'complete' || r.skipped || r.held || r.incomplete || r.failed || r.error || r.unattributed?.length) unknown();
    const seen = new Set();
    for (const s of r.sessions) {
      if (!['cc', 'pi', 'codex'].includes(s.source) || typeof s.sessionId !== 'string' || !s.sessionId
        || s.thread !== `${s.source}:session:${s.sessionId}` || s.stream !== `${request.owner}~${s.source}.${s.sessionId}`
        || typeof s.path !== 'string' || resolve(s.path) !== s.path || typeof s.cwd !== 'string' || resolve(s.cwd) !== s.cwd || !within(request.source.home, resolve(s.cwd))
        || !Number.isSafeInteger(s.turns) || s.turns < 1 || typeof s.firstTurnId !== 'string' || !s.firstTurnId
        || typeof s.lastTurnId !== 'string' || !s.lastTurnId || seen.has(s.thread)) unknown();
      seen.add(s.thread);
    }
  }
  return r;
}
export function nativeCapture(source, options) {
  try { return observeCapture(source, options); }
  catch (error) {
    if (['E_RUNTIME', 'E_CAPTURE', 'E_DEADLINE'].includes(error.code)) throw error;
    let attempt;
    try { const pointer = privateJSON(join(dirname(source.file), 'capture-attempts', 'current.json')); if (uuid(pointer.id)) attempt = pointer.id; } catch {}
    throw Object.assign(new Error(`capture${attempt ? ` attempt ${attempt}` : ''} ownership or receipt is uncertain; retain source and attempt for explicit recovery`), { code: 'E_CAPTURE_UNCERTAIN', attempt });
  }
}
function observeCapture(source, { deadline, final = false }) {
  const started = Date.now(); let budget = Math.max(0, deadline - started);
  try { budget = Math.min(budget, bounded(Math.max(1, budget))); } catch { budget = 0; }
  deadline = started + budget;
  const base = join(dirname(source.file), 'capture-attempts'), current = join(base, 'current.json');
  let request, dir;
  const proof = sourceProof(source);
  const root = captureRoot(source.context), owner = process.env.TURN_RECORD_OWNER ?? hostname().split('.')[0];
  const pending = (status, reason) => ({ observation: { status, complete: false, attempt: request.id,
    elapsedSeconds: Math.max(0, (Date.now() - request.created) / 1000), budgetSeconds: budget / 1000,
    reason: `${reason}; source and receipts retained; resume at a later checkpoint` }, attempt: request });
  if (fs.existsSync(current)) {
    const pointer = privateJSON(current);
    if (!uuid(pointer.id)) unknown();
    dir = join(base, pointer.id); request = readAttempt(dir);
    if (pointer.requestHash !== hash(request)) unknown();
    if (fs.existsSync(join(dir, 'consumed.json'))) {
      const done = privateJSON(join(dir, 'consumed.json'));
      if (done.attempt !== request.id || done.requestHash !== hash(request)) unknown();
      request = undefined;
    }
  }
  if (!request) {
    if (deadline <= Date.now()) fail('E_CAPTURE', 'capture deadline: backlog preserved; retire must retry');
    bounded(deadline - Date.now());
    const cli = cliPath();
    request = { version: 1, id: randomUUID(), source: proof, root, owner, cli, cwd: source.context, final, created: Date.now() };
    dir = join(base, request.id); safePath(dir); fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    privateDirectory(base); privateDirectory(dir);
    save(join(dir, 'request.json'), request);
    save(current, { id: request.id, requestHash: hash(request) });
  }
  if (!same(request.source, proof) || request.root !== root || request.owner !== owner || request.cli !== cliPath() || request.cwd !== source.context) unknown();
  if (!fs.existsSync(join(dir, 'receipt.json')) && !fs.existsSync(join(dir, 'dispatch.json'))) {
    // A gate bearing OUR request without dispatch.json is an uncertain crash
    // window; acquireGate refuses it because there is no closed receipt.
    if (!acquireGate(dir, request)) return pending('queued', `capture attempt ${request.id} is waiting for the shared record root`);
    save(join(dir, 'dispatch.json'), { attempt: request.id, requestHash: hash(request), at: Date.now() });
    const env = { ...cleanEnv(), TURN_RECORD_ROOT: root, TURN_RECORD_OWNER: owner };
    try {
      const child = spawn(process.execPath, [runner, dir], { cwd: source.context, env, detached: true, stdio: 'ignore' });
      child.on('error', () => {}); child.unref();
    } catch { return pending('uncertain', `capture attempt ${request.id} dispatch is uncertain`); }
  }
  while (!fs.existsSync(join(dir, 'receipt.json'))) {
    const left = deadline - Date.now();
    if (left <= 0) return pending('running', `capture attempt ${request.id} exceeded foreground observation budget ${budget / 1000} s; native capture continues`);
    // Respect any outer invocation deadline as well, without touching native.
    let wait; try { wait = bounded(Math.min(25, left)); } catch { return pending('running', `capture attempt ${request.id} exceeded foreground observation budget ${budget / 1000} s; native capture continues`); }
    pause(wait);
  }
  const receipt = receiptFor(dir, request);
  releaseGate(dir, request);
  const report = reportFrom(receipt, request);
  return { report, attempt: request, env: { ...cleanEnv(), TURN_RECORD_ROOT: root, TURN_RECORD_OWNER: owner } };
}
