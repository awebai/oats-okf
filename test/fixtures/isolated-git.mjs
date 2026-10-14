import * as fs from 'node:fs';
import { join, delimiter } from 'node:path';
// okf drops every GIT_* variable before it runs Git, so a test cannot isolate
// okf's own Git calls through the environment it passes. This writes a `git`
// into <dir>/bin that runs the real Git with only <gitconfig> as global config
// and no system config; put that bin first on PATH.
const isFile=p=>{try {return fs.statSync(p).isFile();} catch {return false;}};
const REAL_GIT=(process.env.PATH||'').split(delimiter).map(dir=>join(dir,'git')).find(isFile);
const quote=v=>`'${String(v).replaceAll("'", "'\\''")}'`;
export function isolatedGit(dir,gitconfig) {
  const bin=join(dir,'bin');
  fs.mkdirSync(bin,{recursive:true});
  fs.writeFileSync(join(bin,'git'),`#!/bin/sh\nGIT_CONFIG_GLOBAL=${quote(gitconfig)} GIT_CONFIG_NOSYSTEM=1 exec ${quote(REAL_GIT)} "$@"\n`,{mode:0o755});
  return bin;
}
