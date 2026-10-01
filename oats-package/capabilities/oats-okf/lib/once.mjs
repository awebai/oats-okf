// `oats okf harvest --once` (okf 4.1.0): one reviewed harvest of one seat from
// an explicit, hash-verified record set, run by the operator. It registers
// nothing (no home pointer, no schedule, no capture); its custody is a source
// descriptor marked `once`, so the normal judgment, publication and review
// path (and the okf-harvest wrappers, which accept only sources/<id>/) apply.
import { createHash } from 'node:crypto';
import { fs, join, dirname, resolve, safePath, readJSON, save, hash, fail, within, relPath } from './io.mjs';
import { describeSeat, sourceFor, installSource, loadSource, loadStatus, updateStatus, input } from './sources.mjs';
import { soulHarvest } from './harvest-switch.mjs';
import { runSource, readRun } from './worker.mjs';

const MANIFEST_KEYS = ['version', 'instance', 'roots', 'notes', 'sessions'];
const MAX_ENTRIES = 2000, MAX_FILE = 16 * 1024 * 1024, MAX_TOTAL = 256 * 1024 * 1024;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const records = message => fail('E_RECORDS', message);

/** Read a file the manifest names: a regular, single-link file reached
 *  through no symlink, inside one of `roots`. Its bytes are read once, and
 *  only those bytes are hashed and used. → {name, bytes} */
function readEntry(path, roots) {
  const target = resolve(path);
  const root = roots.find(r => within(r.dir, target) && target !== r.dir);
  if (!root) fail('E_PATH', `${path} is outside the home and the manifest's roots`);
  try { safePath(target); } catch (e) { if (e.code === 'E_PATH') fail('E_PATH', `${path}: symlink not allowed (${e.message})`); throw e; }
  let stat;
  try { stat = fs.lstatSync(target); } catch { fail('E_PATH', `${path}: no such file`); }
  if (!stat.isFile()) fail('E_PATH', `${path}: not a regular file (no directories, no globbing)`);
  if (stat.nlink !== 1) fail('E_PATH', `${path}: hardlink not allowed`);
  if (stat.size > MAX_FILE) records(`${path} exceeds ${MAX_FILE} bytes`);
  const fd = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  let bytes; try { bytes = fs.readFileSync(fd); } finally { fs.closeSync(fd); }
  // Named relative to its root: the receipt and provenance never carry paths.
  return { name: relPath(target.slice(root.dir.length + 1)), bytes };
}

/** Validate a manifest and read every entry it names, all before anything is
 *  stored. → {manifestHash, notes:[{name, sha256, text}]} */
export function readManifest(file, home, instance) {
  if (typeof file !== 'string' || !file.startsWith('/')) fail('E_USAGE', '--records must be an absolute manifest path');
  safePath(file);
  let manifest; try { manifest = readJSON(file); } catch (e) { records(`manifest unreadable: ${e.code || e.message}`); }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) records('manifest must be a JSON object');
  const unknown = Object.keys(manifest).filter(k => !MANIFEST_KEYS.includes(k));
  if (unknown.length) records(`unknown manifest keys: ${unknown.join(', ')}`);
  if (manifest.version !== 1) records('manifest version must be 1');
  if (manifest.instance !== instance) records(`manifest instance ${JSON.stringify(manifest.instance)} is not the seat's instance ${instance}`);
  if (manifest.sessions !== undefined && (!Array.isArray(manifest.sessions) || manifest.sessions.length)) {
    // Session records come into the turn record through the kernel; okf never
    // parses harness formats itself.
    fail('E_UNSUPPORTED', 'session entries need the kernel feature capture-file (`oats capture --file`), which this OATS does not offer yet; harvest the notes now, the sessions with a later oats.okf');
  }
  if (!Array.isArray(manifest.notes) || !manifest.notes.length) records('manifest needs a non-empty notes list');
  if (manifest.notes.length > MAX_ENTRIES) records(`at most ${MAX_ENTRIES} entries`);
  if (manifest.roots !== undefined && !Array.isArray(manifest.roots)) records('roots must be a list of absolute directories');
  const roots = [{ dir: fs.realpathSync(home), home: true }];
  for (const root of manifest.roots || []) {
    if (typeof root !== 'string' || !root.startsWith('/')) records('every root must be an absolute directory');
    try { safePath(root); } catch (e) { if (e.code === 'E_PATH') fail('E_PATH', `root ${root}: symlink not allowed`); throw e; }
    if (!fs.lstatSync(root, { throwIfNoEntry: false })?.isDirectory()) fail('E_PATH', `root ${root} is not a directory`);
    roots.push({ dir: resolve(root), home: false });
  }
  const seen = new Set(), notes = []; let total = 0;
  for (const entry of manifest.notes) {
    if (!entry || typeof entry !== 'object' || Object.keys(entry).some(k => !['path', 'sha256'].includes(k))) records('a note entry is {path, sha256}');
    if (typeof entry.path !== 'string' || !entry.path) records('a note entry needs a path');
    if (typeof entry.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(entry.sha256)) records(`${entry.path}: sha256 must be 64 lowercase hex`);
    if (!entry.path.endsWith('.md')) records(`${entry.path}: notes are .md files`);
    const path = entry.path.startsWith('/') ? entry.path : join(home, entry.path);
    if (seen.has(resolve(path))) records(`${entry.path}: duplicate entry`);
    seen.add(resolve(path));
    const { name, bytes } = readEntry(path, roots);
    if (sha256(bytes) !== entry.sha256) records(`sha256 mismatch for ${entry.path} (manifest ${entry.sha256}, file ${sha256(bytes)})`);
    if ((total += bytes.length) > MAX_TOTAL) records(`entries exceed ${MAX_TOTAL} bytes in total`);
    notes.push({ name, sha256: entry.sha256, text: bytes.toString('utf8') });
  }
  return { manifestHash: hash(manifest), notes };
}

