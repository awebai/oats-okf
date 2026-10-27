import * as fs from 'node:fs';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';

const write = (file, text) => { fs.mkdirSync(dirname(file), { recursive: true }); fs.writeFileSync(file, text); };

/** An isolated machine under `base` for a real kernel: its own HOME and
 *  OATS_HOME_DIR, node and git only on PATH, and pi/claude/codex fakes that
 *  append their name to `asked` and exit 98, so no model ever starts. `repo`
 *  commits a directory and publishes it as a bare file:// repository,
 *  answering the commit. */
export function machine(base, asked = join(base, 'model-start-attempted')) {
  const bin = join(base, 'bin');
  fs.mkdirSync(bin); fs.mkdirSync(join(base, 'user'));
  fs.symlinkSync(process.execPath, join(bin, 'node'));
  fs.symlinkSync(execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim(), join(bin, 'git'));
  for (const name of ['pi', 'claude', 'codex']) { write(join(bin, name), `#!/bin/sh\necho ${name} >> '${asked}'\necho NO_MODELS_IN_FIXTURE >&2\nexit 98\n`); fs.chmodSync(join(bin, name), 0o755); }
  const env = { HOME: join(base, 'user'), PATH: `${bin}:/usr/bin:/bin`, OATS_HOME_DIR: join(base, 'host'), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', LANG: 'C.UTF-8' };
  const git = (cwd, args) => execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', ...args], { cwd, env, encoding: 'utf8' }).trim();
  const repo = (dir, bare) => {
    git(dir, ['init', '-q', '-b', 'main']); git(dir, ['add', '-A']); git(dir, ['commit', '-qm', 'fixture']);
    execFileSync('git', ['clone', '-q', '--bare', dir, bare], { env }); return git(dir, ['rev-parse', 'HEAD']);
  };
  return { env, git, repo, asked };
}
