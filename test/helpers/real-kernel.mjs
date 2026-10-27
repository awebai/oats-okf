import * as fs from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync, execFileSync } from 'node:child_process';

/** The selected real kernel CLI's version as [major, minor, patch], or null. */
export function kernelVersion(cli) {
  const m = cli ? /(\d+)\.(\d+)\.(\d+)/.exec(spawnSync(process.execPath, [cli, '--version'], { encoding: 'utf8' }).stdout || '') : null;
  return m ? m.slice(1).map(Number) : null;
}
/** A test's skip value: false when `cli` is at least `floor` ([major, minor, patch]). */
export function kernelSkip(cli, floor) {
  if (!cli) return true;
  const v = kernelVersion(cli), rank = x => x[0] * 1e6 + x[1] * 1e3 + x[2];
  return !v || rank(v) < rank(floor) ? `needs OATS >= ${floor.join('.')} (selected: ${v?.join('.') ?? 'unknown'})` : false;
}
export const write = (p, text) => { fs.mkdirSync(dirname(p), { recursive: true }); fs.writeFileSync(p, text); };

/** A disposable host for a real kernel: its own HOME and OATS_HOME_DIR, node
 *  and git on a minimal PATH, and harness commands that refuse to run, so no
 *  model is ever launched. `repo` commits a directory and publishes it as a
 *  bare file:// repository, answering the commit. */
export function sandbox(t, prefix) {
  const base = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), prefix)));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const bin = join(base, 'bin');
  fs.mkdirSync(bin); fs.mkdirSync(join(base, 'user'));
  fs.symlinkSync(process.execPath, join(bin, 'node'));
  const gitBin = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
  fs.symlinkSync(gitBin, join(bin, 'git'));
  for (const harness of ['pi', 'claude', 'codex']) { write(join(bin, harness), '#!/bin/sh\necho NO_REAL_MODEL_IN_THIS_TEST >&2\nexit 98\n'); fs.chmodSync(join(bin, harness), 0o755); }
  const env = { HOME: join(base, 'user'), PATH: `${bin}:/usr/bin:/bin`, OATS_HOME_DIR: join(base, 'host'), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', LANG: 'en_US.UTF-8' };
  const git = (cwd, args) => execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', ...args], { cwd, env, encoding: 'utf8' }).trim();
  const repo = (dir, bare) => { git(dir, ['init', '-q', '-b', 'main']); git(dir, ['add', '-A']); git(dir, ['commit', '-qm', 'fixture']); execFileSync('git', ['clone', '-q', '--bare', dir, bare], { env }); return git(dir, ['rev-parse', 'HEAD']); };
  return { base, env, git, repo };
}
