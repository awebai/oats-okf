// #54: an explicit NEW operator decision, never reconstructed preview history.
import { isAbsolute } from 'node:path';
import { hostname, userInfo } from 'node:os';
import { fs, join, dirname, resolve, safePath, hash, save, withLock, fail, quote } from './io.mjs';
import { loadSource } from './sources.mjs';
import { declaration } from './config.mjs';
import { checkOnceIdentity, targetOnceIdentity } from './once-identity.mjs';

const MAX_METADATA = 1024 * 1024, MAX_SOURCES = 512;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const qualified = value => typeof value === 'string' && !isAbsolute(value) && /^[^#\x00-\x20]+#[^#\x00-\x20]+$/.test(value);
const legacy = value => typeof value === 'string' && isAbsolute(value) && resolve(value) === value && !/[\x00-\x1f\x7f]/.test(value);
const noIdentity = source => source.soulId === null || source.soulId === undefined;
const ownerError = message => fail('E_OWNER', `${message}; inspect the retained source/once receipt and owner registry. Never use --force, retire the registration, or change state namespace to bypass it`);
export const onceSeatLock = (stateDir, instance, owner) => join(stateDir, `once-${hash({ instance, owner }).slice(0, 16)}.lock`);
const receiptPath = source => join(dirname(source.file), 'once.json');

/** Read metadata only, never note/input/transcript bytes. */
function metadata(file, { privateFile = true } = {}) {
  safePath(file);
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > MAX_METADATA || (stat.mode & (privateFile ? 0o077 : 0o022)) || (typeof process.getuid === 'function' && stat.uid !== process.getuid())) ownerError('metadata is not a bounded private owned regular file');
    const bytes = Buffer.alloc(MAX_METADATA + 1); let length = 0;
    while (length < bytes.length) { const n = fs.readSync(fd, bytes, length, bytes.length - length, null); if (!n) break; length += n; }
    const after = fs.fstatSync(fd);
    if (length > MAX_METADATA || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) ownerError('metadata changed while it was read');
    return { value: JSON.parse(bytes.subarray(0, length).toString('utf8')), digest: hash(bytes.subarray(0, length)) };
  } finally { fs.closeSync(fd); }
}
function owners(source) {
  const file = join(source.bindings.stateDir, 'owners.json');
  if (!fs.existsSync(file)) return { file, values: {} };
  const values = metadata(file).value;
  if (!object(values)) ownerError('owner registry is malformed');
  return { file, values };
}
function sourceRows(anchor) {
  const dir = join(anchor.bindings.stateDir, 'sources');
  const names = fs.readdirSync(dir).sort();
  if (names.length > MAX_SOURCES) ownerError('owner evidence exceeds the bounded source inventory');
  const rows = [];
  for (const name of names) {
    if (!/^[0-9a-f-]{36}$/.test(name)) ownerError('source inventory has an unrecognized entry');
    const file = join(dir, name, 'source.json');
    let raw; try { raw = metadata(file); } catch { ownerError('source inventory contains unreadable evidence'); }
    if (!object(raw.value)) ownerError('source inventory contains malformed metadata');
    if (raw.value.owner !== anchor.owner) continue;
    const source = loadSource(file);
    rows.push({ source, digest: raw.digest });
  }
  return rows;
}
export function rebindCommand(source, pin) {
  return `cd ${quote(source.context)} && oats okf owner-rebind --source ${quote(source.file)} --expect-pin ${quote(pin)} --soul ${quote(source.agent)} --json`;
}

/** Normal once never repairs an owner. It offers only the explicit action for
 * the eligible unqualified legacy case, after the selected target was checked.
 */
export function requireOnceOwner(source) {
  const { values } = owners(source), prior = values[source.owner];
  if (prior === undefined || prior === source.soulId) return;
  if (legacy(prior)) {
    const anchor = sourceRows(source).map(row => row.source).find(s => s.once && noIdentity(s) && s.soulDir === prior && s.home === source.home && s.instance === source.instance && s.agent === source.agent);
    if (anchor) fail('E_OWNER', `an unqualified legacy path pin cannot establish historical identity. The operator may make a NEW recorded decision, without changing old receipts or inputs: ${rebindCommand(anchor, prior)} (append --plan for a read-only preview)`);
  }
  ownerError('owner pin conflicts with the selected qualified source');
}

