import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
const mod=p=>import(new URL(`../oats-package/capabilities/oats-okf/lib/${p}.mjs`,import.meta.url));
const {loadBindings,settings,gitTimeoutMs}=await mod('config');
const {save,readJSON,tree}=await mod('io');
const {stageBase}=await mod('stores');
const {initBase,migrate,forgetMigration}=await mod('migration');
const {pinOwner}=await mod('sources');
function put(p,text) {fs.mkdirSync(dirname(p),{recursive:true});fs.writeFileSync(p,text);}
const git=(cwd,args)=>{const r=spawnSync('git',['-C',cwd,...args],{encoding:'utf8'});if(r.status!==0) throw new Error(r.stderr);return r.stdout.trim();};
const LARGE=17*1024*1024; // above the 16 MiB buffer the old object reader used
/** A Git base at root knowledge/ in a repository that also carries a large file OUTSIDE the base and one INSIDE it. */
function largeRepoFixture(t,{allowFilter=true}={}) {
  const dir=fs.realpathSync(fs.mkdtempSync(join(tmpdir(),'okf-large-'))); const old={...process.env};
  t.after(()=>{for(const k of Object.keys(process.env)) delete process.env[k];Object.assign(process.env,old);fs.rmSync(dir,{recursive:true,force:true});});
  Object.assign(process.env,{HOME:join(dir,'user'),GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'});fs.mkdirSync(process.env.HOME);
  const repo=join(dir,'accepted-repo');fs.mkdirSync(repo);git(repo,['init','-q','--initial-branch=main']);
  if(allowFilter) git(repo,['config','uploadpack.allowFilter','true']);
  const base={id:'base-1',kind:'git',repository:repo,root:'knowledge',acceptedBranch:'main',pr:{repository:'fixture/knowledge'}};
  const bindingFile=join(dir,'bindings.json');save(bindingFile,{version:1,stateDir:'state',bases:{project:base}});
  process.env.OATS_SETTINGS=JSON.stringify({'bindings-file':bindingFile});
  const nodesFile=join(dir,'nodes.json');save(nodesFile,{expert:{path:'expert',owner:'owner-1'}});
  const bindings=loadBindings();
  const seed=join(dir,'seed');initBase(bindings,'project',nodesFile,seed);fs.cpSync(seed,join(repo,'knowledge'),{recursive:true});
  put(join(repo,'code.txt'),'code baseline\n');
  fs.writeFileSync(join(repo,'receipts.zip'),Buffer.alloc(LARGE,7));            // outside the base
  // inside the base: a valid concept whose body alone exceeds the old buffer
  const big=Buffer.concat([Buffer.from('---\ntype: Lesson\ntitle: Big\ndescription: A concept larger than any in-memory buffer.\n---\n\n'),Buffer.alloc(LARGE,0x39),Buffer.from('\n')]);
  fs.writeFileSync(join(repo,'knowledge','expert','big.md'),big);
  put(join(repo,'knowledge','expert','index.md'),'# expert\n\n* [Big](big.md) - big\n');
  git(repo,['add','.']);git(repo,['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','baseline']);
  git(repo,['branch','other']); // a second branch the store must never need
  return {dir,repo,base,bindings,bindingFile,nodesFile};
}

test('stageBase materializes only the base root and reads large objects without a buffer cap',t=>{
  const f=largeRepoFixture(t);const dest=join(f.dir,'stage');
  const stage=stageBase(f.base,dest);
  assert.equal(stage.head,git(f.repo,['rev-parse','main']));
  assert.ok(fs.existsSync(join(dest,'knowledge','okf-base.json')),'base root materialized');
  assert.ok(!fs.existsSync(join(dest,'receipts.zip')),'file outside the base root is not materialized');
  assert.ok(!fs.existsSync(join(dest,'code.txt')),'no checkout outside the base root');
  const inside=fs.readFileSync(join(dest,'knowledge','expert','big.md'));
  assert.ok(inside.length>LARGE,'large concept materialized in full');assert.equal(inside[inside.length-2],0x39);
});

test('stageBase clones a single branch and a partial clone when the server allows it',t=>{
  const f=largeRepoFixture(t);const dest=join(f.dir,'stage');
  stageBase(f.base,dest);
  assert.equal(git(dest,['branch','-r']).split('\n').map(s=>s.trim()).filter(Boolean).join(','),'origin/main','only the accepted branch is fetched');
  assert.equal(git(dest,['config','--get','remote.origin.promisor']),'true','partial clone in effect');
});

test('stageBase stays sparse when the repository does not honour object filters (git downgrades the clone itself)',t=>{
  const f=largeRepoFixture(t,{allowFilter:false});const dest=join(f.dir,'stage');
  const stage=stageBase(f.base,dest);
  assert.equal(stage.head,git(f.repo,['rev-parse','main']));
  assert.ok(!fs.existsSync(join(dest,'receipts.zip')),'still sparse to the base root');
});

test('git-timeout is a validated setting with a large default for remote operations',t=>{
  const old=process.env.OATS_SETTINGS; t.after(()=>{process.env.OATS_SETTINGS=old;});
  process.env.OATS_SETTINGS=JSON.stringify({'git-timeout':120});
  assert.equal(settings()['git-timeout'],120);assert.equal(gitTimeoutMs(),120000);
  process.env.OATS_SETTINGS=JSON.stringify({});
  assert.equal(gitTimeoutMs(),600000);
  for(const bad of [0,-1,'120',1.5]) {process.env.OATS_SETTINGS=JSON.stringify({'git-timeout':bad});assert.throws(()=>settings(),/git-timeout/);}
});

test('a migration that fails after its record exists is marked failed and can be forgotten; a failed stage leaves no record',t=>{
  const f=largeRepoFixture(t);
  const legacy=join(f.dir,'legacy');put(join(legacy,'index.md'),'---\nokf_version: "0.1"\n---\n\n# Legacy\n\n* [a lesson](lessons/a.md)\n');put(join(legacy,'lessons','a.md'),'---\ntype: Lesson\ntitle: A\n---\n\nBody.\n');
  // the target node already holds big.md: staging succeeds, the record is written, then the node check fails
  assert.throws(()=>migrate(f.bindings,{legacy,alias:'project',node:'expert',output:join(f.dir,'out-1')}),/not empty/);
  const migrations=join(f.bindings.stateDir,'migrations');
  const ids=fs.readdirSync(migrations);assert.equal(ids.length,1);
  const record=readJSON(join(migrations,ids[0],'migration.json'));
  assert.equal(record.receipt.status,'failed');assert.match(record.receipt.error,/not empty/);
  assert.ok(fs.existsSync(join(migrations,ids[0],'legacy.json')),'the byte-preserving backup is kept with the failed record');
  assert.equal(forgetMigration(f.bindings,ids[0]).status,'forgotten');
  assert.equal(fs.readdirSync(migrations).length,0);
  // a stage failure (unreadable repository) leaves no half-record at all
  const broken={...f.bindings,bases:{project:{...f.base,repository:join(f.dir,'missing.git')}}};
  assert.throws(()=>migrate(broken,{legacy,alias:'project',node:'expert',output:join(f.dir,'out-2')}));
  assert.equal(fs.existsSync(migrations)?fs.readdirSync(migrations).length:0,0);
});

test('forgetMigration refuses a delivered migration',t=>{
  const f=largeRepoFixture(t);
  const migrations=join(f.bindings.stateDir,'migrations');fs.mkdirSync(join(migrations,'m-1'),{recursive:true});
  save(join(migrations,'m-1','migration.json'),{version:1,id:'m-1',receipt:{status:'pushed'}});
  assert.throws(()=>forgetMigration(f.bindings,'m-1'),/delivered|pushed/);
});

test('owners are pinned by soul identity, and a prior path pin of the same soul migrates to it once',t=>{
  const dir=fs.realpathSync(fs.mkdtempSync(join(tmpdir(),'okf-owners-')));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=join(dir,'owners.json');
  const id='github.com/acme/agents#release-manager';
  assert.equal(pinOwner(file,'owner-1',{id,soulName:'release-manager',path:join(dir,'agents/release-manager/souls/aaaaaaaaaaaa')}),id);
  assert.deepEqual(readJSON(file),{'owner-1':id});
  // second spawn after a member commit: different content path, same identity
  assert.equal(pinOwner(file,'owner-1',{id,soulName:'release-manager',path:join(dir,'agents/release-manager/souls/bbbbbbbbbbbb')}),id);
  // a genuinely different soul with the same owner id is refused
  assert.throws(()=>pinOwner(file,'owner-1',{id:'github.com/acme/agents#other',soulName:'other',path:join(dir,'agents/other/souls/cccccccccccc')}),/E_OWNER|different soul/);
  // legacy rows: a path under agents/<same name>/(soul|souls/<commit>) is rewritten to the id, not refused
  save(file,{'owner-1':join(dir,'agents/release-manager/soul')});
  assert.equal(pinOwner(file,'owner-1',{id,soulName:'release-manager',path:join(dir,'agents/release-manager/souls/dddddddddddd')}),id);
  assert.deepEqual(readJSON(file),{'owner-1':id});
  save(file,{'owner-1':join(dir,'agents/release-manager/souls/eeeeeeeeeeee')});
  assert.equal(pinOwner(file,'owner-1',{id,soulName:'release-manager',path:join(dir,'agents/release-manager/souls/ffffffffffff')}),id);
  // a path row of a different soul name stays a refusal
  save(file,{'owner-1':join(dir,'agents/someone-else/soul')});
  assert.throws(()=>pinOwner(file,'owner-1',{id,soulName:'release-manager',path:join(dir,'agents/release-manager/soul')}),/different soul/);
  // classic souls (no identity): the resolved path remains the pin, unchanged behaviour
  save(file,{});
  const classic=join(dir,'agents/classic/soul');
  assert.equal(pinOwner(file,'owner-2',{id:null,soulName:'classic',path:classic}),classic);
  assert.throws(()=>pinOwner(file,'owner-2',{id:null,soulName:'classic',path:join(dir,'elsewhere/soul')}),/different soul/);
});
