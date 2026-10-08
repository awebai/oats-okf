// #54: an operator selects a soul, but --home identifies the source seat.
// OATS >= 0.43.3 rebinds OATS_SOUL_ID/OATS_AGENT on namespace dispatch. Earlier
// kernels may inherit the caller's identity, so a present variable is not proof.
import { isAbsolute } from 'node:path';
import { fs, fail } from './io.mjs';

// The package declares >=0.43.3; the kernel enforces that one package floor.
// There is deliberately no per-feature version probe or fallback.
const nonempty = value => typeof value === 'string' && value.length > 0 && value.length <= 4096 && !/[\x00-\x1f\x7f]/.test(value);
const qualified = value => nonempty(value) && value.indexOf('#') > 0 && value.indexOf('#') === value.lastIndexOf('#') && value.indexOf('#') < value.length - 1;

/** Compare the selected dispatch to the explicitly named target's recorded
 * identity. No basename/role/name-only match, no caller-home fallback. Classic
 * homes need their recorded soulDir; a preview directory is never a stable id.
 */
export function targetOnceIdentity(meta, env = process.env) {
  if (!nonempty(env.OATS_SOUL_ID) || !nonempty(env.OATS_AGENT)) {
    fail('E_INVOCATION', `selected-soul identity is missing; run through the supported OATS kernel from the deployment with --soul naming the target's recorded soul; do not inject identity variables`);
  }
  if (!meta || !nonempty(meta.agent) || !nonempty(meta.instance) || env.OATS_AGENT !== meta.agent) {
    fail('E_INVOCATION', 'the selected dispatch agent does not match the explicit --home target; use that target\'s recorded --soul, not the operator\'s soul');
  }
  const soul = meta.workspace?.soul;
  let id;
  if (meta.workspace !== undefined) {
    // A present but incomplete workspace identity must not fall back to a path.
    if (!soul || (Object.hasOwn(soul, 'id') && !qualified(soul.id)) || (!Object.hasOwn(soul, 'id') && !nonempty(soul.repoKey))) fail('E_OWNER', 'the target has no complete recorded workspace soul identity; retain its instance/custody records and supply the missing historical identity evidence through the owner, not a new state directory');
    // Same recorded repoKey fallback as the kernel's stableSoulId for older
    // workspace homes. A present malformed id never falls back.
    id = Object.hasOwn(soul, 'id') ? soul.id : `${soul.repoKey}#${meta.agent}`;
    if (soul.package !== undefined) {
      if (!nonempty(soul.package?.id) || !nonempty(soul.name) || id !== `package:${soul.package.id}#${soul.name}`) fail('E_OWNER', 'the target\'s recorded package soul identity is inconsistent; retain the records for the owner');
    } else if (!nonempty(soul.repoKey) || id !== `${soul.repoKey}#${meta.agent}`) {
      fail('E_OWNER', 'the target\'s recorded repository and soul identity disagree; retain the records for the owner');
    }
  } else {
    if (!nonempty(meta.soulDir) || !isAbsolute(meta.soulDir)) fail('E_OWNER', 'the classic target has no recorded stable soul directory; retain its original source identity evidence, do not infer identity from a name or temporary path');
    try { id = fs.realpathSync(meta.soulDir); } catch { fail('E_OWNER', 'the classic target\'s recorded soul directory is unavailable; preserve its original identity evidence before retrying'); }
    if (/(?:^|[/\\])oats-preview-soul-[^/\\]+(?:[/\\]|$)/.test(id)) fail('E_OWNER', 'a temporary preview path is not a recorded stable soul identity');
  }
  if (env.OATS_SOUL_ID !== id) fail('E_OWNER', 'the selected soul belongs to a different qualified source than --home records; use the exact recorded source soul. Matching names or role bytes do not authorize an owner change');
  return id;
}

export function checkOnceIdentity(seat, env = process.env) {
  return targetOnceIdentity(seat.meta, env);
}
