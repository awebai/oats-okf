// The upgrade hook (okf 4.2.3, #106). OATS 0.68's `oats instance upgrade`
// moves a stopped home's oats.okf module to this version only when this hook
// adopts the home: `plan` answers {adopt:true} or {adopt:false,reason,remedy},
// `apply` answers {meta, warning?}. Both phases only read the home and its
// custody: no write, no kernel or host call, no capture, no switch read. What
// the home holds decides, not its recorded meta (a harvest-off home registers
// a source if the deployment switches harvest on later):
// - a service home has no okf state;
// - a harvest-off home (no source, its `.okf-instance.json` record) keeps that
//   state exactly; 4.2 reads that record as 4.0 and 4.1 wrote it;
// - a registered source adopts only while its marker, frozen descriptor
//   (okf <= 4.1 cron/tz are inert history) and status still load for this home;
// - a captured home or source is refused: the hook receives no binding
//   snapshot to verify it against;
// - anything else (legacy watermarks, no okf state at all) is refused.
import { fs, join, readJSON, fail } from './io.mjs';
import { JOBS_REMOVED } from './config.mjs';
import { markerPath, homeSource, loadStatus, service, harvestOffRecord } from './sources.mjs';

const CHECKPOINT = 'oats okf harvest';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const respawn = () => `respawn the instance: oats retire ${process.env.OATS_INSTANCE || '<instance>'}, then oats spawn`;
const refuse = (reason, remedy = respawn()) => ({ adopt: false, reason, remedy });

/** What the home at `home` holds, if this version can adopt it. */
function adoption(home) {
  let instance;
  try { instance = fs.existsSync(join(home, 'instance.json')) ? readJSON(join(home, 'instance.json')) : {}; }
  catch (e) { return refuse(`instance.json cannot be read (${e.code || e.message})`); }
  if (Object.hasOwn(instance, 'executionBinding')) return refuse('this is a captured home: the upgrade hook has no binding snapshot to verify its registration against');
  if (fs.existsSync(markerPath(home))) {
    let source;
    try {
      source = homeSource(home);
      if (source.providerBinding !== undefined) return refuse('this is a captured source: the upgrade hook has no binding snapshot to verify its registration against');
      if (loadStatus(source)?.version !== 1) fail('E_SOURCE', 'source status is not version 1');
    } catch (e) {
      return refuse(`the registered okf source does not load: ${e.code || 'E_OKF'}: ${e.message}`, `inspect it (oats okf inspect --home ${home}) and repair its custody, or ${respawn()}`);
    }
    return { adopt: true, kind: 'registered', source };
  }
  if (service(home)) return { adopt: true, kind: 'service' };
  if (['.okf-harvest-record.json', '.okf-harvest-record.next.json'].some(p => fs.existsSync(join(home, p)))) return refuse('the home holds legacy source watermarks', `oats okf migrate --source-home ${home} --soul <soul>, or ${respawn()}`);
  let record;
  try { record = harvestOffRecord(home); } catch (e) { return refuse(`the harvest-off record cannot be read (${e.code || e.message})`); }
  if (record?.harvest === 'off') return { adopt: true, kind: 'harvest-off' };
  return refuse('the home has no registered okf source and no harvest-off record');
}

/** OATS_META as the kernel recorded it, or the reason it is unusable (never its content). */
function recordedMeta() {
  let meta;
  try { meta = JSON.parse(process.env.OATS_META || ''); } catch { return { reason: 'OATS_META must be valid JSON' }; }
  return object(meta) ? { meta } : { reason: 'OATS_META must be an object' };
}

/** plan → {adopt:true} | {adopt:false,reason,remedy}. */
export function upgradePlan(home) {
  const { reason } = recordedMeta();
  if (reason) return refuse(reason);
  const { adopt, ...answer } = adoption(home);
  return adopt ? { adopt: true } : { adopt: false, reason: answer.reason, remedy: answer.remedy };
}

/** apply → {meta, warning?}. A home that no longer adopts fails (E_UPGRADE_REFUSED). A
 *  harvest-on meta okf <= 4.1 recorded names its scheduler job (`schedule`); 4.2 harvests at
 *  checkpoints, so it records the checkpoint instead and the warning names the job the
 *  operator removes. Every other meta is returned as recorded. */
export function upgradeApply(home) {
  const { meta, reason } = recordedMeta();
  if (reason) fail('E_UPGRADE_REFUSED', reason);
  const found = adoption(home);
  if (!found.adopt) fail('E_UPGRADE_REFUSED', `${found.reason}; ${found.remedy}`);
  if (found.kind !== 'registered' || meta.harvest !== 'on' || !Object.hasOwn(meta, 'schedule')) return { meta };
  const { schedule, ...rest } = meta;
  const deployment = process.env.OATS_WORKSPACE || '<deployment>';
  return {
    meta: { ...rest, checkpoint: CHECKPOINT },
    warning: `oats-okf: this source was registered by okf <= 4.1, which created the scheduler job okf-${found.source.id}; okf 4.2 harvests at checkpoints and the job does nothing. Remove it: oats schedule remove okf-${found.source.id} --dir ${deployment}. ${JOBS_REMOVED}`,
  };
}
