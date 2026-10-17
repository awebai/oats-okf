// Detached, finite, per-attempt owner. No scheduler, deadline or signal sent to
// the kernel. Drain all output, retaining at most RECEIPT_LIMIT native bytes.
import { spawn } from 'node:child_process';
import { isUtf8 } from 'node:buffer';
import { fs, join, save, hash } from './io.mjs';
import { readAttempt, privateJSON, receiptFor, releaseGate, sourceProof, noDispatchReceipt, RECEIPT_LIMIT, gatePath } from './capture-attempt.mjs';
const dir = process.argv[2];
let request, requestHash, claimed = false, nativeMayExist = false, reason = 'source-changed';
try {
  request = readAttempt(dir); requestHash = hash(request);
  const dispatch = privateJSON(join(dir, 'dispatch.json'));
  if (dispatch.attempt !== request.id || dispatch.requestHash !== requestHash) throw new Error('dispatch mismatch');
  // EEXIST means another runner may already own a native child. Never write a
  // negative receipt or release its gate merely because this runner cannot own it.
  fs.writeFileSync(join(dir, 'runner.json'), JSON.stringify({ pid: process.pid, attempt: request.id, requestHash }), { flag: 'wx', mode: 0o600 });
  claimed = true;
  reason = 'gate-mismatch';
  const gate = privateJSON(join(gatePath(request.root), 'owner.json'));
  if (gate.directory !== dir || gate.attempt !== request.id || gate.requestHash !== requestHash) throw new Error('gate mismatch');
  reason = 'source-changed';
  if (hash(sourceProof({ ...JSON.parse(fs.readFileSync(request.source.file, 'utf8')), file: request.source.file })) !== hash(request.source)) throw new Error('source changed');
  reason = 'native-exec-failed';
  const child = spawn(request.cli, ['capture', '--home', request.source.home, '--quiet'], {
    cwd: request.cwd, env: { ...process.env, TURN_RECORD_ROOT: request.root, TURN_RECORD_OWNER: request.owner }, stdio: ['ignore', 'pipe', 'pipe']
  });
  nativeMayExist = child.pid !== undefined;
  let chunks = [], size = 0, overflow = false;
  child.stdout.on('data', b => {
    size += b.length;
    if (size <= RECEIPT_LIMIT) chunks.push(b);
    else { overflow = true; chunks = []; }
  });
  child.stderr.on('data', () => {});
  child.on('error', () => {});
  child.on('close', (exitCode, signal) => {
    if (!nativeMayExist) { noDispatchReceipt(dir, request, 'native-exec-failed'); return; }
    const bytes = Buffer.concat(chunks); overflow ||= !isUtf8(bytes);
    save(join(dir, 'receipt.json'), { version: 1, attempt: request.id, requestHash, closed: true, nativeDispatched: true,
      exitCode, signal, overflow, stdout: overflow ? '' : bytes.toString('utf8'), finished: Date.now() });
    receiptFor(dir, request);
    try { releaseGate(dir, request); } catch { /* closed receipt permits later gate release */ }
  });
} catch {
  if (claimed && !nativeMayExist) {
    try { noDispatchReceipt(dir, request, reason); } catch { /* storage/ownership remains uncertain */ }
  }
  // Missing ownership, a duplicate claim, or a crash AFTER possible native
  // dispatch stays held. A dead PID is never a substitute for a receipt.
  process.exitCode = 1;
}
