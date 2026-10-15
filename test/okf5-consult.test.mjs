import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, delimiter } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { initBase } from '../oats-package/capabilities/oats-okf/lib/migration.mjs';
import { isolatedGit } from './fixtures/isolated-git.mjs';
import { validateBase } from '../oats-package/capabilities/oats-okf/lib/stores.mjs';
// oats.okf 5.0.0 consultation of a Git base (a local repository, accepted
// branch main): the host cache, reads at the accepted commit, --fresh, and
// the locator/path refusals.
const ROOT=fileURLToPath(new URL('../',import.meta.url));
const CLI=join(ROOT,'oats-package/capabilities/oats-okf/bin/oats-okf.mjs');
const GIT_DIR=(process.env.PATH||'').split(delimiter).find(d=>d && fs.existsSync(join(d,'git')));
const write=(file,text)=>{fs.mkdirSync(dirname(file),{recursive:true});fs.writeFileSync(file,text);};
const json=(file,value)=>write(file,JSON.stringify(value,null,2)+'\n');
const CONCEPT='---\ntype: concept\ntitle: Decision\ndescription: The decisive concept.\n---\n\n# Decision\n\nWe chose the decisive option. See [peer](../peer/index.md) and [spec](https://example.org/spec).\n';

function fixture(t,{repository}={}) {
  const dir=fs.realpathSync(fs.mkdtempSync(join(tmpdir(),'okf5-consult-')));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const f={dir,repo:join(dir,'repo'),bindingsFile:join(dir,'deployment','okf-bindings.json'),stateDir:join(dir,'state'),
    soul:join(dir,'soul'),home:join(dir,'home'),user:join(dir,'user')};
  f.gitEnv={HOME:f.user,PATH:process.env.PATH,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'};
  f.git=(...args)=>{const r=spawnSync('git',['-C',f.repo,'-c','user.name=t','-c','user.email=t@example.invalid',...args],{env:f.gitEnv,encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
  fs.mkdirSync(f.user,{recursive:true});
  json(join(dir,'nodes.json'),{expert:{path:'expert',owner:'owner-1'},peer:{path:'peer',owner:'owner-2'}});
  const base={id:'base-1',kind:'git',root:'.',acceptedBranch:'main',pr:{repository:'example/knowledge'}};
  // Seed the accepted tree (a remote-looking locator keeps init's overlap check out of the way).
  initBase({stateDir:f.stateDir,bases:{project:{...base,repository:'https://example.invalid/knowledge.git'}}},'project',join(dir,'nodes.json'),f.repo);
  write(join(f.repo,'expert','index.md'),'# expert\n\n* [Decision](decision.md) - the decision.\n');
  write(join(f.repo,'expert','decision.md'),CONCEPT);
  spawnSync('git',['init','-q','-b','main',f.repo],{env:f.gitEnv});
  f.git('add','-A');f.git('commit','-q','-m','accepted base');
  json(f.bindingsFile,{version:1,stateDir:f.stateDir,bases:{project:{...base,repository:repository ?? f.repo}}});
  write(join(f.soul,'soul.yaml'),'schemaVersion: 2\nname: worker\nknowledge: oats.okf\n');
  json(join(f.soul,'okf.json'),{version:1,owner:'owner-1',owns:['project/expert'],reads:['project/peer']});
  json(join(f.home,'instance.json'),{name:'worker-1',kind:'agent'});
  return f;
}
function run(f,args,{gitBin,settings={}}={}) {
  const env={HOME:f.user,PATH:[gitBin,dirname(process.execPath),GIT_DIR].filter(Boolean).join(delimiter),GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',
    OATS_SOUL:f.soul,OATS_INSTANCE_HOME:f.home,OATS_SETTINGS:JSON.stringify({'bindings-file':f.bindingsFile,...settings})};
  const r=spawnSync(process.execPath,[CLI,...args],{cwd:f.home,env,encoding:'utf8',timeout:60000});
  let out=null;try{out=JSON.parse(r.stdout);}catch{}
  return {status:r.status,stdout:r.stdout,stderr:r.stderr,out};
}

test('git base: bases primes the host cache and reports the accepted commit',t=>{
  const f=fixture(t),head=f.git('rev-parse','HEAD');
  const r=run(f,['bases','--json']);
  assert.equal(r.status,0,r.stdout+r.stderr);
  const [row]=r.out.result.bases;
  assert.equal(row.alias,'project');
  assert.equal(row.kind,'git');
  assert.equal(row.commit,head);
  assert.deepEqual(row.validated,{ok:true});
  assert.deepEqual(row.nodes,['expert','peer']);
  assert.deepEqual([row.owns,row.reads],[['expert'],['peer']]);
  assert.ok(fs.existsSync(join(f.stateDir,'cache','base-1.git')));
  const text=run(f,['bases']);
  assert.ok(text.stdout.includes(`project@${head.slice(0,12)}`),text.stdout);
});

test('git base: cat and ls read the accepted state',t=>{
  const f=fixture(t),head=f.git('rev-parse','HEAD');
  const cat=run(f,['cat','--base','project','/expert/decision.md','--json']);
  assert.equal(cat.status,0,cat.stdout);
  assert.equal(cat.out.result.text,CONCEPT);
  assert.equal(cat.out.result.receipt.commit,head);
  const ls=run(f,['ls','--base','project','/expert','--json']);
  assert.equal(ls.status,0,ls.stdout);
  assert.deepEqual(ls.out.result.entries.map(e=>e.name),['decision.md','index.md','log.md']);
  assert.deepEqual(ls.out.result.entries[0],{name:'decision.md',path:'expert/decision.md',kind:'file',type:'concept',title:'Decision',description:'The decisive concept.'});
});

test('git base: links and search read the accepted state',t=>{
  const f=fixture(t);
  const links=run(f,['links','--base','project','/expert/decision.md','--json']);
  assert.equal(links.status,0,links.stdout);
  assert.deepEqual(links.out.result.links.map(l=>[l.target,l.path ?? null,l.exists ?? null,!!l.external]),[
    ['../peer/index.md','peer/index.md',true,false],['https://example.org/spec',null,null,true]]);
  const search=run(f,['search','decisive option','--json']);
  assert.equal(search.status,0,search.stdout);
  assert.deepEqual(search.out.result.hits.map(h=>[h.base,h.path,h.line]),[['project','expert/decision.md',9]]);
});

test('git base: a new commit on main is seen with --fresh',t=>{
  const f=fixture(t);
  assert.equal(run(f,['bases','--json']).status,0);
  write(join(f.repo,'expert','later.md'),'---\ntype: concept\ntitle: Later\ndescription: Added later.\n---\n\n# Later\n');
  write(join(f.repo,'expert','index.md'),'# expert\n\n* [Decision](decision.md) - the decision.\n* [Later](later.md) - later.\n');
  f.git('add','-A');f.git('commit','-q','-m','later');
  const head=f.git('rev-parse','HEAD');
  const cached=run(f,['cat','--base','project','/expert/later.md','--json']);
  assert.equal(cached.out.error.code,'E_NOT_FOUND','within consult-max-age the cached accepted commit is served');
  const fresh=run(f,['cat','--base','project','/expert/later.md','--fresh','--json']);
  assert.equal(fresh.status,0,fresh.stdout);
  assert.match(fresh.out.result.text,/# Later/);
  assert.equal(fresh.out.result.receipt.commit,head);
});

test('git base: a host-wide insteadOf routing the bound repository elsewhere still reads it (#76)',t=>{
  const repository='https://github.invalid/acme/knowledge.git';
  const f=fixture(t,{repository}),head=f.git('rev-parse','HEAD');
  // The host's global config, as a deploy key on an ssh alias needs it.
  const gitconfig=join(f.dir,'gitconfig'),gitBin=isolatedGit(f.dir,gitconfig);
  write(gitconfig,`[url "${f.repo}"]\n\tinsteadOf = ${repository}\n`);
  for(const pass of ['clone','cached']) {
    const r=run(f,['bases','--json'],{gitBin});
    assert.equal(r.status,0,`${pass}: ${r.stdout}${r.stderr}`);
    assert.equal(r.out.result.bases[0].commit,head);
  }
});

test('git base: a repository locator embedding a credential is refused without echoing it',t=>{
  const f=fixture(t,{repository:'https://user:s3cret-token@example.invalid/knowledge.git'});
  for(const args of [['bases','--json'],['index']]) {
    const r=run(f,args);
    assert.equal(r.status,1);
    assert.doesNotMatch(r.stdout+r.stderr,/s3cret-token/);
    assert.match(r.stdout+r.stderr,/E_CONFIG/);
    assert.match(r.stdout+r.stderr,/embeds a credential/);
  }
  assert.equal(fs.existsSync(f.stateDir),false);
});

test('git base: a node path escaping the base root is refused',t=>{
  const f=fixture(t);
  for(const path of ['../x.md','/expert/../../x.md']) {
    const r=run(f,['cat','--base','project',path,'--json']);
    assert.equal(r.status,1);
    assert.equal(r.out.error.code,'E_PATH');
    assert.match(r.out.error.message,/escapes the base root/);
  }
});

test('git base: an unknown base alias is refused naming the bound bases',t=>{
  const f=fixture(t);
  const r=run(f,['cat','--base','other','/expert/index.md','--json']);
  assert.equal(r.status,1);
  assert.equal(r.out.error.code,'E_BASE_UNKNOWN');
  assert.match(r.out.error.message,/bound bases: project/);
});

const cacheOf=f=>join(f.stateDir,'cache','base-1.git');
const cacheState=f=>join(cacheOf(f),'okf-consult.json');
function expire(f) {
  const state=JSON.parse(fs.readFileSync(cacheState(f)));
  state.fetchedAt=state.attemptedAt='2000-01-01T00:00:00.000Z';
  json(cacheState(f),state);
}
// Trace the real Git binary, with optional transport/framing fault injection.
// This is not a fake object store: success cases execute real Git throughout.
function tracedGit(f,{failFetch=false,batchFault=null}={}) {
  const bin=join(f.dir,'bin'),log=join(f.dir,'git-calls.jsonl');
  write(join(bin,'git'),`#!${process.execPath}
const fs=require('node:fs'),cp=require('node:child_process');
const args=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(log)},JSON.stringify(args)+'\\n');
if(${failFetch} && args.includes('fetch')) {console.error('network is unreachable');process.exit(1);}
if(${JSON.stringify(batchFault)} && args.includes('--batch')) {
  const input=fs.readFileSync(0,'utf8'),oid=input.split('\\n')[0];
  const faults={missing:oid+' missing\\n',wrong:'0'.repeat(40)+' blob 0\\n\\n',truncated:oid+' blob 99\\nx',type:oid+' tree 0\\n\\n',delimiter:oid+' blob 0\\nx',trailing:input.trim().split('\\n').map(id=>id+' blob 0\\n\\n').join('')+'extra'};
  process.stdout.write(faults[${JSON.stringify(batchFault)}]);process.exit(0);
}
const r=cp.spawnSync(${JSON.stringify(join(GIT_DIR,'git'))},args,{stdio:'inherit'});process.exit(r.status??1);
`);
  fs.chmodSync(join(bin,'git'),0o755);
  return {gitBin:bin,calls:()=>fs.existsSync(log)?fs.readFileSync(log,'utf8').trim().split('\n').filter(Boolean).map(s=>JSON.parse(s)):[],clear:()=>write(log,'')};
}

test('spawn primes only owns/reads bases, once each; consultation can still explicitly read every binding',t=>{
  const f=fixture(t),bindings=JSON.parse(fs.readFileSync(f.bindingsFile)),trace=tracedGit(f);
  bindings.bases.unused={...bindings.bases.project,id:'unused',repository:join(f.dir,'absent-repo')};
  bindings.bases.unusedDir={id:'unused-dir',kind:'directory',path:join(f.dir,'absent-dir')};
  // Unreferenced bindings before project cannot consume the 64-worker cap.
  const extra=Object.fromEntries(Array.from({length:65},(_,i)=>['unused-'+i,{...bindings.bases.unused,id:'unused-'+i,repository:join(f.dir,'absent-'+i)}]));
  bindings.bases={...extra,...bindings.bases};
  json(f.bindingsFile,bindings);
  // Own-only refs must prime too, and the same alias is not primed per node.
  json(join(f.soul,'okf.json'),{version:1,owner:'owner-1',owns:['project/expert'],reads:[]});
  const r=run(f,['spawn'],trace);
  assert.equal(r.status,0,r.stdout+r.stderr);assert.equal(r.out.warning,undefined);
  assert.equal(trace.calls().filter(a=>a.includes('clone')).length,1);
  assert.equal(trace.calls().some(a=>a.includes(bindings.bases.unused.repository)),false);
  assert.equal(fs.existsSync(join(f.stateDir,'cache','unused.git')),false);
  assert.deepEqual(run(f,['status','--json']).out.result,{harvest:'on',reason:'default'});
  const explicit=run(f,['cat','--base','unused','/expert/index.md','--json']);
  assert.equal(explicit.out.error.code,'E_BASE_UNAVAILABLE');
  // The root declaration is still checked, even though unknown aliases cannot prime.
  json(join(f.soul,'okf.json'),{version:1,owner:'owner-1',owns:[],reads:['unknown/peer']});
  assert.match(run(f,['spawn']).out.warning,/E_CONFIG: unresolved node: unknown\/peer/);
});

test('spawn uses an expired cached commit without fetching or renewing it; the first read refreshes',t=>{
  const f=fixture(t),trace=tracedGit(f);
  assert.equal(run(f,['bases','--json']).status,0);expire(f);
  const before=fs.readFileSync(cacheState(f),'utf8');
  write(join(f.repo,'expert','decision.md'),CONCEPT+'\nNew accepted content.\n');
  f.git('add','-A');f.git('commit','-q','-m','new accepted content');
  const head=f.git('rev-parse','HEAD');
  const spawned=run(f,['spawn'],trace);
  assert.equal(spawned.status,0,spawned.stdout);assert.equal(spawned.out.warning,undefined);
  assert.equal(trace.calls().some(a=>a.includes('fetch')||a.includes('clone')),false);
  assert.equal(fs.readFileSync(cacheState(f),'utf8'),before);
  const read=run(f,['cat','--base','project','/expert/decision.md','--json'],trace);
  assert.equal(read.status,0,read.stdout);assert.equal(read.out.result.receipt.commit,head);
  assert.match(read.out.result.text,/New accepted content/);
  assert.equal(read.out.result.receipt.stale,false);
  assert.equal(trace.calls().filter(a=>a.includes('fetch')).length,1);
});

test('spawn honors read-only refs and never clears failed-fetch state; read TTL zero still fetches',t=>{
  const f=fixture(t),trace=tracedGit(f,{failFetch:true});
  assert.equal(run(f,['bases','--json']).status,0);expire(f);
  json(join(f.soul,'okf.json'),{version:1,owner:'owner-1',owns:[],reads:['project/peer']});
  const failed=run(f,['index','--json'],trace);
  assert.equal(failed.status,0,failed.stdout);assert.equal(failed.out.result.indexes[0].receipt.stale,true);
  const before=fs.readFileSync(cacheState(f),'utf8');trace.clear();
  const r=run(f,['spawn'],{...trace,settings:{'consult-max-age':0}});
  assert.equal(r.status,0,r.stdout);assert.equal(r.out.warning,undefined);
  assert.equal(trace.calls().some(a=>a.includes('fetch')),false);
  assert.equal(fs.readFileSync(cacheState(f),'utf8'),before);
  const read=run(f,['index','--json'],{...trace,settings:{'consult-max-age':0}});
  assert.equal(read.status,0,read.stdout);assert.equal(read.out.result.indexes[0].receipt.stale,true);
  assert.match(read.out.result.indexes[0].receipt.reason,/fetch.*failed/);
  assert.equal(trace.calls().filter(a=>a.includes('fetch')).length,1);
});

test('cold-cache failure remains a spawn warning, and a first read with no cache fails',t=>{
  const f=fixture(t),binding=JSON.parse(fs.readFileSync(f.bindingsFile));
  binding.bases.project.repository=join(f.dir,'missing');json(f.bindingsFile,binding);
  const r=run(f,['spawn']);
  assert.equal(r.status,0,r.stdout);assert.match(r.out.warning,/not primed/);
  assert.equal(run(f,['index','--json']).out.error.code,'E_BASE_UNAVAILABLE');
});

test('cached priming refuses unresolved nodes and wrong owners; no metadata bypass',t=>{
  const f=fixture(t);
  assert.equal(run(f,['bases','--json']).status,0);
  for(const [owner,owns,reads,code] of [['wrong',['project/expert'],[],'E_OWNER'],['owner-1',[],['project/missing'],'E_CONFIG']]) {
    json(join(f.soul,'okf.json'),{version:1,owner,owns,reads});
    const r=run(f,['spawn']);assert.equal(r.status,1,r.stdout);assert.match(r.out.warning,new RegExp(code));
  }
});

test('spawn refreshes a due cache exactly once when a newly accepted node cannot resolve offline',t=>{
  const f=fixture(t),trace=tracedGit(f);
  assert.equal(run(f,['bases','--json']).status,0);
  const meta=JSON.parse(fs.readFileSync(join(f.repo,'okf-base.json')));
  meta.nodes.later={path:'later',owner:'owner-1'};
  json(join(f.repo,'okf-base.json'),meta);
  write(join(f.repo,'later','index.md'),'# Later\n');write(join(f.repo,'later','log.md'),'# Log\n');
  fs.appendFileSync(join(f.repo,'index.md'),'\n* [Later](later/index.md) - added node.\n');
  f.git('add','-A');f.git('commit','-q','-m','new accepted node');
  json(join(f.soul,'okf.json'),{version:1,owner:'owner-1',owns:[],reads:['project/later']});
  // While fresh the old cached resolution is still authoritative, as in 5.2.0.
  const fresh=run(f,['spawn'],trace);
  assert.equal(fresh.status,1,fresh.stdout);assert.match(fresh.out.warning,/E_CONFIG.*unresolved node/);
  assert.equal(trace.calls().some(a=>a.includes('fetch')),false);
  expire(f);trace.clear();
  const r=run(f,['spawn'],trace);
  assert.equal(r.status,0,r.stdout+r.stderr);assert.equal(r.out.warning,undefined);
  assert.equal(trace.calls().filter(a=>a.includes('fetch')).length,1);
  assert.equal(run(f,['index','--json']).out.result.indexes[0].receipt.commit,f.git('rev-parse','HEAD'));
});

test('spawn refreshes a due ownership mismatch once, but never bypasses the owner check',t=>{
  const f=fixture(t),trace=tracedGit(f);
  assert.equal(run(f,['bases','--json']).status,0);
  const meta=JSON.parse(fs.readFileSync(join(f.repo,'okf-base.json')));
  meta.nodes.expert.owner='owner-next';json(join(f.repo,'okf-base.json'),meta);
  f.git('add','-A');f.git('commit','-q','-m','accepted ownership move');
  json(join(f.soul,'okf.json'),{version:1,owner:'owner-next',owns:['project/expert'],reads:[]});
  const fresh=run(f,['spawn'],trace);
  assert.equal(fresh.status,1,fresh.stdout);assert.match(fresh.out.warning,/E_OWNER/);
  assert.equal(trace.calls().some(a=>a.includes('fetch')),false);
  expire(f);trace.clear();
  const r=run(f,['spawn'],trace);
  assert.equal(r.status,0,r.stdout+r.stderr);assert.equal(r.out.warning,undefined);
  assert.equal(trace.calls().filter(a=>a.includes('fetch')).length,1);
  // A genuinely wrong owner still refuses after that single refresh.
  json(join(f.soul,'okf.json'),{version:1,owner:'wrong',owns:['project/expert'],reads:[]});
  expire(f);trace.clear();
  const wrong=run(f,['spawn'],trace);
  assert.equal(wrong.status,1,wrong.stdout);assert.match(wrong.out.warning,/E_OWNER/);
  assert.equal(trace.calls().filter(a=>a.includes('fetch')).length,1);
});

test('a missing node still refuses after one due refresh; a failed fetch is not retried in a loop',t=>{
  const f=fixture(t),trace=tracedGit(f);
  assert.equal(run(f,['bases','--json']).status,0);expire(f);
  json(join(f.soul,'okf.json'),{version:1,owner:'owner-1',owns:[],reads:['project/missing']});
  const missing=run(f,['spawn'],trace);
  assert.equal(missing.status,1,missing.stdout);assert.match(missing.out.warning,/E_CONFIG.*unresolved node/);
  assert.equal(trace.calls().filter(a=>a.includes('fetch')).length,1);
  expire(f);trace.clear();
  const failing=tracedGit(f,{failFetch:true});
  const failed=run(f,['spawn'],failing);
  assert.equal(failed.status,1,failed.stdout);assert.match(failed.out.warning,/E_CONFIG.*unresolved node/);
  assert.equal(failing.calls().filter(a=>a.includes('fetch')).length,1);
  const before=fs.readFileSync(cacheState(f),'utf8');
  assert.match(JSON.parse(before).error,/fetch.*failed/);
  failing.clear();
  const again=run(f,['spawn'],failing);
  assert.equal(again.status,1,again.stdout);assert.match(again.out.warning,/E_CONFIG/);
  assert.equal(failing.calls().some(a=>a.includes('fetch')),false,'a recent attemptedAt prevents immediate retry');
  assert.equal(fs.readFileSync(cacheState(f),'utf8'),before);
});

test('one batch validates UTF-8, NULs, empty and duplicate blobs byte-for-byte, including a chunk boundary',t=>{
  const f=fixture(t),trace=tracedGit(f);
  write(join(f.repo,'expert','decision.md'),CONCEPT+'\n'+('multibyte é 🌱\0\n'.repeat(10000)));
  write(join(f.repo,'peer','log.md'),'');
  write(join(f.repo,'peer','same.md'),fs.readFileSync(join(f.repo,'expert','decision.md')));
  write(join(f.repo,'peer','index.md'),'# Peer\n\n* [Same](same.md) - duplicated bytes.\n');
  f.git('add','-A');f.git('commit','-q','-m','byte framing');
  const bindings=JSON.parse(fs.readFileSync(f.bindingsFile));
  const expected=validateBase(f.repo,bindings.bases.project);
  const r=run(f,['spawn'],trace);
  assert.equal(r.status,0,r.stdout+r.stderr);assert.equal(r.out.warning,undefined);
  const calls=trace.calls();assert.equal(calls.filter(a=>a.includes('--batch')).length,1);
  assert.equal(calls.filter(a=>a.includes('cat-file')&&a.includes('blob')).length,0);
  const verdictFile=fs.readdirSync(join(cacheOf(f),'okf-validation'))[0];
  assert.equal(JSON.parse(fs.readFileSync(join(cacheOf(f),'okf-validation',verdictFile))).digest,expected.digest);
  assert.equal(fs.readdirSync(join(f.stateDir,'cache')).some(n=>n.startsWith('.validate-')),false);
  // Removing only the verdict exercises the same batch with cached-only spawn.
  fs.rmSync(join(cacheOf(f),'okf-validation'),{recursive:true});trace.clear();
  const cached=run(f,['spawn'],trace);
  assert.equal(cached.status,0,cached.stdout);assert.equal(cached.out.warning,undefined);
  assert.equal(trace.calls().filter(a=>a.includes('--batch')).length,1);
  assert.equal(trace.calls().some(a=>a.includes('fetch')||a.includes('clone')),false);
});

test('batch framing failures never cache a verdict and remove the private scratch',t=>{
  const f=fixture(t);
  assert.equal(run(f,['bases','--json']).status,0);
  fs.rmSync(join(cacheOf(f),'okf-validation'),{recursive:true});
  for(const batchFault of ['missing','wrong','truncated','type','delimiter','trailing']) {
    const trace=tracedGit(f,{batchFault});
    const r=run(f,['spawn'],trace);
    assert.equal(r.status,0,r.stdout);assert.match(r.out.warning,/not primed.*invalid git cat-file batch response/);
    assert.equal(fs.existsSync(join(cacheOf(f),'okf-validation')),false);
    assert.equal(fs.readdirSync(join(f.stateDir,'cache')).some(n=>n.startsWith('.validate-')),false);
  }
});

test('a partial cache missing blobs warns at spawn without fetching; first consultation can fetch them',t=>{
  const f=fixture(t),trace=tracedGit(f),cache=cacheOf(f);
  f.git('config','uploadpack.allowFilter','true');
  fs.mkdirSync(dirname(cache),{recursive:true});
  const cloned=spawnSync('git',['clone','--bare','--no-local','--filter=blob:none','--single-branch','--branch','main',f.repo,cache],{env:f.gitEnv,encoding:'utf8'});
  assert.equal(cloned.status,0,cloned.stderr);
  const now=new Date().toISOString();
  json(cacheState(f),{version:1,repository:f.repo,acceptedBranch:'main',fetchedAt:now,attemptedAt:now,error:null});
  const r=run(f,['spawn'],trace);
  assert.equal(r.status,0,r.stdout);assert.match(r.out.warning,/cached validation needs missing objects/);
  assert.equal(trace.calls().some(a=>a.includes('fetch')||a.includes('clone')||a.includes('--batch')),false);
  const read=run(f,['bases','--json'],trace);
  assert.equal(read.status,0,read.stdout);assert.deepEqual(read.out.result.bases[0].validated,{ok:true});
  assert.equal(trace.calls().filter(a=>a.includes('fetch')).length,1);
});

test('all tree paths/modes are checked before starting the batch, including unread nodes',t=>{
  const f=fixture(t),trace=tracedGit(f);
  json(join(f.soul,'okf.json'),{version:1,owner:'owner-1',owns:['project/expert'],reads:[]});
  fs.symlinkSync('../expert/index.md',join(f.repo,'peer','linked.md'));
  f.git('add','-A');f.git('commit','-q','-m','unread bad entry');
  const r=run(f,['spawn'],trace);
  assert.equal(r.status,1,r.stdout);assert.match(r.out.warning,/E_PATH.*symlink or submodule/);
  assert.equal(trace.calls().some(a=>a.includes('--batch')),false);
  assert.equal(fs.readdirSync(join(f.stateDir,'cache')).some(n=>n.startsWith('.validate-')),false);
});
