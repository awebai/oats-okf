import fs from 'node:fs';
import { join } from 'node:path';

// Include directories, symlinks and timestamps: transient lock/view writes must
// not disappear from the observation merely because their files were removed.
export function inventory(root) {
  const entries={};
  function walk(path,key='.') {
    const stat=fs.lstatSync(path);
    const entry={mode:stat.mode,mtime:stat.mtimeMs,ctime:stat.ctimeMs};
    entries[key]=entry;
    if(stat.isSymbolicLink()) entry.link=fs.readlinkSync(path);
    else if(stat.isDirectory()) for(const name of fs.readdirSync(path).sort()) walk(join(path,name),`${key}/${name}`);
    else entry.bytes=fs.readFileSync(path).toString('base64');
  }
  walk(root);return entries;
}

// Preload into the ACTUAL provider process. Even a swallowed effect attempt
// fails the child exit status; no native command or filesystem write can run.
export function noEffectsPreload(root) {
  const file=join(root,'no-effects.mjs');
  fs.writeFileSync(file,`import fs from 'node:fs';
import cp from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
let attempted=false;
const refuse=name=>{attempted=true;throw Object.assign(new Error('unexpected harvest effect: '+name),{code:'E_TEST_EFFECT'});};
for(const name of ['mkdirSync','mkdtempSync','renameSync','rmSync','rmdirSync','unlinkSync','writeFileSync','appendFileSync','copyFileSync','chmodSync','truncateSync','writeSync','ftruncateSync','linkSync','symlinkSync']) fs[name]=()=>refuse(name);
const open=fs.openSync;
fs.openSync=(path,flags,...rest)=>{
  if(typeof flags==='number' ? (flags & (fs.constants.O_WRONLY|fs.constants.O_RDWR|fs.constants.O_CREAT|fs.constants.O_TRUNC|fs.constants.O_APPEND))!==0 : flags!=='r' && flags!=='rs') refuse('openSync');
  return open(path,flags,...rest);
};
for(const name of ['spawnSync','spawn','execSync','exec','execFileSync','execFile','fork']) cp[name]=()=>refuse(name);
syncBuiltinESMExports();
process.on('exit',()=>{if(attempted) process.exitCode=97;});
`);
  return file;
}
