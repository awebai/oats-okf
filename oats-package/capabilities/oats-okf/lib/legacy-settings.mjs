// okf 5.0.0: the 4.x harvest settings are gone. The kernel still forwards an
// undeclared key that a layer sets (soul ⊕ host ⊕ spawn, with the last layer
// that set it in OATS_SETTINGS_ORIGINS), so every command and hook refuses it
// here, naming where it was set and the fix; nothing treats it as valid. The
// one exception is `setup --remove-legacy-settings`, which deletes the host's
// own explicit keys from the deployment's oats-local.yaml, and nothing else.
import { fs, join, resolve, atomic, fail } from './io.mjs';

export const LEGACY_KEYS = ['harvest', 'harvest-runtime', 'harvest-model'];
const NEW_WAY = 'agents now propose knowledge and spawn oats.okf/knowledge-harvester at checkpoints';
const WHY = { harvest: NEW_WAY, 'harvest-runtime': 'the harvester now launches with the kernel\'s own harness and model selection', 'harvest-model': 'the harvester now launches with the kernel\'s own harness and model selection' };
const CLEANUP = 'oats okf setup --remove-legacy-settings --soul <soul> --json';
const failWith = (code, message, result) => { throw Object.assign(new Error(message), { code, result }); };

/** One sentence, also the binding check's `setting:removed` reason template (oats.json binding.reasons). */
export const REMOVED_TEMPLATE = '<setting> <origin> was removed in oats.okf 5.0; <remedy>';
export const removedSentence = (parts) => REMOVED_TEMPLATE.replace(/<([a-z]+)>/g, (_, k) => parts[k]);
/** OATS_SETTINGS_ORIGINS: JSON pointer → { kind, at } of the last layer that set each leaf. */
export function parseOrigins(text = process.env.OATS_SETTINGS_ORIGINS) {
  try { const o = JSON.parse(text || '{}'); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; } catch { return {}; }
}
/** The forwarded legacy keys → [{ key, kind, at, message }] (no values). */
export function legacySettings(env = process.env) {
  let settings; try { settings = JSON.parse(env.OATS_SETTINGS || '{}'); } catch { return []; }
  if (!settings || typeof settings !== 'object') return [];
  const origins = parseOrigins(env.OATS_SETTINGS_ORIGINS);
  return LEGACY_KEYS.filter((key) => Object.hasOwn(settings, key)).map((key) => {
    const layer = origins[`/${key}`], kind = typeof layer?.kind === 'string' ? layer.kind : null, at = typeof layer?.at === 'string' ? layer.at : null;
    const origin = kind ? `from ${kind}${at ? ` (${at})` : ''}` : 'from an unknown origin';
    let setting = key, remedy;
    if (kind === 'host') { setting = `settings.oats.okf.${key}`; remedy = `${WHY[key]}; run ${CLEANUP} from this deployment.`; }
    else if (kind === 'soul') { setting = `knowledge.${key}`; remedy = `remove that key in the soul's reviewed source and sync/respawn; ${WHY[key]}. Host cleanup cannot remove a soul setting.`; }
    else if (kind === 'spawn') remedy = `drop it from the spawn command; ${WHY[key]}. Host cleanup cannot remove it.`;
    else if (kind) remedy = `remove it in that layer's reviewed source; ${WHY[key]}. Host cleanup cannot remove it.`;
    else remedy = `${WHY[key]}; find where it is set (oats-local.yaml settings.oats.okf, soul.yaml knowledge:, or a --provider oats.okf flag) and remove it (${CLEANUP} removes a host value).`;
    return { key, kind: kind ?? 'unknown', at, setting, origin, remedy, message: removedSentence({ setting, origin, remedy }) };
  });
}
/** Refuse a forwarded legacy key before any of this provider's effects. */
export function refuseLegacySettings(env = process.env) {
  const found = legacySettings(env);
  if (found.length) fail('E_REMOVED', found.map((f) => f.message).join(' '));
}

