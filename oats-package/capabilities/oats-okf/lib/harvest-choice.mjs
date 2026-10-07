// Proposed 4.2.x onboarding follow-through (#53). This record is never consent.
// Runtime authority remains the current source policy and the existing holds.
import { fs, join, dirname, resolve, safePath, atomic, withLock } from './io.mjs';

const LIMIT = 16 * 1024;
const VALUES = ['on', 'off', 'deferred'];
const issue = (code, message) => ({ code, message });
const text = (value, limit) => typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= limit && !/[\x00-\x1f\x7f]/.test(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, names) => object(value) && Object.keys(value).every(key => names.includes(key));

/** The selected deployment's host file, not an instance's copied settings. */
export function localSettingsFile({ deployment, env = process.env, cwd = process.cwd() } = {}) {
  if (deployment) return fs.existsSync(join(deployment, 'oats-local.yaml')) ? join(deployment, 'oats-local.yaml') : null;
  if (env.OATS_WORKSPACE && fs.existsSync(join(env.OATS_WORKSPACE, 'oats-local.yaml'))) return join(env.OATS_WORKSPACE, 'oats-local.yaml');
  for (let dir = resolve(cwd); ; dir = dirname(dir)) {
    const file = join(dir, 'oats-local.yaml');
    if (fs.existsSync(file)) return file;
    if (dirname(dir) === dir) return null;
  }
}
export const choicePath = file => join(dirname(file), '.okf-harvest-choice.json');

function validateChoice(choice) {
  if (!exact(choice, ['value', 'owner', 'nextAction', 'recordedAt']) || !VALUES.includes(choice.value)
    || typeof choice.recordedAt !== 'string' || !Number.isFinite(Date.parse(choice.recordedAt))) throw Error('invalid choice');
  if (choice.value === 'deferred') {
    if (!text(choice.owner, 128) || !text(choice.nextAction, 512)) throw Error('invalid follow-through');
  } else if (choice.owner !== null || choice.nextAction !== null) throw Error('unexpected follow-through');
  return { value: choice.value, owner: choice.owner, nextAction: choice.nextAction, recordedAt: choice.recordedAt };
}

/** Private, bounded read. Missing is unrecorded, never an invented choice. */
export function readHarvestChoice(file) {
  if (!file) return { problems: [issue('choice-location-unknown', 'The deployment host file is not available; an explicit harvest choice cannot be observed.')] };
  const path = choicePath(file);
  let fd;
  try {
    safePath(path);
    let before;
    try { before = fs.lstatSync(path); } catch (error) { if (error.code === 'ENOENT') return { problems: [] }; throw error; }
    const valid = stat => stat.isFile() && stat.nlink === 1 && stat.size <= LIMIT && !(stat.mode & 0o077)
      && (typeof process.getuid !== 'function' || stat.uid === process.getuid());
    if (!valid(before)) throw Error('unsafe choice file');
    fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    const opened = fs.fstatSync(fd);
    if (!valid(opened) || opened.dev !== before.dev || opened.ino !== before.ino) throw Error('changed choice file');
    const bytes = Buffer.alloc(LIMIT + 1);
    let length = 0;
    while (length < bytes.length) { const count = fs.readSync(fd, bytes, length, bytes.length - length, null); if (!count) break; length += count; }
    const after = fs.fstatSync(fd);
    if (length > LIMIT || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs) throw Error('changed choice file');
    const record = JSON.parse(bytes.subarray(0, length).toString('utf8'));
    if (!exact(record, ['choice', 'pending']) || typeof record.pending !== 'boolean') throw Error('invalid record');
    const choice = validateChoice(record.choice);
    if (record.pending) return { problems: [issue('choice-write-incomplete', 'An explicit setup choice was interrupted; inspect the current setting and rerun the intended setup --harvest choice. No completed choice is recorded.')] };
    return { choice, problems: [] };
  } catch {
    return { problems: [issue('choice-unreadable', 'The private harvest choice record is unreadable or invalid; inspect its ownership, permissions and contents before retrying explicit setup.')] };
  } finally { if (fd !== undefined) fs.closeSync(fd); }
}

/** One pure precedence projection, shared by status and warning-only readiness.
 * policy is an observation, not a choice: {state, reason}. A blocker is a known
 * existing execution/registration hold. No output of this function authorizes work.
 */
