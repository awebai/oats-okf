// The harvester's private, instance-local input. No source registry, external
// custody, lifecycle relation or publication authority is created here.
import * as fs from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

export const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const MAX_FILE = 4 * 1024 * 1024;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const present = path => { try { fs.lstatSync(path); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } };
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const parse = (bytes, label) => { try { return JSON.parse(bytes); } catch { fail('E_SOURCE', `${label} is not readable JSON`); } };

// Every component below a trusted directory is checked; neither a symlinked
// note directory nor a FIFO is a file to read. Descriptor checks close a leaf
// replacement race. Like the kernel, this is consistency, not a UID sandbox.
function readWithin(root, path) {
  const rel = relative(root, path);
  if (!rel || isAbsolute(rel) || rel.split(sep).some(p => !p || p === '..' || p === '.')) fail('E_SOURCE', 'source file escapes its verified directory');
  let at = root;
  for (const part of [null, ...rel.split(sep)]) {
    if (part !== null) at = join(at, part);
    const st = fs.lstatSync(at);
    if (st.isSymbolicLink() || (at !== path && !st.isDirectory())) fail('E_SOURCE', 'source path contains a symlink or non-directory');
  }
  const before = fs.lstatSync(path);
  if (!before.isFile() || before.size > MAX_FILE) fail('E_SOURCE', 'source file is not regular or exceeds 4 MiB');
  const fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.dev !== before.dev || st.ino !== before.ino || st.size > MAX_FILE) fail('E_SOURCE', 'source file changed while opening');
    const bytes = Buffer.alloc(st.size + 1);
    let n = 0, count;
    while (n < bytes.length && (count = fs.readSync(fd, bytes, n, bytes.length - n, null)) > 0) n += count;
    const after = fs.fstatSync(fd);
    if (n !== st.size || after.size !== st.size || after.mtimeMs !== st.mtimeMs || after.ctimeMs !== st.ctimeMs) fail('E_SOURCE', 'source file changed while reading');
    return bytes.subarray(0, n);
  } finally { fs.closeSync(fd); }
}
const readAbsolute = path => {
  if (typeof path !== 'string' || !isAbsolute(path)) fail('E_SOURCE', 'recorded source path is not absolute');
  // A recorded soul or bindings location is authority, not a proposal path.
  return readWithin(fs.realpathSync(dirname(path)), join(fs.realpathSync(dirname(path)), basename(path)));
};

export function proposalSource(task) {
  if ((String(task).match(/^Source:/gm) || []).length > 1) fail('E_SOURCE', 'the proposal has more than one `Source:` line; exactly one names the source');
  const m = /^Source:\s*instance\s+(\S+?),\s*home\s+(\S+?),\s*soul\s+(\S+?)\s*$/m.exec(task);
  if (!m) fail('E_SOURCE', 'the task is not an oats.okf 5.0 proposal: it has no `Source: instance <name>, home <path>, soul <name>` line; a harvester is spawned only on a proposal');
  const [, instance, home, soul] = m;
  if (!NAME.test(instance) || !NAME.test(soul)) fail('E_SOURCE', 'the proposal\'s source instance and soul must be plain names');
  if (!isAbsolute(home)) fail('E_SOURCE', 'the proposal\'s source home must be absolute');
  return { instance, home: resolve(home), soul };
}

export function kernelEvents({ instance, home, deployment }) {
  const cli = process.env.OATS_CLI_BIN;
  if (!cli || !isAbsolute(cli)) fail('E_SOURCE', 'retired-source lookup needs the running kernel OATS_CLI_BIN (OATS >=0.49.0)');
  const r = spawnSync(process.execPath, [cli, 'instance', 'events', instance, '--home', home, '--dir', deployment, '--limit', '2000', '--json'], {
    cwd: deployment, env: process.env, encoding: 'utf8', timeout: 15000, maxBuffer: 8 * 1024 * 1024,
  });
  if (r.error || r.status !== 0) fail('E_SOURCE', 'no record of source instance can be established: retired-source event lookup failed (requires OATS >=0.49.0); stop and report');
  const answer = parse(r.stdout, 'kernel events');
  if (answer.ok !== true) fail('E_SOURCE', 'kernel events did not confirm the source address');
  return answer.result;
}

