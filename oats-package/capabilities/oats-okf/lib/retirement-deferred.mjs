// Durable retirement obligations, separate from lastCapture (which a successful
// checkpoint may replace). Observation is local, bounded and strictly read-only.
import { fs, join, dirname, resolve, safePath, save, syncDir, withLock, fail } from './io.mjs';
export const RETIREMENT_WARNING_CODE = 'retirement-capture-deferred';
export const RETIREMENT_REASON_TEMPLATES = Object.freeze({
  'retirement-capture-deferred': 'retirement capture deferred for <count> source(s); oldest observed age <age> s; registry coverage <coverage>; source retained until retirement custody is resolved',
  'retirement-observation-incomplete': 'retirement capture observation has <coverage> registry coverage; observed <count> deferred source(s), oldest observed age <age> s; inspect harvest-status',
});
const reasons = new Set(['capture-pending', 'capture-uncertain', 'capture-busy', 'capture-incomplete']);
const uuid = v => typeof v === 'string' && /^[a-f0-9-]{36}$/.test(v);
const markerPath = source => join(dirname(source.file), 'retirement-deferred.json');
const epoch = v => typeof v === 'string' ? Date.parse(v) : NaN;
function validMarker(value, id, now) {
  return value?.version === 1 && value.source === id && Number.isFinite(epoch(value.since)) && epoch(value.since) >= 0 && epoch(value.since) <= now
    && reasons.has(value.reason) && (value.attempt === null || uuid(value.attempt));
}
function readBounded(file, limit, budget) {
  safePath(file); let fd;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    const a = fs.fstatSync(fd);
    if (!a.isFile() || a.nlink !== 1 || a.uid !== process.getuid?.() || (a.mode & 0o077) || a.size > limit || a.size > budget.left) throw new Error('unreadable retirement evidence');
    budget.left -= a.size;
    const bytes = Buffer.alloc(a.size + 1); let n = 0, k;
    while (n < bytes.length && (k = fs.readSync(fd, bytes, n, bytes.length - n, null))) n += k;
    const b = fs.fstatSync(fd);
    if (n !== a.size || a.size !== b.size || a.mtimeMs !== b.mtimeMs || a.ctimeMs !== b.ctimeMs) throw new Error('changed retirement evidence');
    return JSON.parse(bytes.subarray(0, n).toString('utf8'));
  } finally { if (fd !== undefined) fs.closeSync(fd); }
}
export function deferRetirement(source, { attempt = null, code, now = Date.now() } = {}) {
  const reason = code === 'E_CAPTURE_PENDING' ? 'capture-pending' : code === 'E_CAPTURE_UNCERTAIN' ? 'capture-uncertain' : code === 'E_LOCKED' ? 'capture-busy' : 'capture-incomplete';
  return withLock(join(dirname(source.file), 'retirement.lock'), () => {
    const file = markerPath(source), status = safePath(join(dirname(source.file), 'status.json'));
    // A contender may have observed a busy capture just before another retire
    // certified it. Recheck under the same marker lock used by final clearing.
    if (fs.existsSync(status) && JSON.parse(fs.readFileSync(status, 'utf8')).retired === true) {
      if (fs.existsSync(file)) { fs.unlinkSync(safePath(file)); syncDir(dirname(file)); }
      return;
    }
    let since = new Date(now).toISOString();
    if (fs.existsSync(file)) {
      const prior = readBounded(file, 4096, { left: 4096 });
      if (!validMarker(prior, source.id, now)) fail('E_RETIREMENT_MARKER', 'retirement obligation is unreadable; retain source and inspect provider custody');
      since = prior.since;
    }
    save(file, { version: 1, source: source.id, since, lastObserved: new Date(now).toISOString(), attempt: uuid(attempt) ? attempt : null, reason });
  }, { waitMs: 100, reclaimDead: true });
}
export function clearDeferredRetirement(source) {
  return withLock(join(dirname(source.file), 'retirement.lock'), () => {
    const file = safePath(markerPath(source));
    if (fs.existsSync(file)) { fs.unlinkSync(file); syncDir(dirname(file)); }
  }, { waitMs: 100, reclaimDead: true });
}
/** Aggregate ONLY the bound registry, never homes, native roots or the kernel.
 * Count/age are observations, not certification. Limits include nonmatching and
 * unreadable entries; incomplete coverage cannot become a claimed exact zero. */
export function observeDeferredRetirements(bindings, { soul = null, home = null, now = Date.now(), maxSources = 500, maxMs = 100, maxBytes = 4 * 1024 * 1024 } = {}) {
  const started = Date.now(), rows = [], budget = { left: maxBytes };
  let scannedSources = 0, unknown = false, truncated = false, dir;
  const summary = () => {
    const coverage = truncated ? 'truncated' : unknown ? 'unknown' : 'complete';
    return { count: coverage === 'complete' ? rows.length : null, observedCount: rows.length,
      oldestAgeSeconds: rows.length ? Math.max(...rows.map(r => r.ageSeconds)) : null, coverage, scannedSources, sources: rows };
  };
  try {
    const root = safePath(join(bindings.stateDir, 'sources'));
    dir = fs.opendirSync(root);
    for (;;) {
      const entry = dir.readSync(); if (!entry) break;
      if (scannedSources >= maxSources || Date.now() - started >= maxMs || budget.left <= 0) { truncated = true; break; }
      scannedSources++;
      if (!uuid(entry.name) || !entry.isDirectory()) { unknown = true; continue; }
      const folder = join(root, entry.name), file = join(folder, 'retirement-deferred.json');
      try {
        try { fs.lstatSync(file); } catch (e) { if (e.code === 'ENOENT') continue; throw e; }
        const source = readBounded(join(folder, 'source.json'), 512 * 1024, budget);
        if (source.version !== 1 || source.id !== entry.name || source.bindings?.stateDir !== bindings.stateDir || typeof source.agent !== 'string' || typeof source.home !== 'string' || resolve(source.home) !== source.home) throw new Error('unknown source scope');
        if (source.once || (soul && source.agent !== soul) || (home && source.home !== home)) continue;
        const marker = readBounded(file, 4096, budget);
        if (!validMarker(marker, source.id, now)) throw new Error('unknown retirement obligation');
        rows.push({ id: source.id, since: marker.since, ageSeconds: Math.floor((now - epoch(marker.since)) / 1000), attempt: marker.attempt, reason: marker.reason });
      } catch { unknown = true; if (budget.left <= 0) { truncated = true; break; } }
    }
  } catch (e) { if (e.code !== 'ENOENT') unknown = true; }
  finally { if (dir) dir.closeSync(); }
  return summary();
}
export function retirementWarnings(observation) {
  const count = observation.count === null ? `at least ${observation.observedCount}` : String(observation.count);
  const values = { count, age: observation.oldestAgeSeconds ?? 'unknown', coverage: observation.coverage };
  const render = code => ({ code, message: RETIREMENT_REASON_TEMPLATES[code].replace(/<([a-zA-Z]+)>/g, (_, key) => String(values[key])) });
  return [...(observation.observedCount ? [render(RETIREMENT_WARNING_CODE)] : []), ...(observation.coverage !== 'complete' ? [render('retirement-observation-incomplete')] : [])];
}