export function projectHarvestState({ policy, choice, problems = [], blocker } = {}) {
  const out = { state: 'unknown', reason: issue('harvest-policy-unknown', 'Current harvest authority could not be established.'), ...(choice ? { choice } : {}), problems: [...problems] };
  if (!policy || !['on', 'off', 'unknown'].includes(policy.state)) return out;
  if (policy.state === 'unknown') { if (policy.reason) out.reason = policy.reason; return out; }
  if (policy.state === 'on') {
    if (choice?.value === 'deferred' || choice?.value === 'off') out.problems.push(issue('choice-policy-mismatch', 'Current harvest policy is ON despite the recorded inactive choice; the record cannot hide or change that authority.'));
    out.state = blocker ? 'blocked' : 'on';
    out.reason = blocker || policy.reason || issue('harvest-on', 'Harvest is enabled for new checkpoint work; this is not proof that capture or a model is currently running.');
    return out;
  }
  if (choice?.value === 'deferred' && policy.reason?.code !== 'soul-opt-out') {
    out.state = 'deferred';
    out.reason = issue('choice-deferred', 'Harvest is intentionally deferred and the effective switch is OFF; the named owner must revisit it explicitly.');
  } else {
    out.state = 'off';
    out.reason = policy.reason || issue('harvest-off', 'Harvest is OFF; no explicit choice is inferred from a default.');
  }
  return out;
}

/** Existing readiness wire: only code/message, never a new generic result key. */
export function harvestStateWarning(state) {
  const follow = state.state === 'deferred' && state.choice
    ? ` Owner: ${state.choice.owner}. Next action (recorded data): ${state.choice.nextAction}.` : '';
  return { code: `harvest-state:${state.state}`, message: `Harvest ${state.state}: ${state.reason.message}${follow}${state.choice ? '' : ' Explicit choice: unrecorded.'}` };
}

/** Explicit setup only. Reuse the provider's atomic files and cooperative lock.
 * The pending record prevents a crash between setting and choice from leaving a
 * stale, apparently completed choice. It never controls execution. Reads never
 * finish an interrupted write; only another explicit setup can do so.
 */
export function persistHarvestChoice({ file, value, owner, nextAction, edit, write = atomic, now = () => new Date().toISOString() }) {
  let written = false;
  const failure = (code, message) => Object.assign(new Error(message), { code, result: { written, choiceRecorded: false } });
  if (!VALUES.includes(value)) throw failure('E_USAGE', '--harvest must be on, off or deferred');
  if (value === 'deferred' ? !text(owner, 128) || !text(nextAction, 512) : owner !== undefined || nextAction !== undefined) {
    throw failure('E_USAGE', 'Deferred requires nonempty single-line --owner (up to128 characters) and --next-action (up to512); these flags are only for deferred and are recorded as data.');
  }
  if (!file) throw failure('E_HARVEST_CHOICE', 'No deployment oats-local.yaml was found; configure the deployment host file, then rerun the explicit harvest choice. The setting was not written and the choice was not recorded.');
  const choice = { value, owner: value === 'deferred' ? owner : null, nextAction: value === 'deferred' ? nextAction : null, recordedAt: now() };
  const path = choicePath(file), setting = value === 'on' ? 'on' : 'off';
  try {
    return withLock(`${path}.lock`, () => {
      safePath(file); safePath(path);
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.nlink !== 1 || (typeof process.getuid === 'function' && stat.uid !== process.getuid())) throw Error('unsafe host file');
      const previous = readHarvestChoice(file);
      if (previous.problems.some(problem => problem.code === 'choice-unreadable')) throw Error('unsafe existing choice');
      const before = fs.readFileSync(file, 'utf8'), after = edit(before, setting);
      if (after === null) throw Error('unsupported host file shape');
      write(path, JSON.stringify({ choice, pending: true }) + '\n');
      try { write(file, after); written = true; }
      catch (error) {
        // Atomic rename may have happened before a directory fsync failed.
        // Read back the exact expected bytes; inability to read is uncertain.
        try {
          const observed = fs.lstatSync(file), bytes = fs.readFileSync(file, 'utf8');
          written = observed.ino !== stat.ino && bytes === after ? true
            : observed.ino === stat.ino && bytes === before ? false : null;
        } catch { written = null; }
        throw error;
      }
      write(path, JSON.stringify({ choice, pending: false }) + '\n');
      return { written, choiceRecorded: true, file, harvest: setting, choice };
    }, { waitMs: 5000, reclaimDead: true });
  } catch (error) {
    const outcome = written === true ? 'The requested setting was written' : written === false ? 'The setting was not written' : 'The setting write could not be confirmed';
    throw failure('E_HARVEST_CHOICE', `${outcome}; the choice was not confirmed recorded. No rollback is claimed. Inspect the host file and private choice record (including permissions or an incomplete write), then rerun the intended setup --harvest choice; a live lock must be allowed to finish. Cause: ${error.code || 'write-or-validation-failed'}.`);
  }
}