function recoverySource(source, deployment, events) {
  const { instance, home, agent } = source;
  const history = events({ instance, home, deployment });
  if (history?.eventsApi !== 2 || history.instance !== instance || history.home !== home || history.truncated !== false ||
      history.integrity?.unreadableRows !== 0 || history.integrity?.foreignRows !== 0 ||
      !Array.isArray(history.integrity?.sources) || history.integrity.sources.some(s => !['ok', 'absent'].includes(s.status)) ||
      !Array.isArray(history.events)) fail('E_SOURCE', 'retired-source event history is incomplete, ambiguous or mismatched');
  const rows = history.events;
  if (rows.some(r => r.instance !== instance || r.home !== home)) fail('E_SOURCE', 'retired-source event address mismatch');
  const retired = rows.filter(r => r.kind === 'retired' && r.producer === 'kernel').at(-1);
  const incarnations = new Set(rows.map(r => r.incarnation).filter(Boolean));
  if (!retired || typeof retired.incarnation !== 'string' || incarnations.size !== 1 || !incarnations.has(retired.incarnation) ||
      rows.slice(rows.indexOf(retired) + 1).some(r => r.kind === 'spawned' && r.producer === 'kernel')) fail('E_SOURCE', 'no unambiguous retired source incarnation; never choose a reused name');
  const recovery = retired.data?.workRecovery;
  const recoveryRoot = join(dirname(home), '.oats-retirement', 'recovery');
  if (retired.data?.agent !== agent || typeof recovery !== 'string' || !isAbsolute(recovery) ||
      dirname(recovery) !== recoveryRoot || basename(recovery).startsWith('.')) fail('E_SOURCE', 'no recorded, contained retirement recovery copy for the source');
  const manifestBytes = readWithin(deployment, join(recovery, 'recovery.json'));
  const manifest = parse(manifestBytes, 'retirement recovery manifest');
  if (manifest.version !== 1 || manifest.instance !== instance || manifest.sourceHome !== home || manifest.phase !== 'complete') fail('E_SOURCE', 'retirement recovery does not match the completed source retirement');
  if (manifest.afterHooks !== undefined && (!object(manifest.afterHooks) || typeof manifest.afterHooks.home !== 'boolean')) fail('E_SOURCE', 'retirement recovery has an invalid afterHooks receipt');
  return { root: join(recovery, ...(manifest.afterHooks?.home ? ['after-hooks', 'home'] : ['home'])), recovery, manifestBytes, incarnation: retired.incarnation };
}

