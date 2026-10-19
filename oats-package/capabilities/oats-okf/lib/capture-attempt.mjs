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
const hasEvidence = path => {try {fs.lstatSync(path);return true;} catch(e) {if(e.code==='ENOENT')return false;throw e;}};
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
  const s = fs.lstatSync(source.home), metaFile = safePath(join(source.home, 'instance.json'));
  if (!s.isDirectory()) unknown();
  const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
  // Kernel lifecycle/session bookkeeping is mutable on a live home. Bind to
  // identity only; start IDs, wake, backend and prompt updates are not identity.
  const identity = Object.fromEntries(['instance', 'agent', 'createdAt', 'incarnationId', 'kind'].map(k => [k, meta[k] ?? null]));
  return { id: source.id, file: source.file, descriptor: hash(fs.readFileSync(source.file)),
    home: source.home, homeDirectory: { dev: s.dev, ino: s.ino }, identity };
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
    || receipt.closed !== true || typeof receipt.nativeDispatched !== 'boolean' || typeof receipt.overflow !== 'boolean' || typeof receipt.stdout !== 'string'
    || Buffer.byteLength(receipt.stdout) > RECEIPT_LIMIT) unknown();
  if (!receipt.nativeDispatched && (!['runner-exec-failed', 'native-exec-failed', 'source-changed', 'gate-mismatch', 'cli-changed'].includes(receipt.reason) || receipt.stdout !== '' || receipt.overflow)) unknown();
  return receipt;
}
export function noDispatchReceipt(dir, request, reason) {
  save(join(dir, 'receipt.json'), { version: 1, attempt: request.id, requestHash: hash(request), closed: true, nativeDispatched: false, reason, exitCode: null, signal: null, overflow: false, stdout: '', finished: Date.now() });
  releaseGate(dir, request);
}
function releaseGateLocked(dir, request) {
  // The durable close receipt proves that this attempt's native child ended.
  receiptFor(dir, request);
  const gate = gatePath(request.root);
  if (!fs.existsSync(gate)) return;
  privateDirectory(gate);
  const owner = privateJSON(join(gate, 'owner.json'));
  if (owner.attempt !== request.id || owner.directory !== dir || owner.requestHash !== hash(request)) return;
  // Publish absence atomically before recursive cleanup. A crash partway
  // through rm must never leave an ownerless gate at the published address.
  const parent = dirname(gate), released = join(parent, `.released-${randomUUID()}`);
  fs.renameSync(gate, released); syncDir(parent);
  try { fs.rmSync(released, { recursive: true }); } catch { /* inert cleanup debris cannot hold the root */ }
}
export function releaseGate(dir, request) {
  try { return withLock(join(dirname(gatePath(request.root)), 'coordination.lock'), () => releaseGateLocked(dir, request), { reclaimDead: true, reclaimOwnerless: false, waitMs: 100 }); }
  catch (e) { if (e.code !== 'E_LOCKED' && e.code !== 'E_DEADLINE') throw e; }
}
function acquireGateLocked(dir, request) {
  const gate = gatePath(request.root), parent = dirname(gate);
  safePath(parent); fs.mkdirSync(parent, { recursive: true, mode: 0o700 }); privateDirectory(parent);
  if (fs.existsSync(gate)) {
    privateDirectory(gate);
    // Only a matching terminal receipt permits removal of an occupied gate.
    // Unknown dispatch/ownership remains held, regardless of process age.
    try {
      const owner = privateJSON(join(gate, 'owner.json'));
      const other = readAttempt(owner.directory);
      if (owner.attempt !== other.id || owner.requestHash !== hash(other) || other.root !== request.root) unknown();
      releaseGateLocked(owner.directory, other);
    } catch {
      try {const held=gateOwner(request.root);return {acquired:false,blocker:{attempt:held.owner.attempt,state:'uncertain'}};}
      catch {return {acquired:false,blocker:{attempt:null,state:'unknown'}};}
    }
    if (fs.existsSync(gate)) return {acquired:false,blocker:{attempt:null,state:'unknown'}};
  }
  const staged = join(parent, `.gate-${randomUUID()}`);
  fs.mkdirSync(staged, { mode: 0o700 });
  try {
    save(join(staged, 'owner.json'), { version: 1, attempt: request.id, directory: dir, requestHash: hash(request) });
    fs.renameSync(staged, gate); syncDir(parent);
  } finally {
    // A crash before publication leaves only an inert staging directory. No
    // runner may dispatch without the published, fully owned gate.
    if (fs.existsSync(staged)) fs.rmSync(staged, { recursive: true });
  }
  return true;
}
function acquireGate(dir, request) {
  const parent = dirname(gatePath(request.root));
  safePath(parent); fs.mkdirSync(parent, { recursive: true, mode: 0o700 }); privateDirectory(parent);
  try { return withLock(join(parent, 'coordination.lock'), () => acquireGateLocked(dir, request), { reclaimDead: true, reclaimOwnerless: false, waitMs: 100 }); }
  catch (e) { if (e.code === 'E_LOCKED' || e.code === 'E_DEADLINE') return {acquired:false,blocker:{attempt:null,state:'unknown'}}; throw e; }
}
// Without a published pointer, pre-publication directories are inert only
// while every durable dispatch/closure artifact is absent. Never discard them.
function assertInertOrphans(base, source, proof) {
  privateDirectory(base);
  const entries=fs.opendirSync(base);
  try {
    let entry;
    while((entry=entries.readSync())) {
      const path=join(base,entry.name);
      if(/^current\.json\.tmp-[a-f0-9-]{36}$/.test(entry.name)) {
        assertUnpublishedFile(path);continue;
      }
      if(!uuid(entry.name)) unknown();
      privateDirectory(path);
      for(const marker of ['dispatch.json','runner.json','receipt.json','consumed.json']) if(hasEvidence(join(path,marker))) unknown();
      const files=fs.opendirSync(path);
      try {
        let file;
        while((file=files.readSync())) {
          if(file.name!=='request.json'&&!/^request\.json\.tmp-[a-f0-9-]{36}$/.test(file.name)) unknown();
          assertUnpublishedFile(join(path,file.name));
        }
      } finally {files.closeSync();}
      if(hasEvidence(join(path,'request.json'))) {
        const request=readAttempt(path);
        if(!same(request.source,proof)||request.cwd!==source.context) unknown();
        // A gate published after a lost pointer is still an ambiguous dispatch
        // window, even if no dispatch intent was subsequently saved.
        safePath(request.root);if(fs.realpathSync(request.root)!==request.root) unknown();
        const held=gateOwner(request.root);
        if(held && (held.owner.directory===path || held.request.source.id===source.id || held.request.source.file===source.file)) unknown();
      }
    }
  } finally {entries.closeSync();}
}
function assertUnpublishedFile(path) {
  safePath(path);const stat=fs.lstatSync(path);
  if(!stat.isFile()||stat.nlink!==1||stat.uid!==process.getuid?.()||(stat.mode&0o077)||stat.size>65536) unknown();
}
// Shared by capture, backlog admission and consent-off retirement. A saved
// attempt binds the same physical home and stable identity across these paths.
export function assertCaptureSource(source) {
  try {
    const proof = sourceProof(source), base = join(dirname(source.file), 'capture-attempts');
    if (!hasEvidence(join(base, 'current.json'))) {
      if(hasEvidence(base)) {
        assertInertOrphans(base,source,proof);
      }
      return { proof };
    }
    const pointer = privateJSON(join(base, 'current.json'));
    if (!uuid(pointer.id)) unknown();
    const dir = join(base, pointer.id), request = readAttempt(dir);
    if (pointer.requestHash !== hash(request) || !same(request.source, proof) || request.cwd !== source.context) unknown();
    return { proof, dir, request };
  } catch {unknown();}
}
function gateOwner(root) {
  const gate = gatePath(root);
  if (!hasEvidence(gate)) return null;
  privateDirectory(gate);
  const owner = privateJSON(join(gate, 'owner.json')), request = readAttempt(owner.directory);
  if (owner.version !== 1 || owner.attempt !== request.id || owner.requestHash !== hash(request) || request.root !== root
    || !uuid(request.source?.id) || typeof request.source.file!=='string' || resolve(request.source.file)!==request.source.file
    || owner.directory!==join(dirname(request.source.file),'capture-attempts',request.id)) unknown();
  return { owner, request };
}
/** Caller holds source capture.lock through settlement AND retired transition.
 * No new native work, recall or custody is authorized by harvest-off consent. */