function decisionKey(row) {
  return hash({ kind: row.kind, operator: row.operator, note: row.note, from: row.from, to: row.to, owner: row.owner, affectedSources: row.affectedSources });
}
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function validDecision(row) {
  return object(row) && row.kind === 'explicit-operator-rebind' && object(row.operator)
    && typeof row.operator.user === 'string' && typeof row.operator.host === 'string'
    && (row.operator.uid === null || Number.isSafeInteger(row.operator.uid))
    && (row.note === null || typeof row.note === 'string') && typeof row.at === 'string' && Number.isFinite(Date.parse(row.at))
    && legacy(row.from) && qualified(row.to) && typeof row.owner === 'string'
    && Array.isArray(row.affectedSources) && row.affectedSources.length > 0 && row.affectedSources.length <= MAX_SOURCES
    && row.affectedSources.every(s => object(s) && /^[a-f0-9-]{36}$/.test(s.id) && digest(s.descriptorHash) && digest(s.manifestHash))
    && digest(row.id) && row.id === decisionKey(row);
}
/** A deliberate later decision can authorize retained null-id replay, but only
 * while registry and immutable descriptor/manifest still match that decision.
 */
export function retainedOnceIdentity(source, id) {
  if (source.soulId === id) return true;
  if (!noIdentity(source) || !source.once || owners(source).values[source.owner] !== id) return false;
  const receipt = metadata(receiptPath(source)).value, digest = metadata(source.file).digest;
  return Array.isArray(receipt.ownerDecisions) && receipt.ownerDecisions.some(row => validDecision(row)
    && row.owner === source.owner && row.to === id
    && row.from === source.soulDir && Array.isArray(row.affectedSources)
    && row.affectedSources.some(s => s.id === source.id && s.descriptorHash === digest && s.manifestHash === source.once.manifestHash));
}

function observe(anchor, expected, id, env) {
  const registry = owners(anchor), prior = registry.values[anchor.owner];
  if (!legacy(prior)) ownerError('owner pin is already qualified, captured, absent or malformed; owner-rebind changes only an unqualified legacy path');
  if (prior !== expected) ownerError('owner pin changed since the expected value was read');
  if (!anchor.once || !noIdentity(anchor) || anchor.soulDir !== prior || anchor.providerBinding) ownerError('anchor is not a null-id legacy one-shot naming that exact pin');
  const rows = sourceRows(anchor), affected = [];
  for (const row of rows) {
    const s = row.source;
    if (s.providerBinding || s.registration || s.sourceIdentity) ownerError('a captured descriptor shares this owner');
    if (s.decl?.owner !== anchor.owner) ownerError('a descriptor declaration has a different owner');
    if (!noIdentity(s)) {
      if (s.soulId !== id) ownerError('a different qualified descriptor shares this owner');
      continue;
    }
    if (!s.once || s.soulDir !== prior || s.agent !== anchor.agent) ownerError('an unqualified descriptor has a conflicting source/path');
    let target;
    try { target = metadata(join(s.home, 'instance.json'), { privateFile: false }).value; }
    catch { ownerError('an affected source target record is unavailable'); }
    if (target.instance !== s.instance || target.agent !== s.agent || targetOnceIdentity(target, env) !== id) ownerError('an affected source has a conflicting target identity');
    const state = metadata(join(dirname(s.file), 'status.json')).value;
    if (!object(state) || !object(state.captured) || !Array.isArray(state.captured.inputs)) ownerError('an affected source has malformed custody status');
    if (state.activeRun) ownerError('an affected source has an active run; finish its existing work before owner-rebind');
    const receipt = metadata(receiptPath(s)).value;
    if (!object(receipt) || receipt.manifestHash !== s.once.manifestHash || !Array.isArray(receipt.inputs) || !Array.isArray(receipt.runs)
      || (receipt.ownerDecisions !== undefined && (!Array.isArray(receipt.ownerDecisions) || !receipt.ownerDecisions.every(validDecision)))) ownerError('an affected once receipt is missing or inconsistent');
    affected.push({ ...row, receipt });
  }
  if (!affected.some(row => row.source.id === anchor.id)) ownerError('anchor vanished from the owner inventory');
  return { registry, affected };
}
const lockAll = (paths, fn, index = 0) => index === paths.length ? fn() : withLock(paths[index], () => lockAll(paths, fn, index + 1), { waitMs: 0, reclaimDead: true });

