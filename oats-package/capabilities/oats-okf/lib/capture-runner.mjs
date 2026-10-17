// Detached, finite, per-attempt owner. No scheduler, deadline or signal sent to
// the kernel. Drain all output, retaining at most RECEIPT_LIMIT native bytes.
import { spawn } from 'node:child_process';
import { fs, join, save, hash } from './io.mjs';
import { readAttempt, privateJSON, receiptFor, releaseGate, sourceProof, RECEIPT_LIMIT, gatePath } from './capture-attempt.mjs';
const dir = process.argv[2];
try {
  const request = readAttempt(dir), requestHash = hash(request);
  const gate = privateJSON(join(gatePath(request.root), 'owner.json'));
  if (gate.directory !== dir || gate.attempt !== request.id || gate.requestHash !== requestHash) throw new Error('gate mismatch');
  // The exclusive runner claim is never reclaimed: a second runner must not
  // dispatch, even after death of the first one. Recovery requires its receipt.
  fs.writeFileSync(join(dir, 'runner.json'), JSON.stringify({ pid: process.pid, attempt: request.id, requestHash }), { flag: 'wx', mode: 0o600 });
  if (hash(sourceProof({ ...JSON.parse(fs.readFileSync(request.source.file, 'utf8')), file: request.source.file })) !== hash(request.source)) throw new Error('source changed');
  const child = spawn(request.cli, ['capture', '--home', request.source.home, '--quiet'], {
    cwd: request.cwd, env: { ...process.env, TURN_RECORD_ROOT: request.root, TURN_RECORD_OWNER: request.owner }, stdio: ['ignore', 'pipe', 'pipe']
  });
  let chunks = [], size = 0, overflow = false;
  child.stdout.on('data', b => {
    size += b.length;
    if (size <= RECEIPT_LIMIT) chunks.push(b);
    else { overflow = true; chunks = []; }
  });
  // Native diagnostics are untrusted and can contain private paths. Drain
  // without storage; the bounded JSON is the only capture authority.
  child.stderr.on('data', () => {});
  child.on('error', () => {});
  child.on('close', (exitCode, signal) => {
    save(join(dir, 'receipt.json'), { version: 1, attempt: request.id, requestHash, closed: true,
      exitCode, signal, overflow, stdout: overflow ? '' : Buffer.concat(chunks).toString('utf8'), finished: Date.now() });
    receiptFor(dir, request);
    try { releaseGate(dir, request); } catch { /* closed receipt permits later gate release */ }
  });
} catch {
  // Missing ownership/launch proof is intentionally HELD. Never manufacture a
  // terminal native receipt or release a gate on the strength of a dead PID.
  process.exitCode = 1;
}