/** A UUID-shaped id derived from what makes a one-shot the same one. */
function onceId(instance, owner, manifestHash) {
  const h = hash({ once: 1, instance, owner, manifestHash });
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}
const receiptPath = source => join(dirname(source.file), 'once.json');

/** The soul's own opt-out, refused unless the operator overrides it. */
function checkOptOut(soulDir, override) {
  const soul = soulHarvest(soulDir);
  if (soul.value === 'off' || !soul.readable) {
    if (override) return;
    const why = soul.value === 'off' ? 'the soul opts out of harvest (knowledge: { harvest: off })' : `the soul's opt-out could not be read (${soul.why})`;
    fail('E_HARVEST_OFF', `${why}; nothing was harvested. To harvest this seat anyway, rerun with --override-opt-out: the override is recorded in the PR's provenance and in the receipt.`);
  }
}

/** Refuse inputs another one-shot of the same seat already processed. */
function refuseOverlap(stateDir, self, ids) {
  const dir = join(stateDir, 'sources');
  for (const id of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    if (id === self.id) continue;
    let other; try { other = readJSON(join(dir, id, 'source.json')); } catch { continue; }
    if (!other.once || other.instance !== self.instance || other.owner !== self.owner) continue;
    const processed = new Set(readJSON(join(dir, id, 'status.json')).processed);
    const repeated = ids.filter(i => processed.has(i));
    if (repeated.length) fail('E_ONCE_OVERLAP', `${repeated.length} of these notes were already harvested by one-shot ${id} (receipt ${join(dir, id, 'once.json')}); list only notes it did not harvest`);
  }
}

function progress(source) {
  const status = loadStatus(source), total = status.captured.inputs.length;
  const processed = status.captured.inputs.filter(i => status.processed.includes(i)).length;
  return { total, processed, remaining: total - processed, status };
}

/** One step of a one-shot harvest: create it on the first call, then run its
 *  next bounded run; a rerun with the same manifest continues it. */
export function harvestOnce({ home, records: manifestFile, overrideOptOut = false, noLaunch = false, env = process.env }) {
  if (typeof home !== 'string' || !home.startsWith('/')) fail('E_USAGE', '--once needs --home <absolute instance home>');
  home = fs.realpathSync(safePath(home));
  const caller = env.OATS_INSTANCE_HOME;
  if (caller && fs.existsSync(caller) && fs.realpathSync(caller) === home) fail('E_INVOCATION', 'a seat does not harvest itself on demand: run harvest --once from the deployment, as the operator');
  const seat = describeSeat(home, { fromHome: true });
  const soulName = String(seat.meta.workspace?.soul?.id || '').split('#')[1] || seat.agent;
  const named = /^name:\s*(\S+)\s*$/m.exec(fs.existsSync(join(seat.soul, 'soul.yaml')) ? fs.readFileSync(join(seat.soul, 'soul.yaml'), 'utf8') : '')?.[1]?.replace(/^['"]|['"]$/g, '');
  if (named !== soulName) fail('E_INVOCATION', `the soul given (${named || 'unnamed'}) is not this seat's soul (${soulName}); pass --soul ${soulName}`);
  checkOptOut(seat.soul, overrideOptOut);
  const { manifestHash, notes } = readManifest(manifestFile, home, seat.instance);
  const id = onceId(seat.instance, seat.decl.owner, manifestHash);
  let source = sourceFor(id, seat, { once: { manifestHash, override: !!overrideOptOut } });
  if (fs.existsSync(source.file)) source = loadSource(source.file);
  else {
    const payloads = notes.map(n => ({ version: 1, kind: 'note', name: n.name, contentHash: hash(n.text), text: n.text }));
    refuseOverlap(seat.bindings.stateDir, source, payloads.map(p => hash(p)));
    installSource(source, { marker: false, status: { auto: false } });
    for (const payload of payloads) save(join(dirname(source.file), 'inputs', `${hash(payload)}.json`), payload);
    updateStatus(source, status => { status.captured.inputs = payloads.map(p => hash(p)); });
    save(receiptPath(source), { version: 1, manifestHash, override: !!overrideOptOut, verifiedAt: new Date().toISOString(),
      entries: notes.map(n => ({ kind: 'note', name: n.name, sha256: n.sha256 })), inputs: payloads.map(p => hash(p)), runs: [] });
  }
  for (const i of loadStatus(source).captured.inputs) input(source, i); // re-verify durable evidence
  const before = progress(source);
  if (!before.remaining && !before.status.activeRun) return answer(source, { status: 'already-delivered' });
  const result = runSource(source, { manual: true, noLaunch });
  const receipt = readJSON(receiptPath(source));
  if (result.run && !receipt.runs.includes(result.run)) { receipt.runs.push(result.run); save(receiptPath(source), receipt); }
  return answer(source, result);
}

function answer(source, result) {
  const { total, processed, remaining, status } = progress(source);
  const run = result.run ? readRun(source, result.run) : null;
  const pending = run ? total - processed - (status.activeRun === run.id ? run.inputs.length : 0) : remaining;
  const next = result.status === 'already-delivered'
    ? 'every listed note was harvested; nothing to do'
    : pending > 0 ? `${pending} inputs remain; rerun the same command to continue once this run is processed` : 'this run holds the last inputs';
  return { ...result, source: source.file, once: source.once, inputs: { total, processed, remaining: pending }, delivered: status.delivered, next };
}
