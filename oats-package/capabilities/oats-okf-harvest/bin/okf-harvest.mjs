#!/usr/bin/env node
// oats.okf-harvest 5.0.0: a harvester judges ONE proposal (its TASK.md) and
// publishes with plain Git and gh (skill knowledge-harvest). It has no
// delivery commands: the 4.x `complete` and `harvest-status` refuse, so an old
// 4.x TASK or worker protocol in a 5.0 harvester never runs a completion.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HELP = `oats.okf-harvest 5.0 has no commands of its own: a harvester follows the
knowledge-harvest skill (read the proposal and the named source's records,
judge, publish one labelled PR with git and gh, hand over, retire).
oats okf-harvest complete | harvest-status   removed in 5.0 (E_REMOVED)
`;
export const REMOVED = 'was removed in oats.okf 5.0: there are no harvest runs, custody or delivery to complete. A 5.0 harvester judges the proposal in its TASK.md and opens the PR itself (skill knowledge-harvest). A 4.x TASK (one naming a source descriptor and a run) cannot be processed by 5.0: report it to your operator and retire; nothing was delivered';
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), event = args[0];
  if (!event || args.includes('--help') || args.includes('-h')) process.stdout.write(HELP);
  else {
    const error = ['complete', 'harvest-status'].includes(event)
      ? { code: 'E_REMOVED', message: `oats okf-harvest ${event} ${REMOVED}` }
      : { code: 'E_USAGE', message: `unknown command ${event}; see --help` };
    if (args.includes('--json')) process.stdout.write(JSON.stringify({ schemaVersion: 1, ok: false, error }) + '\n');
    else process.stderr.write(`oats okf-harvest ${event}: ${error.code}: ${error.message}\n`);
    process.exitCode = 1;
  }
}