export function ownerRebind({ source: file, expectPin, by, plan = false, env = process.env, write = save }) {
  if (!file || !legacy(expectPin)) fail('E_USAGE', 'owner-rebind needs --source and --expect-pin with the exact old absolute path');
  if (by !== undefined && (typeof by !== 'string' || !by.trim() || by.length > 512 || /[\x00-\x1f\x7f]/.test(by))) fail('E_USAGE', '--by is an optional bounded single-line operator-supplied note');
  const anchor = loadSource(resolve(file));
  if (anchor.providerBinding) ownerError('captured owner rebinding is not admitted');
  if (env.OATS_INSTANCE_HOME && resolve(env.OATS_INSTANCE_HOME) === anchor.home) fail('E_INVOCATION', 'owner-rebind is an explicit deployment operator action, not the target seat\'s own action');
  const meta = metadata(join(anchor.home, 'instance.json'), { privateFile: false }).value;
  const id = checkOnceIdentity({ meta, context: anchor.context }, env);
  if (!qualified(id)) ownerError('owner-rebind needs a kernel-qualified workspace soul identity');
  if (meta.instance !== anchor.instance || meta.agent !== anchor.agent || declaration(env.OATS_SOUL).owner !== anchor.owner) ownerError('target identity or selected declaration owner differs from the anchor');
  const initial = observe(anchor, expectPin, id, env);
  const operator = { user: userInfo().username, uid: typeof process.getuid === 'function' ? process.getuid() : null, host: hostname() };
  const describe = view => ({ owner: anchor.owner, from: expectPin, to: id, sources: view.affected.map(row => row.source.id) });
  if (plan) return { ...describe(initial), plan: true, changed: false, operator, operatorNote: by ?? null, command: rebindCommand(anchor, expectPin), note: 'A new operator decision, not proof of the old preview\'s identity. No file was written and no harvest will be launched.' };
  const seats = [...new Set(initial.affected.map(({ source: s }) => onceSeatLock(s.bindings.stateDir, s.instance, s.owner)))].sort();
  const workers = initial.affected.map(({ source: s }) => join(dirname(s.file), 'worker.lock')).sort();
  let audited = [], changed = false;
  try {
    return lockAll(seats, () => lockAll(workers, () => withLock(join(anchor.bindings.stateDir, 'owners.lock'), () => {
      const current = observe(anchor, expectPin, id, env);
      if (hash(describe(current)) !== hash(describe(initial))) ownerError('affected source inventory changed; read a fresh plan');
      const row = { kind: 'explicit-operator-rebind', operator, note: by ?? null,
        at: new Date().toISOString(), from: expectPin, to: id, owner: anchor.owner,
        affectedSources: current.affected.map(({ source: s, digest }) => ({ id: s.id, descriptorHash: digest, manifestHash: s.once.manifestHash })) };
      row.id = decisionKey(row);
      for (const { receipt } of current.affected) {
        if (Buffer.byteLength(JSON.stringify({ ...receipt, ownerDecisions: [...(receipt.ownerDecisions || []), row] })) > MAX_METADATA - 8192) ownerError('owner decision would exceed the bounded receipt size');
      }
      if (Buffer.byteLength(JSON.stringify({ ...current.registry.values, [anchor.owner]: id })) > MAX_METADATA - 8192) ownerError('owner registry update would exceed its bounded size');
      for (const { source: s, receipt } of current.affected) {
        const history = receipt.ownerDecisions || [];
        if (!history.some(decision => decision.id === row.id)) write(receiptPath(s), { ...receipt, ownerDecisions: [...history, row] });
        audited.push(s.id);
      }
      // The audit of this new decision is durable before the shared pin changes.
      try { write(current.registry.file, { ...current.registry.values, [anchor.owner]: id }); changed = true; }
      catch (error) { try { changed = owners(anchor).values[anchor.owner] === id; } catch { changed = null; } throw error; }
      return { ...describe(current), plan: false, changed: true, decision: row.id, audited, note: 'Old source identity fields, receipts and inputs are retained; no harvest was launched. Continue the reviewed once manifest explicitly.' };
    }, { waitMs: 0, reclaimDead: true })));
  } catch (error) {
    throw Object.assign(new Error(`owner-rebind did not complete normally; audit confirmed for ${audited.length} source(s), owner change ${changed === null ? 'unknown' : changed ? 'confirmed' : 'not confirmed'}. No rollback is claimed. ${changed === false ? `Retry the exact explicit command after resolving the cause: ${rebindCommand(anchor, expectPin)}` : 'Inspect owners.json and the retained once receipt before any further action; a qualified pin is never rebound again.'}`),
      { code: error.code || 'E_OWNER', result: { changed, audited, from: expectPin, to: id } });
  }
}