/** The deployment the kernel dispatched this invocation in:
 *  OATS_WORKSPACE (hooks), else OATS_TEAM_SCOPE (command dispatch). Neither,
 *  a relative or missing one, or two that disagree is a refusal, never a guess
 *  from a repository or a home. */
export function deployment(env = process.env) {
  const named = [['OATS_WORKSPACE', env.OATS_WORKSPACE], ['OATS_TEAM_SCOPE', env.OATS_TEAM_SCOPE]].filter(([, v]) => typeof v === 'string' && v);
  const how = 'run it through the kernel: from the deployment with --soul <soul>, or from the instance home; the source repository is never taken for the deployment';
  if (!named.length) fail('E_DEPLOYMENT_SCOPE', `oats.okf needs the deployment the kernel dispatched it in (OATS_WORKSPACE or OATS_TEAM_SCOPE), and none was given: ${how}`);
  const real = named.map(([k, v]) => {
    if (resolve(v) !== v) fail('E_DEPLOYMENT_SCOPE', `${k} is not an absolute deployment path: ${how}`);
    try { return fs.realpathSync(v); } catch { return fail('E_DEPLOYMENT_SCOPE', `${k} names no existing deployment (${v}): ${how}`); }
  });
  if (new Set(real).size > 1) fail('E_DEPLOYMENT_SCOPE', `OATS_WORKSPACE (${real[0]}) and OATS_TEAM_SCOPE (${real[1]}) name different deployments: ${how}`);
  return real[0];
}