/** Check live or event-addressed retired provenance, then soul opt-out. */
export function checkSource({ task = '', deployment, events = kernelEvents } = {}) {
  const source = proposalSource(task);
  if (typeof deployment !== 'string' || !isAbsolute(deployment)) fail('E_SOURCE', 'the deployment is unknown (no absolute OATS_WORKSPACE), so the source cannot be checked');
  deployment = fs.realpathSync(deployment);
  // Home is a claim to check against the deployment layout, not a read locator.
  const agent = basename(dirname(dirname(source.home)));
  if (!NAME.test(agent) || source.home !== join(deployment, 'agents', agent, 'instances', source.instance)) fail('E_SOURCE', 'the source does not match the proposal\'s home in this deployment');
  let agents; try { agents = fs.readdirSync(join(deployment, 'agents')).filter(a => NAME.test(a)); } catch { agents = []; }
  const live = agents.map(a => join(deployment, 'agents', a, 'instances', source.instance)).filter(h => present(h));
  if (live.length > 1) fail('E_SOURCE', `more than one record names source instance ${source.instance}; its authority cannot be established`);
  if (live.length && live[0] !== source.home) fail('E_SOURCE', 'the record does not match the proposal\'s home');
  const location = live.length ? { root: live[0] } : recoverySource({ ...source, agent }, deployment, events);
  const recordBytes = readWithin(deployment, join(location.root, 'instance.json'));
  const record = parse(recordBytes, 'source instance record');
  if (record?.instance !== source.instance || record.home !== source.home || (location.incarnation && record.createdAt !== location.incarnation)) fail('E_SOURCE', 'the record does not match the proposal\'s home or retired incarnation');
  const soulBytes = readAbsolute(join(typeof record.soulDir === 'string' ? record.soulDir : '', 'soul.yaml'));
  const soulYaml = soulBytes.toString('utf8');
  if (/^name:\s*['"]?([^'"\s#]+)/m.exec(soulYaml)?.[1] !== source.soul) fail('E_SOURCE', `the recorded soul of source instance ${source.instance} is not ${source.soul}`);
  const okf = record.providers?.['oats.okf'];
  if (!object(okf)) fail('E_SOURCE', `source instance ${source.instance} has no oats.okf knowledge slot`);
  const optedOut = `the soul of source instance ${source.instance} opts out of harvest (knowledge: { harvest: off }, or a "harvest: off" anywhere in its soul.yaml): its knowledge is not harvested`;
  if (/\bharvest\s*:\s*['"]?off\b/.test(soulYaml)) fail('E_OPTED_OUT', optedOut);
  const origins = [record.capabilities, record.capabilityRuntime].flatMap(l => Array.isArray(l) ? l : []).find(c => c?.id === 'oats.okf')?.settingsOrigins;
  for (const key of ['harvest', 'harvest-runtime', 'harvest-model'].filter(k => Object.hasOwn(okf, k))) {
    const kind = origins?.[`/${key}`]?.kind;
    if (kind === 'manifest-default') continue;
    if (key === 'harvest' && okf.harvest === 'off' && kind === 'soul') fail('E_OPTED_OUT', optedOut);
    fail('E_SOURCE', typeof kind === 'string'
      ? `the record of source instance ${source.instance} sets oats.okf ${key} from ${kind}, a setting removed in oats.okf 5.0 that the source itself refuses; its authority cannot be established`
      : `the record of source instance ${source.instance} sets oats.okf ${key} with no recorded origin, so whether its soul opts out cannot be established`);
  }
  return { ...source, agent, deployment, ...location, record, recordBytes, soulBytes };
}

// Only list entries under this heading are inputs, never prose URLs or paths
// a note itself names. Invalid entries are retained as refused evidence.
export function backingNotes(task) {
  const section = /^## Backing notes\s*\r?\n([\s\S]*?)(?=^## |$(?![\s\S]))/m.exec(task)?.[1] ?? '';
  return [...new Set([...section.matchAll(/^[-*]\s+(.+?)\s*$/gm)].map(m => m[1].replace(/^`(.*)`$/, '$1')))];
}
const safeNote = note => /^notes\/.+\.md$/.test(note) && !/[\\\x00-\x1f]/.test(note) && note.split('/').every(p => p && p !== '.' && p !== '..' && !p.startsWith('.'));

/** A required spawn hook freezes input before any model or later live read. */
export function snapshotSource({ task = '', deployment, home, events = kernelEvents } = {}) {
  if (typeof home !== 'string' || !isAbsolute(home) || !fs.lstatSync(home).isDirectory() || fs.lstatSync(home).isSymbolicLink()) fail('E_SOURCE', 'harvester home is not a real absolute directory');
  const target = join(home, 'harvest-source');
  if (present(target)) fail('E_SOURCE', 'harvest-source already exists; never overwrite an earlier snapshot');
  const source = checkSource({ task, deployment, events });
  const declarationBytes = readAbsolute(join(source.record.soulDir, 'okf.json'));
  const declaration = parse(declarationBytes, 'source okf.json');
  if (!object(declaration) || typeof declaration.owner !== 'string' || !Array.isArray(declaration.owns) || !Array.isArray(declaration.reads)) fail('E_SOURCE', 'source okf.json lacks owner, owns or reads');
  const bindingsFile = source.record.providers['oats.okf']['bindings-file'];
  const bindingsBytes = readAbsolute(bindingsFile);
  if (!object(parse(bindingsBytes, 'source bindings').bases)) fail('E_SOURCE', 'source bindings have no bases');
  const notes = backingNotes(task);
  if (notes.length > 128) fail('E_SOURCE', 'proposal names more than 128 backing notes');
  const evidence = [], files = new Map();
  let total = Buffer.byteLength(task) + declarationBytes.length + bindingsBytes.length + source.soulBytes.length;
  if (Buffer.byteLength(task) > MAX_FILE || total > 16 * 1024 * 1024) fail('E_SOURCE', 'harvest source exceeds input limits');
  for (const note of notes) {
    if (!safeNote(note)) { evidence.push({ note, status: 'refused' }); continue; }
    let bytes;
    try { bytes = readWithin(source.deployment, join(source.root, note)); }
    catch (e) { evidence.push({ note, status: e.code === 'ENOENT' ? 'missing' : 'refused' }); continue; }
    total += bytes.length;
    if (total > 16 * 1024 * 1024) fail('E_SOURCE', 'harvest source exceeds 16 MiB');
    evidence.push({ note, status: 'copied', sha256: sha256(bytes) }); files.set(note, bytes);
  }
  // If retirement or disposal raced the read, do not turn lost evidence into
  // successful missing-note findings. Refuse; a later authorized spawn can
  // use the completed recovery, never an automatic retry loop.
  if (!readWithin(source.deployment, join(source.root, 'instance.json')).equals(source.recordBytes) ||
      (source.recovery && !readWithin(source.deployment, join(source.recovery, 'recovery.json')).equals(source.manifestBytes))) fail('E_SOURCE', 'source records changed during capture; no snapshot was committed');
  const summary = {
    version: 1, source: { instance: source.instance, soul: source.soul, agent: source.agent, home: source.home, incarnation: source.record.createdAt ?? null },
    from: source.recovery ? 'recovery' : 'live', ...(source.recovery ? { recovery: source.recovery } : {}),
    bindingsFile, proposalSha256: sha256(task), evidence,
    tasksProvider: (source.record.capabilities ?? []).find(c => c.layer === 'tasks')?.id ?? null,
  };
  const staging = fs.mkdtempSync(join(home, '.harvest-source-'));
  try {
    const put = (name, bytes) => { fs.mkdirSync(dirname(join(staging, name)), { recursive: true, mode: 0o700 }); fs.writeFileSync(join(staging, name), bytes, { flag: 'wx', mode: 0o600 }); };
    put('source.json', JSON.stringify(summary, null, 2) + '\n');
    put('proposal.md', task); put('soul.yaml', source.soulBytes); put('okf.json', declarationBytes); put('bindings.json', bindingsBytes);
    for (const [note, bytes] of files) put(note, bytes);
    fs.renameSync(staging, target);
  } catch (e) { fs.rmSync(staging, { recursive: true, force: true }); throw e; }
  return summary;
}