export function settleCaptureOff(source) {
  const { dir, request } = assertCaptureSource(source);
  if (!request) return;
  try {
    // Never recreate a missing record root as a side effect of retirement.
    safePath(request.root); if (fs.realpathSync(request.root) !== request.root) unknown();
    const parent = dirname(gatePath(request.root));
    withLock(join(parent, 'coordination.lock'), () => {
      privateDirectory(parent);
      const gate = gateOwner(request.root);
      const ownGate = gate?.owner.attempt === request.id && gate.owner.directory === dir;
      if(gate && !ownGate && (gate.request.source.id===source.id || gate.request.source.file===source.file)) unknown();
      const receiptFile = join(dir, 'receipt.json'), dispatchFile = join(dir, 'dispatch.json'), runnerFile = join(dir, 'runner.json');
      if (hasEvidence(dispatchFile)) {
        const dispatch = privateJSON(dispatchFile);
        if (dispatch.attempt !== request.id || dispatch.requestHash !== hash(request)) unknown();
      }
      if (hasEvidence(runnerFile)) {
        const claim = privateJSON(runnerFile);
        if (claim.attempt !== request.id || claim.requestHash !== hash(request)) unknown();
      }
      if (hasEvidence(receiptFile)) {
        // Envelope closure alone cannot excuse corrupt or foreign native JSON.
        const receipt = receiptFor(dir, request); reportFrom(receipt, request);
        if (ownGate) releaseGateLocked(dir, request);
      } else if (hasEvidence(dispatchFile) || hasEvidence(runnerFile) || ownGate) {
        fail('E_CAPTURE_PENDING', `capture attempt ${request.id} has no proven terminal observation; retain source`);
      }
      if (hasEvidence(join(dir, 'consumed.json'))) {
        const done = privateJSON(join(dir, 'consumed.json'));
        if (done.version !== 1 || done.attempt !== request.id || done.requestHash !== hash(request)) unknown();
        return; // Preserve the original custody/settlement observation byte-for-byte.
      }
      save(join(dir, 'consumed.json'), { version: 1, attempt: request.id, requestHash: hash(request), settlement: 'settled-under-harvest-off' });
    }, { reclaimDead: true, reclaimOwnerless: false, waitMs: 100 });
  } catch (error) {
    if (['E_CAPTURE_PENDING', 'E_LOCKED', 'E_DEADLINE', 'E_CAPTURE_UNCERTAIN'].includes(error.code)) throw error;
    unknown();
  }
}
export function consumeAttempt(source, attempt) {
  const dir = join(dirname(source.file), 'capture-attempts', attempt.id);
  receiptFor(dir, attempt);
  save(join(dir, 'consumed.json'), { version: 1, attempt: attempt.id, requestHash: hash(attempt) });
}
function reportFrom(receipt, request) {
  if (!receipt.nativeDispatched) return { status: 'not-dispatched', complete: false, reason: receipt.reason, sessions: [] };
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
  let request, dir, dispatched = false;
  const proof = sourceProof(source);
  let root, owner;
  const pending = (status, reason, extra = {}) => ({ observation: { status, complete: false, attempt: request.id, ...extra,
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
    root = captureRoot(source.context); owner = process.env.TURN_RECORD_OWNER ?? hostname().split('.')[0];
    request = { version: 1, id: randomUUID(), source: proof, root, owner, cli, cwd: source.context, final, created: Date.now() };
    dir = join(base, request.id); safePath(dir); fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    privateDirectory(base); privateDirectory(dir);
    save(join(dir, 'request.json'), request);
    save(current, { id: request.id, requestHash: hash(request) });
  }
  if (!same(request.source, proof) || request.cwd !== source.context) unknown();
  root = request.root; owner = request.owner;
  if (!fs.existsSync(join(dir, 'receipt.json')) && !fs.existsSync(join(dir, 'dispatch.json'))) {
    if (request.cli !== cliPath()) {
      noDispatchReceipt(dir, request, 'cli-changed');
    } else {
      // A gate bearing OUR request without dispatch.json is an uncertain crash
      // window; acquireGate refuses it because there is no closed receipt.
      const admission = acquireGate(dir, request);
      if (admission !== true) return pending('queued', `capture attempt ${request.id} is waiting for the shared record root; blocking attempt ${admission.blocker.attempt ?? 'unknown'} has ${admission.blocker.state} completion`, {blocker:admission.blocker});
      save(join(dir, 'dispatch.json'), { attempt: request.id, requestHash: hash(request), at: Date.now() });
      const env = { ...cleanEnv(), TURN_RECORD_ROOT: root, TURN_RECORD_OWNER: owner };
      let runnerMayExist = false;
      try {
        const child = spawn(process.execPath, [runner, dir], { cwd: source.context, env, detached: true, stdio: 'ignore' });
        runnerMayExist = child.pid !== undefined;
        child.on('error', () => {}); child.unref();
        // An undefined PID here is the OS spawn result (no process created),
        // not a liveness inference about a previously dispatched process.
        if (child.pid === undefined) noDispatchReceipt(dir, request, 'runner-exec-failed');
        else dispatched = true;
      } catch {
        if (runnerMayExist) return pending('uncertain', `capture attempt ${request.id} runner dispatch is uncertain`);
        noDispatchReceipt(dir, request, 'runner-exec-failed');
      }
    }
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
  return { report, attempt: request, dispatched, timing: { elapsedSeconds: Math.max(0, (Date.now() - request.created) / 1000), budgetSeconds: budget / 1000 }, env: { ...cleanEnv(), TURN_RECORD_ROOT: root, TURN_RECORD_OWNER: owner } };
}
