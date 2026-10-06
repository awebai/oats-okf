// `oats okf setup --remove-schedules` (okf 4.2.0): the explicit deployment
// step that takes the scheduler jobs okf <= 4.1 created out of the kernel
// scheduler. Every registered source of the configured state namespace is
// enumerated; its job, okf-<source id>, is removed only after the actual
// definition proves it is that source's own (its command, source path and
// deployment). Never by the okf- prefix alone, never forced: a job that is
// running or has unresolved effects stays disabled and is reported. The
// original definition and every confirmed effect are kept as evidence in the
// source's own state. The shared host timer is never touched.
import { fs, join, dirname, readJSON, save, hash, oats, quote } from './io.mjs';
import { loadBindings } from './config.mjs';
import { loadSource, loadStatus, updateStatus, legacyScheduleId, legacyScheduleArgv } from './sources.mjs';

const receiptPath = (source) => join(dirname(source.file), 'schedule-migration.json');
/** Append one confirmed (or failed) effect to the source's migration receipt. */
function effect(source, job, row) {
  const file = receiptPath(source);
  const receipt = fs.existsSync(file) ? readJSON(file) : { version: 1, job, effects: [] };
  receipt.effects.push({ ...row, at: new Date().toISOString() });
  save(file, receipt);
}
/** Keep the definition as observed, before anything changes it. */
function keepDefinition(source, job, definition) {
  const file = join(dirname(source.file), 'schedule-migration', `definition-${hash(definition)}.json`);
  if (!fs.existsSync(file)) save(file, { version: 1, job, observedAt: new Date().toISOString(), definition });
  return file;
}
/** Which fields of the actual job differ from what this source's registration created. */
function ownershipMismatch(source, job, actual) {
  const expected = { id: job, kind: 'command', cwd: source.context, argv: legacyScheduleArgv(source) };
  const differs = Object.keys(expected).filter((k) => JSON.stringify(actual[k]) !== JSON.stringify(expected[k]));
  const e = source.executionBinding;
  if (e && actual.execution && (actual.execution.deployment !== e.deployment || actual.execution.resolution?.id !== e.resolution.id)) differs.push('execution');
  return differs;
}
const inspect = (source, job) => `oats schedule show ${quote(job)} --dir ${quote(source.context)}`;
function markRemoved(source, job, how) {
  updateStatus(source, (status) => { status.schedule = { ...(status.schedule || {}), id: job, removed: true, removedAt: new Date().toISOString(), removedBy: how }; });
}
/** One source's job. → a row; only `removed` and `absent` are done. */
function removeOne(source) {
  const job = legacyScheduleId(source), at = { dir: source.context };
  const call = (args) => oats(['schedule', ...args, job, '--dir', source.context, '--json'], source.context);
  let actual;
  try { actual = call(['show']).schedule; }
  catch (e) {
    if (e.code === 'E_SCHEDULE_UNKNOWN') { markRemoved(source, job, 'absent'); return { job, ...at, status: 'absent' }; }
    return { job, ...at, status: 'failed', code: 'E_SCHEDULE_MIGRATION_PENDING', error: `${e.code || 'E_RUNTIME'}: ${e.message}`, next: `inspect: ${inspect(source, job)}; then rerun oats okf setup --remove-schedules` };
  }
  if (!actual || typeof actual !== 'object') return { job, ...at, status: 'failed', code: 'E_SCHEDULE_MIGRATION_PENDING', error: 'the scheduler answered no definition', next: `inspect: ${inspect(source, job)}` };
  const differs = ownershipMismatch(source, job, actual);
  if (differs.length) return { job, ...at, status: 'foreign', code: 'E_SCHEDULE_OWNERSHIP', differs, next: `inspect: ${inspect(source, job)}: it is not the job source ${source.id} registered (${differs.join(', ')} differ); it was left untouched. Remove or rename it yourself if it is not wanted.` };
  const evidence = keepDefinition(source, job, actual);
  if (actual.enabled !== false) {
    try { call(['disable']); effect(source, job, { step: 'disable', result: 'confirmed' }); }
    catch (e) {
      if (e.code === 'E_SCHEDULE_UNKNOWN') { markRemoved(source, job, 'absent'); return { job, ...at, status: 'absent', evidence }; }
      effect(source, job, { step: 'disable', result: 'unknown', error: `${e.code || 'E_RUNTIME'}: ${e.message}` });
      return { job, ...at, status: 'failed', code: 'E_SCHEDULE_MIGRATION_PENDING', evidence, error: `disable: ${e.message}`, next: `inspect: ${inspect(source, job)}; then rerun oats okf setup --remove-schedules` };
    }
  }
  try { call(['remove']); }
  catch (e) {
    if (e.code === 'E_SCHEDULE_UNKNOWN') { markRemoved(source, job, 'absent'); return { job, ...at, status: 'absent', evidence }; }
    const running = e.code === 'E_SCHEDULE_RUNNING';
    effect(source, job, { step: 'remove', result: running ? 'pending' : 'unknown', error: `${e.code || 'E_RUNTIME'}: ${e.message}` });
    return { job, ...at, status: running ? 'pending' : 'failed', code: 'E_SCHEDULE_MIGRATION_PENDING', disabled: true, evidence, error: e.message,
      next: running ? `inspect: ${inspect(source, job)}; settle: let its run end, or resolve its unresolved attempt with oats schedule reconcile; never --force; then rerun oats okf setup --remove-schedules`
        : `inspect: ${inspect(source, job)}; then rerun oats okf setup --remove-schedules` };
  }
  effect(source, job, { step: 'remove', result: 'confirmed' });
  markRemoved(source, job, 'remove-schedules');
  return { job, ...at, status: 'removed', evidence };
}
export function removeSchedules() {
  const bindings = loadBindings(), dir = join(bindings.stateDir, 'sources');
  const rows = [];
  for (const id of fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []) {
    const file = join(dir, id, 'source.json');
    let source;
    try { source = loadSource(file); loadStatus(source); }
    catch (e) { if (fs.existsSync(join(dir, id))) rows.push({ source: id, status: 'failed', code: 'E_SCHEDULE_MIGRATION_PENDING', error: `source unreadable: ${e.code || 'E_SOURCE'}: ${e.message}`, next: `inspect ${quote(file)}; its job (okf-${id}), if any, was not touched` }); continue; }
    if (source.once) continue; // a one-shot never had a job
    rows.push({ source: id, soul: source.agent, instance: source.instance, ...removeOne(source) });
  }
  const done = rows.filter((r) => ['removed', 'absent'].includes(r.status)), leftovers = rows.filter((r) => !done.includes(r));
  const result = { stateDir: bindings.stateDir, jobs: rows, removed: rows.filter((r) => r.status === 'removed').map((r) => r.job), absent: rows.filter((r) => r.status === 'absent').map((r) => r.job), leftovers,
    note: 'Only jobs proven to be their source\'s own were disabled and removed; definitions and effects are kept under each source. The shared host timer and every other job are untouched. Confirm with oats schedule list.' };
  if (leftovers.length) {
    const code = leftovers.some((r) => r.code === 'E_SCHEDULE_OWNERSHIP') ? 'E_SCHEDULE_OWNERSHIP' : 'E_SCHEDULE_MIGRATION_PENDING';
    const list = (rs) => rs.map((r) => `${r.job || `okf-${r.source}`} (${r.status}: ${r.next || r.error})`).join('; ');
    throw Object.assign(new Error(`${leftovers.length} of ${rows.length} legacy okf jobs remain: ${list(leftovers)}. Done: ${done.length ? done.map((r) => `${r.job} ${r.status}`).join(', ') : 'none'}.`), { code, result });
  }
  return result;
}