// The deployment's explicit host keys, from a small line reader that only
// accepts block style: `settings:` → `oats.okf:` → `<key>: <scalar>`. Any
// other shape that might hold a legacy key is refused before a write.
const KEY = /^(\s+)(['"]?)([A-Za-z0-9._-]+)\2\s*:(.*)$/;
const value = (rest) => rest.replace(/\s+#.*$/, '').trim();
function plan(text) {
  const refuse = (why) => fail('E_UNSUPPORTED', `oats-local.yaml: ${why}; nothing was written. Remove settings.oats.okf.${LEGACY_KEYS.join('/')} by hand in a reviewed edit`);
  const lines = text.split('\n');
  if (!/harvest/.test(text)) return { lines, keys: [] }; // nothing to remove: any shape will do
  if (/\t/.test(text)) refuse('tab indentation is not edited');
  if (lines.some((l) => /^(---|\.\.\.)\s*$/.test(l))) refuse('a multi-document file is not edited');
  const s = lines.findIndex((l) => /^settings\s*:/.test(l));
  if (s < 0) { if (/oats\.okf/.test(text)) refuse('oats.okf appears outside a top-level settings: block'); return { lines, keys: [] }; }
  if (lines.findIndex((l, i) => i > s && /^settings\s*:/.test(l)) >= 0) refuse('settings: appears twice');
  if (value(lines[s].replace(/^settings\s*:/, '')) !== '') refuse('settings: is not a block mapping');
  let end = lines.length;
  for (let i = s + 1; i < lines.length; i++) if (/^\S/.test(lines[i]) && !/^#/.test(lines[i])) { end = i; break; }
  const owners = lines.slice(s + 1, end).map((l, j) => [KEY.exec(l), s + 1 + j]).filter(([m]) => m && m[3] === 'oats.okf');
  if (!owners.length) { if (lines.slice(s + 1, end).some((l) => /oats\.okf/.test(l))) refuse('oats.okf is not a plain block key under settings:'); return { lines, keys: [] }; }
  if (owners.length > 1) refuse('settings.oats.okf appears twice');
  const [[m, o]] = owners, childIndent = m[1].length;
  if (value(m[4]) === '{}') return { lines, keys: [] }; // what an earlier cleanup leaves
  if (value(m[4]) !== '') refuse('settings.oats.okf is not a block mapping');
  let keyIndent = null, blockEnd = end; const remove = [], seen = new Set();
  for (let i = o + 1; i < end; i++) {
    if (/^\s*(#.*)?$/.test(lines[i])) continue;
    const lead = /^(\s*)/.exec(lines[i])[1].length;
    if (lead <= childIndent) { blockEnd = i; break; }
    if (keyIndent === null) keyIndent = lead;
    if (lead !== keyIndent) continue; // a nested value of another key
    const k = KEY.exec(lines[i]);
    if (!k) refuse('a settings.oats.okf entry is not key: value');
    if (seen.has(k[3])) refuse(`settings.oats.okf.${k[3]} appears twice`); seen.add(k[3]);
    if (!LEGACY_KEYS.includes(k[3])) continue;
    const v = value(k[4]);
    if (v === '' || /^[|>&*!{[]/.test(v)) refuse(`settings.oats.okf.${k[3]} is not a plain one-line value`);
    const next = lines.slice(i + 1, end).find((l) => !/^\s*(#.*)?$/.test(l));
    if (next && /^(\s*)/.exec(next)[1].length > keyIndent) refuse(`settings.oats.okf.${k[3]} continues on the next line`);
    remove.push(i);
  }
  const kept = lines.slice(o + 1, blockEnd).filter((l, j) => !remove.includes(o + 1 + j) && !/^\s*(#.*)?$/.test(l));
  if (remove.length && !kept.length) lines[o] = `${lines[o].replace(/\s+$/, '')} {}`; // an empty map stays a map
  return { lines: lines.filter((_, i) => !remove.includes(i)), keys: remove.map((i) => KEY.exec(lines[i])[3]) };
}
/** `oats okf setup --remove-legacy-settings [--plan]` in the dispatching deployment. */
export function removeLegacySettings({ plan: preview = false } = {}) {
  const file = join(deployment(), 'oats-local.yaml');
  let stat; try { stat = fs.lstatSync(file); } catch { fail('E_CONFIG', `no oats-local.yaml in the deployment (${file}); nothing was written`); }
  if (!stat.isFile() || stat.nlink !== 1 || (typeof process.getuid === 'function' && stat.uid !== process.getuid())) fail('E_UNSUPPORTED', `${file} is not a single-link regular file owned by this user; nothing was written`);
  const text = fs.readFileSync(file, 'utf8'), out = plan(text), removed = out.keys.map((k) => `settings.oats.okf.${k}`);
  const found = legacySettings(), others = found.filter((f) => f.kind !== 'host');
  // The kernel says the host set a key this reader did not find: not this file's shape, so nothing is written.
  const missed = found.filter((f) => f.kind === 'host' && !out.keys.includes(f.key)).map((f) => f.key);
  if (missed.length) fail('E_UNSUPPORTED', `the host layer sets settings.oats.okf.${missed.join('/')}, but ${file} has no such plain key under settings: oats.okf:; nothing was written. Remove it by hand in a reviewed edit`);
  const result = { file, removed, ...(preview ? { plan: true } : {}), written: false, ...(others.length ? { remaining: others.map(({ key, kind, at }) => ({ key, kind, at })) } : {}) };
  if (!preview && removed.length) {
    const next = out.lines.join('\n');
    if (fs.readFileSync(file, 'utf8') !== text) fail('E_CONFLICT', `${file} changed while it was read; nothing was written: run the command again`);
    atomic(file, next);
    let after; try { after = fs.readFileSync(file, 'utf8'); } catch { after = null; }
    if (after !== next) failWith('E_UNCERTAIN', `${file} was replaced, but reading it back did not show the intended edit; check it by hand (removed: ${removed.join(', ')})`, { ...result, written: 'unknown' });
    result.written = true;
  }
  if (others.length) failWith('E_REMOVED', others.map((f) => f.message).join(' '), result);
  return result;
}
