// Execute the shipped recipe, not a second implementation of its naming rule.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

export function generateHarvesterName(skillFile, home, env) {
  const skill = readFileSync(skillFile, 'utf8');
  const recipes = [...skill.matchAll(/```sh\n(node --input-type=module <<'JS'\n[\s\S]*?\nJS)\n```/g)];
  if (recipes.length !== 1) throw new Error('expected one executable harvester-name recipe');
  return spawnSync('/bin/sh', ['-c', recipes[0][1]], {
    cwd: home, env, encoding: 'utf8', timeout: 10000,
  });
}
