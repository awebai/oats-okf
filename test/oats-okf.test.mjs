import test from 'node:test';
import { randomUUID, createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { execFileSync, spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { syncBuiltinESMExports } from 'node:module';
import { inventory, noEffectsPreload } from './helpers/no-effects.mjs';
import { invocationFor, persistentSubject, helperSubject } from './helpers/invocation-fixture.mjs';
const ROOT=fileURLToPath(new URL('../',import.meta.url));
const CAP=join(ROOT,'oats-package',JSON.parse(fs.readFileSync(join(ROOT,'oats-package/oats-package.json'),'utf8')).capabilities[0]);
const CLI=join(CAP,'bin/oats-okf.mjs');
const mod=p=>import(new URL(`../oats-package/capabilities/oats-okf/lib/${p}.mjs`,import.meta.url));
const {loadBindings,metadata,validateBindings,validateDeclaration}=await mod('config');
const {tree,save,readJSON,atomic,digest,withLock,baseLock:unused,quote,command,hash}=await mod('io');
const {register,registerCaptured,capture,input,loadStatus,loadSource,saveStatus,pinOwner,legacyScheduleArgv}=await mod('sources');
const {cat:consultCat,acceptedResolution}=await mod('consult');
/** An okf 3.0.0 consult read of one accepted file (no local view). */
const readAccepted=(s,path='/expert/index.md',alias=Object.keys(s.bindings.bases)[0])=>consultCat(s,{base:alias},[path]).result;
const {runSource,readRun,complete,completeInBackground,deliver,retry,completionArgv,completionCommand}=await mod('worker');
const {harvestOnce}=await mod('once');
const {initBase,migrate,deliverMigration,cutoverMigration}=await mod('migration');
const {stageBase,baseLock,journalPath,directoryPublish}=await mod('stores');
const {inspect:inspectSource,capturedAuthority}=await mod('inspection');
function put(p,text) {fs.mkdirSync(dirname(p),{recursive:true});fs.writeFileSync(p,text);}
const hostPath=process.env.PATH;
function fixture(t,{kind='directory',root='knowledge',nodes={expert:{path:'expert',owner:'owner-1'},peer:{path:'peer',owner:'owner-2'}}}={}) {
  const dir=fs.realpathSync(fs.mkdtempSync(join(tmpdir(),'okf-v2-'))); const old={...process.env};
  t.after(()=>{for(const k of Object.keys(process.env)) delete process.env[k];Object.assign(process.env,old);fs.rmSync(dir,{recursive:true,force:true});});
  for(const k of Object.keys(process.env)) delete process.env[k];
  Object.assign(process.env,{HOME:join(dir,'user'),PATH:join(dir,'bin'),OATS_HOME_DIR:join(dir,'host-state'),GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'});
  fs.mkdirSync(process.env.HOME);fs.mkdirSync(process.env.PATH);
  fs.symlinkSync(process.execPath,join(process.env.PATH,'node'));
  const fake=join(dir,'bin',"oats ' boundary.mjs");
  const context=join(dir,'context');fs.mkdirSync(context);
  const calls=join(dir,'calls.jsonl');process.env.FIXTURE_CALLS=calls;process.env.FIXTURE_ROOT=dir;
  put(fake,`#!${process.execPath}
import * as fs from 'node:fs';import {join} from 'node:path';
const a=process.argv.slice(2),root=process.env.FIXTURE_ROOT;
fs.appendFileSync(process.env.FIXTURE_CALLS,JSON.stringify({a,cwd:process.cwd(),identity:process.env.OATS_HOME || null})+'\\n');
const val=k=>a[a.indexOf(k)+1];const out=result=>console.log(JSON.stringify({schemaVersion:1,ok:true,result}));
if(a[0]==='capture') {const p=join(root,'capture.json');console.log(fs.existsSync(p)?fs.readFileSync(p,'utf8'):JSON.stringify({status:'complete',complete:true,sessions:[],ignored:0}));}
else if(a[0]==='recall') {const all=JSON.parse(fs.readFileSync(join(root,'turns.json')));const start=a.includes('--after')?all.findIndex(t=>t.id===val('--after'))+1:0;const end=all.findIndex(t=>t.id===val('--until'))+1;const turns=all.slice(start,Math.min(end,start+Number(val('--limit'))));const result=a.includes('--ids-only')?turns.map(({text,...t})=>({...t,bytes:Buffer.byteLength(JSON.stringify({...t,text},null,2))+8})):turns;const fault=join(root,'recall-fail');if(!a.includes('--ids-only') && fs.existsSync(fault) && turns.some(t=>t.id===fs.readFileSync(fault,'utf8'))) process.exit(47);console.log(JSON.stringify({turns:result,remaining:end-start-turns.length}));}
else if(a[0]==='--deployment') {
  const target=JSON.parse(fs.readFileSync(join(root,'captured-dispatch.json'),'utf8'));
  const inherited=['OATS_DEPLOYMENT','OATS_RESOLUTION','OATS_BINDING_FILE','OATS_SOURCE_RECEIPT_FILE','OATS_INVOCATION_CONTEXT_FILE'];
  if(a[1]!==target.deployment || a[2]!=='--resolution' || a[3]!==target.resolution || a[4]!=='okf' || a[5]!=='complete' || a.includes('--soul') || inherited.some(key=>process.env[key]!==undefined)) process.exit(93);
  const {spawnSync}=await import('node:child_process');
  const r=spawnSync(process.execPath,[target.cli,...a.slice(5)],{env:{...process.env,OATS_BINDING_FILE:target.bindingFile,...(target.invocationFile?{OATS_INVOCATION_CONTEXT_FILE:target.invocationFile}:{})},encoding:'utf8'});
  process.stdout.write(r.stdout);process.stderr.write(r.stderr);process.exit(r.status ?? 94);
}
else if(a[0]==='spawn' && a.includes('--preview')) {const p=join(root,'preview.json');out(fs.existsSync(p)?JSON.parse(fs.readFileSync(p,'utf8')):{modules:[{name:'oats.okf-harvest',layer:null},{name:'oats.fixture-chat',layer:'messaging'}]});}
else if(a[0]==='spawn' && fs.existsSync(join(root,'spawn-fail'))) {console.error('fixture: spawn effect unconfirmed');process.exit(97);}
else if(a[0]==='spawn') {if(fs.existsSync(join(root,'spawn-slow'))) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,Number(fs.readFileSync(join(root,'spawn-slow'),'utf8')));if(a[1]!=='oats.okf/knowledge-harvester') {console.error('fixture spawns only the harvester package soul');process.exit(95);}if(a.includes('--purpose') || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(val('--name')) || val('--name').length>64) {console.error('fixture: exact --name slug of at most 64 characters');process.exit(96);}const instance=val('--name'),home=join(root,'workers',instance);fs.mkdirSync(join(home,'work'),{recursive:true});fs.writeFileSync(join(home,'instance.json'),JSON.stringify({instance,agent:'oats-okf--knowledge-harvester',work:'directory',kind:'persistent',launched:false}));fs.copyFileSync(val('--task-file'),join(home,'TASK.md'));out({instance,home,work:'directory',launched:false});}
else if(a[0]==='version' && fs.existsSync(join(root,'version.json'))) console.log(fs.readFileSync(join(root,'version.json'),'utf8'));
else if(a[0]==='session' && a[1]==='start' && fs.existsSync(join(root,'sessions-inert'))) out({home:val('--home'),started:'inert fixture: no model'});
else if(a[0]==='session') {console.error('NO MODEL SESSIONS IN FIXTURES');process.exit(91);}
else if(a[0]==='schedule') {
  if(a.includes('install')) {console.error('NO HOST TIMERS IN FIXTURES');process.exit(92);}
  const error=(code,message)=>{console.log(JSON.stringify({schemaVersion:1,ok:false,error:{code,message}}));process.exit(1);};
  if(fs.existsSync(join(root,'schedule-fail'))) error('E_SCHEDULE_FIXTURE','scheduler unavailable');
  const p=join(root,'schedules.json'),jobs=fs.existsSync(p)?JSON.parse(fs.readFileSync(p,'utf8')):{};
  const persist=()=>fs.writeFileSync(p,JSON.stringify(jobs));
  if(a[1]==='add') {if(jobs[a[2]]) error('E_SCHEDULE_EXISTS','already exists');jobs[a[2]]=JSON.parse(fs.readFileSync(val('--file'),'utf8'));persist();out({schedule:jobs[a[2]]});}
  else if(a[1]==='show') {if(!jobs[a[2]]) error('E_SCHEDULE_UNKNOWN','missing');out({schedule:jobs[a[2]]});}
  else if(['enable','disable'].includes(a[1])) {if(!jobs[a[2]]) error('E_SCHEDULE_UNKNOWN','missing');jobs[a[2]].enabled=a[1]==='enable';persist();out({schedule:jobs[a[2]]});}
  else if(a[1]==='remove') {if(a.includes('--force')) error('E_FIXTURE','never forced');if(!jobs[a[2]]) error('E_SCHEDULE_UNKNOWN','missing');if(fs.existsSync(join(root,'schedule-running-'+a[2]))) error('E_SCHEDULE_RUNNING','running');delete jobs[a[2]];persist();if(fs.existsSync(join(root,'schedule-remove-flaky'))) {console.error('timed out after the effect');process.exit(124);}out({removed:a[2]});}
  else if(a[1]==='list') out({schedules:Object.values(jobs),scheduler:{installed:false,active:false}});
  else error('E_FIXTURE','unknown schedule call');
}
else {console.error('unknown fixture call '+JSON.stringify(a));process.exit(90);}
`);fs.chmodSync(fake,0o755);process.env.OATS_CLI_BIN=fake;
  const gh=join(dir,'bin','gh');
  put(gh,`#!${process.execPath}
import * as fs from 'node:fs';import {join} from 'node:path';import {execFileSync} from 'node:child_process';
const a=process.argv.slice(2),val=k=>a[a.indexOf(k)+1],root=process.env.FIXTURE_ROOT,p=join(root,'pr.json');
fs.appendFileSync(join(root,'gh-calls.jsonl'),JSON.stringify(a)+'\\n');
if(a[0]==='label') {if(a[1]!=='create' || !a.includes('--force')) process.exit(48);process.exit(fs.existsSync(join(root,'gh-label-fail'))?49:0);}
else if(a[0]!=='pr') process.exit(44);
else if(a[1]==='list') {if(fs.existsSync(join(root,'gh-unavailable'))) process.exit(45);console.log(JSON.stringify((fs.existsSync(p)?JSON.parse(fs.readFileSync(p,'utf8')):[]).filter(pr=>pr.headRefName===val('--head') && (!a.includes('--base') || pr.baseRefName===val('--base')))));}
else if(a[1]==='view') {if(fs.existsSync(join(root,'gh-unavailable'))) process.exit(45);if(fs.existsSync(join(root,'gh-view-fail-'+a[2]))) {console.error('PR '+a[2]+' unreachable');process.exit(45);}const failAt=join(root,'gh-view-fail-at'),count=join(root,'gh-view-count');if(fs.existsSync(failAt)) {const n=(fs.existsSync(count)?Number(fs.readFileSync(count,'utf8')):0)+1;fs.writeFileSync(count,String(n));if(n===Number(fs.readFileSync(failAt,'utf8'))) {console.error('transient review fetch failure');process.exit(45);}}const pr=(fs.existsSync(p)?JSON.parse(fs.readFileSync(p,'utf8')):[]).find(pr=>pr.number===Number(a[2]));if(!pr) {console.error('known PR missing');process.exit(46);}console.log(JSON.stringify(pr));}
else if(a[1]==='create') {if(fs.existsSync(join(root,'gh-fail'))) process.exit(42);if(fs.existsSync(join(root,'gh-slow'))) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,Number(fs.readFileSync(join(root,'gh-slow'),'utf8')));const branch=val('--head'),oid=execFileSync('git',['ls-remote','origin','refs/heads/'+branch],{encoding:'utf8'}).trim().split(/\\s/)[0];const rows=fs.existsSync(p)?JSON.parse(fs.readFileSync(p,'utf8')):[],number=rows.length+1;rows.push({number,url:'https://github.com/fixture/knowledge/pull/'+number,state:'OPEN',headRefName:branch,headRefOid:oid,baseRefName:val('--base'),mergedAt:null,mergeCommit:null});fs.writeFileSync(join(root,'pr-'+number+'-created.json'),JSON.stringify({title:val('--title'),body:val('--body'),labels:a.filter((x,i)=>a[i-1]==='--label')}));fs.writeFileSync(p,JSON.stringify(rows));if(fs.existsSync(join(root,'gh-uncertain'))) process.exit(43);console.log('https://github.com/fixture/knowledge/pull/1');}
else process.exit(44);
`);fs.chmodSync(gh,0o755);
  const repo=join(dir,'accepted-repo'); const base=kind==='directory'?{id:'base-1',kind,path:'base'}:{id:'base-1',kind,repository:repo,root,acceptedBranch:'main',pr:{repository:'fixture/knowledge'}};
  if(kind==='git') {process.env.PATH+=`:${hostPath}`;fs.mkdirSync(repo);git(repo,['init','-q','--initial-branch=main']);}
  const bindingFile=join(dir,'bindings.json');save(bindingFile,{version:1,stateDir:'state',bases:{project:base}});process.env.OATS_SETTINGS=JSON.stringify({'bindings-file':bindingFile,harvest:'on'});
  const nodesFile=join(dir,'nodes.json');save(nodesFile,nodes);
  const bindings=loadBindings();
  if(kind==='directory') initBase(bindings,'project',nodesFile,undefined,{confirm:true});
  else {
    const tmp=join(dir,'seed');initBase(bindings,'project',nodesFile,tmp);fs.cpSync(tmp,root==='.'?repo:join(repo,root),{recursive:true});
    if(root!=='.') put(join(repo,'code.txt'),'code baseline\n');
    git(repo,['add','.']);git(repo,['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','baseline']);
  }
  const home=join(context,'source-home'),soul=join(context,'source-soul');fs.mkdirSync(join(home,'work'),{recursive:true});fs.mkdirSync(soul);
  put(join(soul,'AGENTS.md'),'# Expert\nOwn domain rationale and hard-won limitations.\n');
  put(join(soul,'soul.yaml'),'name: source\nwork: directory\n');save(join(soul,'okf.json'),{version:1,owner:'owner-1',owns:['project/expert'],reads:['project/peer']});
  fs.symlinkSync(soul,join(home,'soul'));save(join(home,'instance.json'),{instance:'source-one',agent:'source',repo:context,work:'directory',launched:true});
  Object.assign(process.env,{OATS_HOME:home,OATS_INSTANCE_HOME:home,OATS_INSTANCE:'source-one',OATS_AGENT:'source',OATS_SOUL:soul,OATS_CONTEXT:context});
  const source=()=>register(home);
  const cli=(cmd,args=[],env={})=>{const r=spawnSync(process.execPath,[CLI,cmd,...args,'--json'],{cwd:home,env:{...process.env,...env},encoding:'utf8',timeout:30000,maxBuffer:16*1024*1024});let out;try{out=JSON.parse(r.stdout);}catch{}return {...r,out};};
  return {dir,home,soul,bindings,bindingFile,repo,source,cli,calls,context,base:bindings.bases.project};
}
function capturedBinding(f) {
  const base={...f.base,path:f.base.path},alias=base.id,decl={version:1,owner:'owner-1',owns:[`${alias}/expert`],reads:[`${alias}/peer`]};
  return {schemaVersion:1,capability:'oats.okf',payloadContract:'oats.okf.locations',payloadVersion:1,payload:{owner:'owner-1',stores:{[alias]:base},owns:[{store:alias,node:'expert',steward:'owner-1'}],reads:[{store:alias,node:'peer'}],runtime:{descriptorFile:f.bindingFile,bindings:{version:1,stateDir:f.bindings.stateDir,bases:{[alias]:base}},declaration:decl},execution:{runtime:'pi',model:null}},credentialRefs:{},provenance:[]};
}
function capturedReceipt(f,{kind='persistent',binding=capturedBinding(f)}={}) {
  return {schemaVersion:1,kind,home:f.home,work:join(f.home,'work'),context:f.context,agent:'source',instance:'source-one',
    sourceIdentity:kind==='helper'?null:{kind:'git-soul',repository:{kind:'canonical-remote',remote:'git:https://example.test/source.git'},exportPath:'agents/source'},
    role:'# Captured source\n',executionBinding:{schemaVersion:1,deployment:f.context,resolution:{schemaVersion:1,id:`sha256-${'a'.repeat(64)}`}},responsibleHuman:null,binding};
}
// Explicit provider-contract input fixture, not a kernel admission producer or
// a backfill of old instance metadata. Real producer fixtures remain separate.
function capturedExecutionEnv(f,receipt,event,{scope=false}={}) {
  const subject=receipt.kind==='helper'?helperSubject(receipt.agent):persistentSubject(receipt.agent);
  if(receipt.kind==='persistent') {
    const soul=subject.soul,identity=structuredClone(receipt.sourceIdentity);
    soul.identity=identity;soul.sourceArtifact.identity=identity;soul.definition=identity.exportPath==='.'?'soul.yaml':`${identity.exportPath}/soul.yaml`;
    soul.revision.source=identity.kind==='local-soul'?identity.source:'path:/fixture/source-export';
    if(identity.kind==='git-soul')soul.revision.repository=identity.repository;
  }
  const action=['spawn','retire','soul-scaffold'].includes(event)?{kind:'hook',capability:'oats.okf',name:event}:{kind:'command',namespace:'okf',name:event};
  const value=invocationFor({binding:receipt.binding,context:{kind:'standalone',key:'provider-fixture'},action,subject});
  value.instance={...value.instance,home:receipt.home,work:receipt.work,name:receipt.instance,agent:receipt.agent};
  value.executionBinding=receipt.executionBinding;value.intent={schemaVersion:1,executionId:randomUUID(),incarnationId:value.instance.incarnationId,attempt:1};
  if(scope){value.instance=null;value.intent=null;}
  const file=join(f.dir,`execution-${randomUUID()}.json`);save(file,value);return {OATS_INVOCATION_CONTEXT_FILE:file};
}
function git(repo,args) {return execFileSync('git',['-C',repo,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();}
function note(f,name='decision.md',text='The human chose explicit custody because hidden fallbacks conceal delivery failures.') {put(join(f.home,'notes',name),`---\ntype: Decision\ntitle: Explicit custody\ndescription: Why custody is explicit.\n---\n\n${text}\n`);}
function prepared(f,s=f.source()) {capture(s);const r=runSource(s,{manual:true,noLaunch:true});return {s,run:readRun(s,r.run)};}
function judgment(f,s,run,{drop=false,base='project',node='expert',secret=false,cite=true}={}) {
  const stage=run.stages[base]; const file=join(run.worker.home,'work','judgment.json');
  // okf 4.0.0: a promotion from a transcript (record) input cites its turn ids.
  const turns=id=>{const v=input(s,id);return v.kind==='record' && cite?{turns:v.turns.map(t=>t.id)}:{};};
  const outcomes=run.inputs.map(id=>({input:id,verdict:drop?'drop':'promote',reason:drop?'Task residue.':'Human accepted rationale passes both tests.',concepts:drop?[]:[{base,path:`${node}/decision.md`}],...turns(id)}));
  if(!drop) {
    put(join(stage.root,node,'decision.md'),`---\ntype: Decision\ntitle: Explicit custody\ndescription: Why custody is explicit.\n---\n\nExplicit custody prevents hidden delivery fallback.\n${secret?'ghp_abcdefghijklmnopqrstuvwxyz0123456789':''}\n${run.inputs.map(id=>'Evidence: OKF input '+id).join('\n')}\n`);
    fs.appendFileSync(join(stage.root,node,'index.md'),'* [Explicit custody](decision.md) - Why custody is explicit.\n');
    fs.appendFileSync(join(stage.root,node,'log.md'),'* Creation: explicit custody.\n');
  }
  save(file,{version:1,exclusionsReviewed:true,outcomes});return file;
}

test('exported payload version, floor, required hooks and complete command inventory',()=>{
  for(const obsolete of ['oats.json','bin','agents','skills','injects']) assert.equal(fs.existsSync(join(ROOT,'oats-package',obsolete)),false,`obsolete unenumerated root payload: ${obsolete}`);
  assert.ok(fs.statSync(join(ROOT,'oats-package/LICENSE')).isFile());
  // npm drops symlinks from published tarballs: the capability tree ships none.
  const links=[];(function walk(dir){for(const d of fs.readdirSync(dir,{withFileTypes:true})){const p=join(dir,d.name);if(d.isSymbolicLink())links.push(p.slice(CAP.length+1));else if(d.isDirectory())walk(p);}})(CAP);
  assert.deepEqual(links,[],'no symlinks anywhere under the capability root');
  assert.equal(fs.existsSync(join(CAP,'agents')),false,'the harvester is the package soul oats.okf/knowledge-harvester, not a capability agent');
  assert.ok(fs.statSync(join(ROOT,'oats-package/souls/knowledge-harvester/AGENTS.md')).isFile(),'the harvester soul keeps its one canonical instruction file');
  const m=readJSON(join(CAP,'oats.json')),distribution=readJSON(join(ROOT,'oats-package/oats-package.json'));
  for(const manifest of [readJSON(join(ROOT,'package.json')),distribution,m])assert.equal(manifest.version,'4.2.0');
  for(const manifest of [distribution,m])assert.equal(manifest.compatibility.oats,'>=0.29.0');
  assert.equal(m.hooks.spawn.required,true);
  for(const c of ['harvest','inspect','setup','run-source','complete','retry','migrate','read','refresh','init','bases','index','cat','ls','links','search','harvest-status']) assert.ok(m.commands[c]);
  const inj=fs.readFileSync(join(CAP,m.inject),'utf8');assert.doesNotMatch(inj,/memory-harvest|knowledge-theory/);assert.match(inj,/after compaction/);
  const skill=fs.readFileSync(join(ROOT,'oats-package/capabilities/oats-okf-harvest/skills/knowledge-theory/SKILL.md'),'utf8');assert.ok(skill.indexOf('### 3.2 The accept list')<skill.indexOf('## One canonical home'));assert.match(skill,/Could it NOT have found this by reading the repository/);
});
test('c77 OKF declares only own helper omission and unchanged lifecycle input opt-ins',()=>{
  const m=readJSON(join(CAP,'oats.json'));
  assert.deepEqual(m.helperInjection,{version:1,mode:'omit'});
  assert.equal(m.inject,'injects/okf.md','primary contribution is unchanged');
  assert.deepEqual(m.hooks.spawn,{command:'bin/oats-okf.mjs spawn',required:true,inputs:{sourceReceipt:{version:1}}});
  assert.deepEqual(m.hooks.retire,{command:'bin/oats-okf.mjs retire',inputs:{sourceReceipt:{version:1}}});
  assert.equal(Object.hasOwn(m.hooks.retire,'required'),false,'legacy optional retire semantics are unchanged');
  assert.equal(m.hooks['soul-scaffold'],'bin/oats-okf.mjs soul-scaffold','no source receipt opt-in for stateless soul guidance');
});
test('help is side-effect free, including malformed settings and every declared command',t=>{
  const f=fixture(t);for(const cmd of Object.keys(readJSON(join(CAP,'oats.json')).commands)) {const r=f.cli(cmd,['--help'],{OATS_SETTINGS:'!'});assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/oats okf/);}assert.equal(fs.existsSync(f.calls),false);
});
test('directory init, cross-node views, role evidence allowlist and inactive scheduler',t=>{
  const f=fixture(t);const s=f.source();assertNoLocalCopy(f.home);assert.match(readAccepted(s,'/peer/index.md').text,/# peer/);assert.equal(s.owner,'owner-1');assert.equal(s.launchRecipe,undefined);assert.equal(s.settings,undefined);
  // okf 4.2.0: registration creates no scheduler job and records no schedule.
  assert.equal(fs.existsSync(f.calls),false,'registration made no CLI call');assert.equal(fs.existsSync(join(dirname(s.file),'schedule.json')),false);assert.equal(loadStatus(s).schedule,undefined);
  assert.equal(s.bindings.cron,undefined);assert.equal(s.bindings.tz,undefined);
  assert.equal(f.cli('inspect').out.result.scheduler.active,false);
});
test('notes AND complete bounded record backlog are durable before final home deletion',t=>{
  const f=fixture(t);const s=f.source();note(f);
  const turns=Array.from({length:145},(_,i)=>({id:`turn-${i}`,thread:'thread-1',kind:'session',ts:'2026-09-13',source:'pi',text:[{role:'assistant',text:'Observed limitation '+i}]}));
  save(join(f.dir,'turns.json'),turns);save(join(f.dir,'capture.json'),{status:'complete',complete:true,sessions:[{thread:'thread-1',lastTurnId:'turn-144'}],ignored:2});
  const result=capture(s,{final:true});assert.equal(result.complete,true);
  const st=loadStatus(s);assert.equal(st.captured.inputs.length,4);assert.equal(st.captured.threads['thread-1'],'turn-144');assert.equal(st.lastCapture.ignored,2);
  fs.rmSync(f.home,{recursive:true});
  const r=runSource(loadSource(s.file),{manual:true,noLaunch:true});const run=readRun(s,r.run);
  const evidence=readJSON(join(run.worker.home,'work/input.json'));assert.equal(evidence.inputs.filter(i=>i.kind==='record').flatMap(i=>i.turns).length,145);assert.equal(evidence.inputs.filter(i=>i.kind==='note').length,1);
  const calls=fs.readFileSync(f.calls,'utf8').trim().split('\n').map(JSON.parse);const spawn=calls.find(c=>c.a[0]==='spawn' && !c.a.includes('--preview'));assert.equal(spawn.a.includes('--parent'),false);assert.equal(spawn.a.includes('--work-dir'),false);assert.equal(spawn.a.includes('--branch'),false);
});
test('capture incomplete, held, skipped, failed and uncertified results retain home and evidence',t=>{
  const f=fixture(t);const s=f.source();note(f);
  for(const status of ['incomplete','held','skipped','failed',undefined]) {
    save(join(f.dir,'capture.json'),{status,complete:false,sessions:[]});const r=f.cli('retire');assert.equal(r.status,1);assert.equal(r.out.meta.retired,false);assert.equal(loadStatus(s).retired,false);assert.equal(fs.existsSync(f.home),true);
  }
  assert.equal(loadStatus(s).captured.inputs.length,1);
});
test('notes content rewrite is captured, replay is idempotent, completion never deletes live notes',t=>{
  const f=fixture(t);note(f);const {s,run}=prepared(f);note(f,'decision.md','Revised observation while the worker is running.');capture(s);const before=loadStatus(s);assert.equal(before.captured.inputs.length,2);capture(s);assert.equal(loadStatus(s).captured.inputs.length,2);
  const result=complete(s,run.id,judgment(f,s,run));assert.equal(result.processed,true);assert.equal(result.receipts.project.status,'accepted');assert.match(fs.readFileSync(join(f.home,'notes/decision.md'),'utf8'),/Revised/);assert.equal(loadStatus(s).processed.length,1);
});
test('harvest worker spawn without a messaging capability spawns without join and records no team',t=>{
  const f=fixture(t);save(join(f.dir,'preview.json'),{modules:[{name:'oats.okf-harvest',layer:null}]});note(f);prepared(f);
  const calls=fs.readFileSync(f.calls,'utf8').trim().split('\n').map(JSON.parse),spawn=calls.find(c=>c.a[0]==='spawn' && !c.a.includes('--preview')).a;
  assert.equal(spawn.includes('--provider'),false);
  const s=register(f.home),run=readRun(s,loadStatus(s).activeRun);assert.equal(run.team,undefined,'okf 4.0.2: no okf team');
  const task=fs.readFileSync(join(run.worker.home,'TASK.md'),'utf8');
  assert.match(task,/Load the knowledge-harvest skill first/);assert.match(task,/the notes AND every transcript window; cite the turn ids/);
  assert.match(task,/'oats' 'okf-harvest' 'complete' '--source'/);assert.match(task,/'oats' 'okf-harvest' 'harvest-status'/);
  // okf 4.2.0 (#47): the harvester hands over and retires once delivered; it never waits for the review.
  assert.match(task,/Once every destination is delivered, run the status command: when it says retire, hand over in your final reply/);assert.doesNotMatch(task,/stay alive|until your PR is merged/i);
  assert.match(task,/status delivering.*run the completion command again/);assert.match(task,/On failure keep your home and report it; do not retire/);assert.doesNotMatch(task,/okf team/);assert.match(task,/Never close the PR yourself/);
  assert.doesNotMatch(task,/memory-harvest|retire normally/);
});
for(const [features,flag] of [[['schedule','harness'],'--harness'],[['schedule'],'--runtime'],[null,'--runtime']]) test(`harvest worker spawn passes ${flag} when oats version features are ${JSON.stringify(features)}`,t=>{
  const f=fixture(t);if(features) save(join(f.dir,'version.json'),{schemaVersion:1,name:'@awebai/oats',version:'0.27.1',features});
  note(f);prepared(f);
  const calls=fs.readFileSync(f.calls,'utf8').trim().split('\n').map(JSON.parse),spawn=calls.find(c=>c.a[0]==='spawn' && !c.a.includes('--preview')).a;
  assert.equal(spawn[spawn.indexOf(flag)+1],'pi');assert.equal(spawn.includes(flag==='--harness'?'--runtime':'--harness'),false);
  // okf 4.0.2: the harvester is the package soul and joins no team, even with a
  // messaging capability available; it lives in the deployment's default team.
  assert.equal(spawn[1],'oats.okf/knowledge-harvester');
  assert.equal(spawn.includes('--provider'),false);assert.equal(spawn.some(a=>/^join=/.test(a)),false);
  for(const gone of ['--repo','--work']) assert.equal(spawn.includes(gone),false,gone);
  assert.equal(calls.some(c=>c.a[0]==='spawn' && c.a.includes('--preview')),false,'no preview: nothing to join');
  assert.ok(calls.some(c=>c.a[0]==='version' && c.a[1]==='--json'),'the kernel was asked, not guessed');
});
test('no-change/all-drop succeeds without invented Git or PR receipt',t=>{
  const f=fixture(t);note(f);const {s,run}=prepared(f);const r=complete(s,run.id,judgment(f,s,run,{drop:true}));assert.equal(r.status,'processed');assert.equal(r.receipts.project.status,'no-change');assert.equal(r.receipts.project.pr,undefined);
});
test('directory delivery uses no git/gh tools and confirms reader-visible bytes',t=>{
  const f=fixture(t);fs.unlinkSync(join(f.dir,'bin','gh'));note(f);const {s,run}=prepared(f);const r=complete(s,run.id,judgment(f,s,run));assert.equal(r.receipts.project.status,'accepted');assert.ok(fs.existsSync(join(f.base.path,'expert/decision.md')));
  assert.match(readAccepted(s,'/expert/decision.md').text,/prevents hidden delivery/,'a consult read sees the accepted bytes in place');
});
test('directory baseline conflict retains pending input and permits explicit rejudgment',t=>{
  const f=fixture(t);note(f);const {s,run}=prepared(f);const j=judgment(f,s,run);fs.appendFileSync(join(f.base.path,'peer/log.md'),'other writer\n');assert.throws(()=>complete(s,run.id,j),/base changed/);assert.equal(loadStatus(s).processed.length,0);
  assert.equal(retry(s,{rejudge:true}).status,'abandoned');assert.equal(fs.existsSync(run.worker.home),true);
});
test('directory crash midway publication blocks readers, retry recovers and confirms once',t=>{
  const f=fixture(t);note(f);const {s,run}=prepared(f);const j=judgment(f,s,run);
  assert.throws(()=>complete(s,run.id,j,{afterWrite:n=>{if(n===1)throw new Error('simulated crash');}}),/simulated crash/);
  assert.equal(fs.existsSync(journalPath(f.base)),true);assert.equal(loadStatus(s).processed.length,0);
  assert.throws(()=>readAccepted(s),/publication pending/);
  const r=retry(s);assert.equal(r.processed,true);assert.equal(fs.existsSync(journalPath(f.base)),false);assert.equal(loadStatus(s).processed.length,1);
});
test('source and base contention do not expire or steal locks',t=>{
  const f=fixture(t);const s=f.source();note(f);
  withLock(join(dirname(s.file),'capture.lock'),()=>assert.throws(()=>capture(s),/busy lock/));
  withLock(baseLock(f.base),()=>assert.throws(()=>stageBase(f.base,join(f.dir,'stage')),/busy lock/));
});
test('frozen bindings prevent alias retargeting queued source input',t=>{
  const f=fixture(t);note(f);const s=f.source();capture(s,{final:true});const changed=readJSON(f.bindingFile);changed.bases.project.path='another-base';save(f.bindingFile,changed);
  const r=runSource(loadSource(s.file),{manual:true,noLaunch:true});const run=readRun(s,r.run);complete(s,run.id,judgment(f,s,run));assert.ok(fs.existsSync(join(f.base.path,'expert/decision.md')));assert.equal(fs.existsSync(join(f.dir,'another-base')),false);
});
test('ownership escape and unrelated base navigation edits fail before publication',t=>{
  const f=fixture(t);note(f);const {s,run}=prepared(f);const j=judgment(f,s,run);fs.appendFileSync(join(run.stages.project.root,'peer/log.md'),'unauthorized\n');assert.throws(()=>complete(s,run.id,j),/unauthorized touched/);assert.equal(fs.existsSync(join(f.base.path,'expert/decision.md')),false);
});
test('symlink, hardlink, traversal, overlapping paths and ambiguous owners fail closed',t=>{
  const f=fixture(t);const raw=readJSON(f.bindingFile);
  const bad=structuredClone(raw);bad.bases.duplicate={...bad.bases.project};assert.throws(()=>validateBindings(bad,f.bindingFile),/duplicate base identity/);
  const state=structuredClone(raw);state.stateDir='base/state';assert.throws(()=>validateBindings(state,f.bindingFile),/state overlaps/);
  fs.symlinkSync(f.base.path,join(f.dir,'alias'));const link=structuredClone(raw);link.bases.project.path='alias';assert.throws(()=>validateBindings(link,f.bindingFile),/symlink/);
  const escape=tree(f.base.path);const m=JSON.parse(Buffer.from(escape['okf-base.json'],'base64'));m.nodes.peer.path='../escape';escape['okf-base.json']=Buffer.from(JSON.stringify(m)).toString('base64');assert.throws(()=>metadata(escape,f.base),/noncanonical/);
  fs.linkSync(join(f.base.path,'log.md'),join(f.base.path,'hard.md'));assert.throws(()=>tree(f.base.path),/hardlink/);
});
test('missing bases never bootstrap during required spawn; legacy bundles get migration diagnostic',t=>{
  const f=fixture(t);put(join(f.soul,'knowledge/index.md'),'legacy remains');const r=f.cli('spawn');assert.equal(r.status,1);assert.match(r.out.warning,/legacy.*migration|legacy.*migrate/);assert.equal(fs.readFileSync(join(f.soul,'knowledge/index.md'),'utf8'),'legacy remains');
  fs.rmSync(join(f.soul,'knowledge'),{recursive:true});fs.rmSync(f.base.path,{recursive:true});const missing=f.cli('spawn');assert.equal(missing.status,1);assert.equal(fs.existsSync(f.base.path),false);
});
test('2.1.5 spawn requires OATS_SOUL from the kernel, never the home soul link fallback',t=>{
  const f=fixture(t),env={...process.env};delete env.OATS_SOUL;
  const r=spawnSync(process.execPath,[CLI,'spawn','--json'],{cwd:f.home,env,encoding:'utf8',timeout:30000,maxBuffer:16*1024*1024});
  const out=JSON.parse(r.stdout);assert.equal(r.status,1,r.stdout+r.stderr);
  assert.match(out.warning,/E_OATS_SOUL_MISSING/);assert.match(out.warning,/OATS_SOUL is not set; oats\.okf hooks and commands run only under the OATS kernel/);
});
test('2.1.5 unusable git bases fail with typed alias-specific deployment binding errors before source registration',t=>{
  const f=fixture(t,{kind:'git'}),raw=readJSON(f.bindingFile),missing=join(f.dir,'missing.git');
  raw.bases={unreachable:{...raw.bases.project,id:'missing-base',repository:missing},project:raw.bases.project};save(f.bindingFile,raw);
  const r=f.cli('spawn');assert.equal(r.status,1,r.stdout+r.stderr);assert.equal(fs.existsSync(join(f.home,'.okf-source.json')),false);assert.equal(fs.existsSync(join(f.bindings.stateDir,'owners.json')),false);
  assert.match(r.out.warning,/E_BASE_UNAVAILABLE/);assert.match(r.out.warning,/unreachable/);assert.match(r.out.warning,/missing\.git/);assert.match(r.out.warning,/reason: not-found/);
  assert.match(r.out.warning,/required by the deployment's bindings/);assert.doesNotMatch(r.out.warning,/not by this soul/);assert.match(r.out.warning,/fix the binding for base alias "unreachable" in the bindings file, or remove the base from the bindings/);
});
test('2.1.5 unclassified git failures keep reason unknown and include the original message',t=>{
  const f=fixture(t,{kind:'git'});gitWrapper(f,`if(a.includes('clone')) {console.error('strange transport fixture');process.exit(87);}`);
  let error;assert.throws(()=>{try{stageBase(f.base,join(f.dir,'unknown-git-failure'),{alias:'project'});}catch(e){error=e;throw e;}});
  assert.equal(error.code,'E_BASE_UNAVAILABLE');assert.equal(error.reason,'unknown');assert.match(error.message,/reason: unknown/);assert.match(error.message,/strange transport fixture/);
});
test('2.1.5 shallow git bases are refused with E_BASE_SHALLOW before durable source state',t=>{
  const f=fixture(t,{kind:'git'}),shallow=join(f.dir,'shallow.git');
  execFileSync('git',['clone','--bare','--depth','1',`file://${f.repo}`,shallow],{env:{...process.env,PATH:hostPath},stdio:'ignore'});
  assert.equal(git(shallow,['rev-parse','--is-shallow-repository']),'true');
  const raw=readJSON(f.bindingFile);raw.bases={shallow:{...raw.bases.project,id:'shallow-base',repository:shallow},project:raw.bases.project};save(f.bindingFile,raw);
  const r=f.cli('spawn');assert.equal(r.status,1,r.stdout+r.stderr);assert.equal(fs.existsSync(join(f.home,'.okf-source.json')),false);assert.equal(fs.existsSync(join(f.bindings.stateDir,'owners.json')),false);
  assert.match(r.out.warning,/E_BASE_SHALLOW/);assert.match(r.out.warning,/shallow/);assert.match(r.out.warning,/shallow\.git/);
  assert.match(r.out.warning,/required by the deployment's bindings/);assert.doesNotMatch(r.out.warning,/not by this soul/);assert.match(r.out.warning,/fix the binding for base alias "shallow" in the bindings file, or remove the base from the bindings/);
});
test('2.1.5 owner rename refusal names the old and new souls and both remedies',t=>{
  const dir=fs.realpathSync(fs.mkdtempSync(join(tmpdir(),'okf-owner-')));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const owners=join(dir,'owners.json');pinOwner(owners,'owner-1',{id:'repo:source',soulName:'source',path:'/old/source'});
  assert.throws(()=>pinOwner(owners,'owner-1',{id:'repo:renamed',soulName:'renamed',path:'/new/renamed'}),error=>{
    assert.equal(error.code,'E_OWNER');assert.match(error.message,/stable owner ID already identifies a different soul in this state namespace/);
    assert.match(error.message,/existing .*repo:source/);assert.match(error.message,/new .*repo:renamed/);
    assert.match(error.message,/retire the existing registration first/i);assert.match(error.message,/fresh state directory/i);return true;
  });
});
test('no-launch sources and service workers never trigger scheduled model launches or recursive capture',t=>{
  const f=fixture(t);const s=f.source();note(f);save(join(f.home,'instance.json'),{instance:'source-one',agent:'source',repo:f.context,work:'directory',launched:false});
  const calls=()=>fs.existsSync(f.calls)?fs.readFileSync(f.calls,'utf8'):'';
  // okf 4.2.0: a legacy job firing run-source (no --manual) is inert and says why.
  const fired=f.cli('run-source',['--source',s.file]);assert.equal(fired.status,1);assert.equal(fired.out.error.code,'E_HARVEST_SCHEDULE_REMOVED');assert.equal(calls(),'');assert.deepEqual(loadStatus(s).captured.inputs,[]);
  assert.equal(runSource(s).status,'skipped');assert.equal(calls(),'');
  const serviceHome=join(f.dir,'service-home');fs.mkdirSync(serviceHome);
  const service=f.cli('spawn',[],{OATS_KIND:'capability',OATS_SETTINGS:'{}',OATS_HOME:serviceHome,OATS_INSTANCE_HOME:serviceHome});assert.equal(service.out.meta.memory,'none');assert.equal(calls(),'');
  // Retiring a never-launched source (a no-launch spawn's compensation) certifies custody and launches no model.
  const retired=f.cli('retire');assert.equal(retired.status,0,retired.stdout);assert.equal(retired.out.meta.retired,true);
  assert.equal(retired.out.meta.drain.status,'not-launched');assert.match(retired.out.meta.drain.next,/run-source --source .* --manual/);
  const made=calls().trim().split('\n').map(JSON.parse);assert.equal(made.some(({a})=>['spawn','session'].includes(a[0])),false,'no harvester, no model');
  assert.equal(loadStatus(s).captured.inputs.length,1);assert.equal(loadStatus(s).activeRun,null);assert.equal(loadStatus(s).drain,undefined);
});
test('inspect authority distinguishes legacy, invalid, disabled and specified without exposing opaque binding',()=>{
  assert.deepEqual(capturedAuthority({}),{schemaVersion:1,registration:'legacy',capture:'unknown',migrationRequired:true,responsibleHuman:{status:'unknown'}});
  assert.deepEqual(capturedAuthority({registration:{schemaVersion:1,kind:'captured'},providerBinding:{},sourceIdentity:{kind:'git-soul'},responsibleHuman:null}),{schemaVersion:1,registration:'invalid',capture:'invalid',migrationRequired:true,responsibleHuman:{status:'unknown'}});
  const base={registration:{schemaVersion:1,kind:'captured'},providerBinding:{opaque:'never-returned'},sourceIdentity:{kind:'git-soul',repository:{kind:'canonical-remote',remote:'git:https://example.invalid/source.git'},exportPath:'agents/expert'},executionBinding:{schemaVersion:1,deployment:'/srv/oats/example',resolution:{schemaVersion:1,id:`sha256-${'a'.repeat(64)}`}}};
  const disabled=capturedAuthority({...base,responsibleHuman:null}),specified=capturedAuthority({...base,responsibleHuman:{provider:'example.messaging',id:'human-1'}});
  assert.equal(disabled.responsibleHuman.status,'disabled');assert.equal(specified.responsibleHuman.status,'specified');
  for(const result of [disabled,specified]) {assert.equal(Object.hasOwn(result,'providerBinding'),false);assert.doesNotMatch(JSON.stringify(result),/opaque|human-1|OATS_BINDING_FILE/);assert.ok(Buffer.byteLength(JSON.stringify(result))<65536);}
  assert.equal(capturedAuthority({...base,sourceIdentity:{kind:'git-soul',padding:'x'.repeat(65536)},responsibleHuman:null}).registration,'invalid','authority summary remains bounded');
  for(const remote of ['git:https://user:SYNTHETIC_SECRET@example.invalid/soul.git','git:https://example.invalid/soul.git?token=SYNTHETIC_SECRET','git:ssh://git@example.invalid/soul.git#SYNTHETIC_SECRET','git:https://','git:https://example.invalid/../soul.git']) {
    const bad={...base,sourceIdentity:{...base.sourceIdentity,repository:{kind:'canonical-remote',remote}},responsibleHuman:null},result=capturedAuthority(bad);
    assert.equal(result.registration,'invalid');assert.doesNotMatch(JSON.stringify(result),/SYNTHETIC_SECRET|sourceIdentity/);
  }
});
test('legacy inspect reports unknown registration authority without changing existing fields',t=>{
  const f=fixture(t),s=f.source(),result=f.cli('inspect');assert.equal(result.status,0,result.stdout);
  assert.deepEqual(result.out.result.authority,{schemaVersion:1,registration:'legacy',capture:'unknown',migrationRequired:true,responsibleHuman:{status:'unknown'}});
  assert.equal(result.out.result.source,s.file);assert.deepEqual(result.out.result.owns,s.decl.owns);assert.deepEqual(result.out.result.reads,s.decl.reads);assert.deepEqual(result.out.result.bases,s.bindings.bases);assert.deepEqual(result.out.result.status,loadStatus(s));
});
test('generic lifecycle ingress refuses missing or contradictory admission before registration',t=>{
  const f=fixture(t),receipt=capturedReceipt(f),bindingFile=join(f.dir,'binding-input.json'),receiptFile=join(f.dir,'source-input.json');save(bindingFile,receipt.binding);save(receiptFile,receipt);
  const oldEnv={OATS_BINDING_FILE:bindingFile,OATS_SOURCE_RECEIPT_FILE:receiptFile};
  const before=inventory(f.dir),missing=f.cli('spawn',[],oldEnv);
  assert.equal(missing.status,1);assert.match(missing.stdout,/new captured registration requires generic admitted invocation/);assert.deepEqual(inventory(f.dir),before,'old receipt-only transport cannot bootstrap a new source');
  const generic=capturedExecutionEnv(f,receipt,'spawn'),file=generic.OATS_INVOCATION_CONTEXT_FILE,valid=readJSON(file);
  for(const value of [
    {...valid,intent:null},
    {...valid,action:{...valid.action,name:'retire'}},
    {...valid,instance:{...valid.instance,home:join(f.dir,'other'),work:join(f.dir,'other/work')}},
    {...valid,intent:{...valid.intent,attempt:0}},
  ]) {
    save(file,value);const bytes=inventory(f.dir),result=f.cli('spawn',[],{...oldEnv,...generic});
    assert.equal(result.status,1,result.stdout);assert.deepEqual(inventory(f.dir),bytes,'invalid generic authority causes no registration/schedule effects');
  }
  save(file,valid);const badReceipt={...receipt,responsibleHuman:{provider:'example.human',id:'other'}};save(receiptFile,badReceipt);
  const bytes=inventory(f.dir),result=f.cli('spawn',[],{...oldEnv,...generic});assert.equal(result.status,1);assert.deepEqual(inventory(f.dir),bytes);
  assert.equal(fs.existsSync(join(f.home,'.okf-source.json')),false);assert.equal(fs.existsSync(f.bindings.stateDir),false);
});

test('c77 NEW captured registration refuses missing SourceReceipt1 before any effects',t=>{
  for(const kind of ['persistent','helper']) {
    const f=fixture(t),receipt=capturedReceipt(f,{kind}),snapshot=join(f.dir,'binding-input.json');save(snapshot,receipt.binding);
    // Even contradictory live service metadata cannot confer helper skip/input
    // authority. Generic fixtures supply the actual retained subject instead.
    save(join(f.home,'instance.json'),{kind:'capability',instance:'source-one',agent:'source'});
    const preload=noEffectsPreload(f.dir);
    for(const event of ['spawn','retire']) {
      const env={...process.env,OATS_BINDING_FILE:snapshot,...capturedExecutionEnv(f,receipt,event)};
      const before=inventory(f.dir),result=spawnSync(process.execPath,['--import',preload,CLI,event,'--json'],{cwd:f.home,env,encoding:'utf8',timeout:30000});
      assert.equal(result.status,1,result.stdout+result.stderr);
      assert.match(result.stdout,/new captured registration requires SourceReceipt1 input authority/);
      assert.equal(result.stderr,'');assert.deepEqual(inventory(f.dir),before,'no source, owner, view, scheduler, lock or native mutation');
    }
    assert.equal(fs.existsSync(join(f.home,'.okf-source.json')),false);assert.equal(fs.existsSync(f.bindings.stateDir),false);
  }
});

test('c77 absent SourceReceipt1 permits only qualified already-registered replay',t=>{
  const f=fixture(t),receipt=capturedReceipt(f),source=registerCaptured(f.home,receipt),snapshot=join(f.dir,'binding-input.json');save(snapshot,receipt.binding);
  const sourceBytes=fs.readFileSync(source.file),owners=fs.readFileSync(join(f.bindings.stateDir,'owners.json'));
  for(const generic of [false,true]) {
    const env={OATS_BINDING_FILE:snapshot,...(generic?capturedExecutionEnv(f,receipt,'spawn'):{})};
    const result=f.cli('spawn',[],env);assert.equal(result.status,0,result.stdout+result.stderr);
    assert.equal(result.out.meta.source,source.file);assert.deepEqual(fs.readFileSync(source.file),sourceBytes);assert.deepEqual(fs.readFileSync(join(f.bindings.stateDir,'owners.json')),owners);
  }
  note(f);const retired=f.cli('retire',[],{OATS_BINDING_FILE:snapshot,...capturedExecutionEnv(f,receipt,'retire')});
  assert.equal(retired.status,0,retired.stdout);assert.equal(retired.out.meta.retired,true);
  assert.deepEqual(fs.readFileSync(source.file),sourceBytes,'final capture does not replace source identity');
  // Retained data is not authority to recreate a missing home registration.
  fs.rmSync(join(f.home,'.okf-source.json'));
  const env={OATS_BINDING_FILE:snapshot,...capturedExecutionEnv(f,receipt,'spawn')},before=inventory(f.dir),result=f.cli('spawn',[],env);
  assert.equal(result.status,1);assert.match(result.stdout,/new captured registration requires SourceReceipt1 input authority/);
  assert.deepEqual(inventory(f.dir),before,'no reconstruction from an old descriptor or current soul/config');
});

test('captured registration freezes qualified identity and binding, creates no schedule, without live source fallback',t=>{
  const f=fixture(t),receipt=capturedReceipt(f),snapshot=join(f.dir,'invocation-binding.json'),wrong=structuredClone(receipt.binding),priorBinding=process.env.OATS_BINDING_FILE;
  t.after(()=>{if(priorBinding===undefined) delete process.env.OATS_BINDING_FILE;else process.env.OATS_BINDING_FILE=priorBinding;});
  wrong.payload.execution.model='different/model';save(snapshot,wrong);process.env.OATS_BINDING_FILE=snapshot;
  assert.throws(()=>registerCaptured(f.home,receipt),/differs from invocation snapshot/);assert.equal(fs.existsSync(join(f.home,'.okf-source.json')),false);
  delete process.env.OATS_BINDING_FILE;save(snapshot,receipt.binding);const receiptFile=join(f.dir,'source-receipt.json');save(receiptFile,receipt);
  const executionEnv=capturedExecutionEnv(f,receipt,'spawn');
  const lifecycle=f.cli('spawn',[],{OATS_BINDING_FILE:snapshot,OATS_SOURCE_RECEIPT_FILE:receiptFile,...executionEnv});assert.equal(lifecycle.status,0,lifecycle.stdout);
  const contextFile=executionEnv.OATS_INVOCATION_CONTEXT_FILE,context=readJSON(contextFile);save(contextFile,{...context,intent:null});
  const beforeRejectedReplay=inventory(f.dir),unadmitted=f.cli('spawn',[],{OATS_BINDING_FILE:snapshot,OATS_SOURCE_RECEIPT_FILE:receiptFile,...executionEnv});
  assert.equal(unadmitted.status,1);assert.match(unadmitted.stdout,/requires an admitted instance intent/);assert.deepEqual(inventory(f.dir),beforeRejectedReplay,'present unadmitted context cannot downgrade to registered replay');save(contextFile,context);
  const s=loadSource(lifecycle.out.meta.source);
  assert.equal(fs.existsSync(join(f.dir,'schedules.json')),false,'okf 4.2.0: no scheduler job');assert.equal(fs.existsSync(join(dirname(s.file),'schedule.json')),false);
  const again=registerCaptured(f.home,receipt);assert.equal(again.id,s.id,'captured registration remains idempotent');assert.equal(s.registration.kind,'captured');assert.deepEqual(s.providerBinding,receipt.binding);assert.deepEqual(s.executionBinding,receipt.executionBinding);assert.equal(s.responsibleHuman,null);
  const owner=readJSON(join(f.bindings.stateDir,'owners.json'))['owner-1'];assert.equal(owner.kind,'captured-qualified-soul');assert.deepEqual(owner.identity,receipt.sourceIdentity);
  // The legacy job shape --remove-schedules proves ownership by (okf <= 4.1 registered it).
  const argv=legacyScheduleArgv(s);assert.ok(argv.includes('--deployment'));assert.equal(argv[argv.indexOf('--resolution')+1],receipt.executionBinding.resolution.id);assert.equal(argv.includes('--soul'),false);
  save(snapshot,receipt.binding);const capturedEnv={OATS_BINDING_FILE:snapshot,OATS_SETTINGS:JSON.stringify({'bindings-file':join(f.dir,'poison.json'),'state-dir':join(f.dir,'poison-state')})},alias=f.base.id;
  const inspected=f.cli('inspect',[],capturedEnv);assert.equal(inspected.status,0);assert.deepEqual(inspected.out.result.authority,{schemaVersion:1,registration:'captured',capture:'recorded',migrationRequired:false,sourceIdentity:receipt.sourceIdentity,executionBinding:receipt.executionBinding,responsibleHuman:{status:'disabled'}});
  for(const [key,value] of [['source',s.file],['owns',s.decl.owns],['reads',s.decl.reads],['bases',s.bindings.bases],['acceptedView',s.acceptedView],['status',loadStatus(s)]]) assert.deepEqual(inspected.out.result[key],value,`existing inspect field ${key} is unchanged`);
  assert.equal(f.cli('read',['--base',alias],capturedEnv).out.error.code,'E_REMOVED');assert.equal(f.cli('index',[],capturedEnv).status,0);assert.equal(f.cli('cat',['--base',alias,'/expert/index.md'],capturedEnv).status,0);assert.equal(f.cli('refresh',[],capturedEnv).out.error.code,'E_REMOVED');
  for(const args of [['--source',s.file],['--remove-schedules']]) {const unsupported=f.cli('setup',args,capturedEnv);assert.equal(unsupported.status,1);assert.equal(unsupported.out.error.code,'E_MIGRATION');}assert.equal(fs.existsSync(join(f.dir,'schedules.json')),false);
  save(join(f.home,'instance.json'),{instance:'source-one',agent:'source',kind:'capability',launched:true});assert.equal(f.cli('spawn',[],capturedEnv).out.meta.memory,'okf-v2','captured marker outranks poisoned live service kind');
  note(f);const retired=f.cli('retire',[],capturedEnv);assert.equal(retired.status,0,retired.stdout);assert.equal(retired.out.meta.retired,true,'captured retire uses the exact registered source');
  assert.equal(retired.out.meta.drain.status,'held','a captured source drains only through its admitted operation');assert.equal(loadStatus(s).activeRun,null);
  fs.rmSync(f.home,{recursive:true});fs.rmSync(f.soul,{recursive:true});fs.rmSync(f.bindingFile);process.env.OATS_SETTINGS=JSON.stringify({'bindings-file':join(f.dir,'poison.json'),'state-dir':join(f.dir,'poison-state')});
  const frozen=loadSource(s.file);assert.equal(frozen.id,s.id);assert.equal(fs.existsSync(join(f.dir,'poison-state')),false);assert.deepEqual(inspectSource(frozen).authority,inspected.out.result.authority,'source deletion and poisoned config do not alter captured authority');
  const before=tree(f.bindings.stateDir),beforeCalls=fs.readFileSync(f.calls);
  assert.throws(()=>runSource(frozen,{manual:true,noLaunch:true}),{code:'E_CAPTURED_HELPER'});
  assert.deepEqual(tree(f.bindings.stateDir),before);assert.deepEqual(fs.readFileSync(f.calls),beforeCalls,'captured source cannot reach legacy worker spawn');
});
test('public captured harvest refuses before registration replay or scheduling effects',t=>{
  const f=fixture(t),receipt=capturedReceipt(f),s=registerCaptured(f.home,receipt),snapshot=join(f.dir,'binding-snapshot.json');save(snapshot,receipt.binding);
  note(f);capture(s);
  const id=randomUUID(),status=loadStatus(s);
  save(join(dirname(s.file),'runs',id,'run.json'),{version:1,id,source:s.id,inputs:status.captured.inputs,status:'delivered',receipts:{'base-1':{status:'delivered',proposal:'retained-fixture'}}});
  status.activeRun=id;saveStatus(s,status);
  // These pending repairs used to run before the knowingly unsupported worker.
  for(const path of ['STATE.md','log.md','notes']) fs.rmSync(join(f.home,path),{recursive:true,force:true});
  save(join(f.dir,'schedules.json'),{});
  const preload=noEffectsPreload(f.dir),before=inventory(f.dir);
  for(const env of [{OATS_BINDING_FILE:snapshot},{}]) for(const args of [[],['--no-launch']]) {
    const result=spawnSync(process.execPath,['--import',preload,CLI,'harvest','--home',f.home,...args,'--json'],{cwd:f.context,env:{...process.env,...env},encoding:'utf8',timeout:30000});
    assert.equal(result.status,1,result.stdout+result.stderr);
    const error=JSON.parse(result.stdout).error;
    // The production reader refuses a persisted captured source with NO
    // selected binding even before the qualified-helper guard. A selected
    // binding still reaches the explicit unsupported-helper diagnostic.
    assert.equal(error.code,Object.hasOwn(env,'OATS_BINDING_FILE')?'E_CAPTURED_HELPER':'E_INVOCATION');
    if(!Object.hasOwn(env,'OATS_BINDING_FILE')) assert.equal(error.message,'captured source execution requires its selected binding');
    assert.equal(result.stderr,'');assert.deepEqual(inventory(f.dir),before,'no repair, lock, schedule, input or admitted receipt change');
  }
});

test('public captured harvest with unregistered or missing source refuses without effects',t=>{
  const f=fixture(t),receipt=capturedReceipt(f),snapshot=join(f.dir,'binding-snapshot.json');save(snapshot,receipt.binding);
  const preload=noEffectsPreload(f.dir);
  for(const missing of [false,true]) {
    if(missing) {registerCaptured(f.home,receipt);fs.rmSync(f.home,{recursive:true});fs.rmSync(f.soul,{recursive:true});fs.rmSync(f.bindingFile);}
    const before=inventory(f.dir);
    for(const args of [[],['--no-launch']]) {
      const result=spawnSync(process.execPath,['--import',preload,CLI,'harvest','--home',f.home,...args,'--json'],{cwd:f.context,env:{...process.env,OATS_BINDING_FILE:snapshot},encoding:'utf8',timeout:30000});
      assert.equal(result.status,1,result.stdout+result.stderr);assert.equal(JSON.parse(result.stdout).error.code,'E_CAPTURED_HELPER');
      assert.equal(result.stderr,'');assert.deepEqual(inventory(f.dir),before,'no registration, source recreation or scheduler/worker call');
    }
  }
});

test('public legacy harvest still registers and replays its existing worker',t=>{
  const f=fixture(t);note(f);
  const first=f.cli('harvest',['--no-launch']);assert.equal(first.status,0,first.stdout+first.stderr);assert.equal(first.out.result.status,'started');assert.equal(first.out.result.launched,false);
  const second=f.cli('harvest',['--no-launch']);assert.equal(second.status,0,second.stdout+second.stderr);assert.equal(second.out.result.status,'already-running');assert.equal(second.out.result.run,first.out.result.run);
  const calls=fs.readFileSync(f.calls,'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(calls.filter(({a})=>a[0]==='spawn' && !a.includes('--preview')).length,1,'fixture scaffold only, never a real model');assert.equal(calls.some(({a})=>a[0]==='schedule'),false,'okf 4.2.0: no scheduler call');
  assert.equal(calls.some(({a})=>a[0]==='session' || a.includes('install')),false);
});

test('captured completion command binds saved selectors and public provider completion after source deletion',t=>{
  const f=fixture(t),receipt=capturedReceipt(f),s=registerCaptured(f.home,receipt);note(f);capture(s,{final:true});
  const id=randomUUID(),home=join(f.dir,'retained-worker'),alias=f.base.id;fs.mkdirSync(join(home,'work'),{recursive:true});
  save(join(home,'instance.json'),{instance:'retained-worker',agent:'memory-harvest',work:'directory'});
  const staged=stageBase(f.base,join(home,'work','base')),run={version:1,id,source:s.id,created:'2026-09-16T00:00:00.000Z',inputs:loadStatus(s).captured.inputs,status:'ready',worker:{instance:'retained-worker',home},stages:{[alias]:{root:staged.root,baseline:staged.files,digest:staged.digest,owned:['expert']}},receipts:{}};
  save(join(dirname(s.file),'runs',id,'run.json'),run);const status=loadStatus(s);status.activeRun=id;saveStatus(s,status);
  const judgmentFile=judgment(f,s,run,{drop:true,base:alias}),snapshot=join(f.dir,'completion-binding.json');save(snapshot,receipt.binding);
  const generic=capturedExecutionEnv(f,receipt,'complete',{scope:true});
  save(join(f.dir,'captured-dispatch.json'),{deployment:s.executionBinding.deployment,resolution:s.executionBinding.resolution.id,cli:CLI,bindingFile:snapshot,invocationFile:generic.OATS_INVOCATION_CONTEXT_FILE});
  const argv=completionArgv(s,id,judgmentFile);assert.deepEqual(argv.slice(0,4),['--deployment',f.context,'--resolution',receipt.executionBinding.resolution.id]);assert.equal(argv.includes('--soul'),false);
  fs.rmSync(f.home,{recursive:true});fs.rmSync(f.soul,{recursive:true});fs.rmSync(f.bindingFile);
  fs.symlinkSync('/usr/bin/env',join(f.dir,'bin','env'));
  const env={...process.env,OATS_DEPLOYMENT:'/poison',OATS_RESOLUTION:'poison',OATS_BINDING_FILE:'/poison',OATS_SOURCE_RECEIPT_FILE:'/poison',OATS_INVOCATION_CONTEXT_FILE:'/poison'};
  const contextFile=generic.OATS_INVOCATION_CONTEXT_FILE,context=readJSON(contextFile);save(contextFile,{...context,executionBinding:{...context.executionBinding,resolution:{schemaVersion:1,id:`sha256-${'d'.repeat(64)}`}}});
  const beforeMismatch=tree(f.bindings.stateDir),mismatch=spawnSync('/bin/sh',['-c',completionCommand(s,id,judgmentFile)],{env,encoding:'utf8'});
  assert.equal(mismatch.status,1);assert.equal(JSON.parse(mismatch.stdout).error.code,'E_INVOCATION');assert.deepEqual(tree(f.bindings.stateDir),beforeMismatch,'wrong generic source binding cannot change retained runs/receipts');save(contextFile,context);
  const result=spawnSync('/bin/sh',['-c',completionCommand(s,id,judgmentFile)],{env,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr+result.stdout);assert.equal(JSON.parse(result.stdout).result.processed,true);assert.equal(loadStatus(s).processed.length,run.inputs.length);
  assert.equal(fs.existsSync(join(f.dir,'workers')),false,'no fake legacy spawn occurred; this proves public provider completion, not a qualified kernel helper launch');
});

test('malformed captured source remote is refused by public inspect without secret echo',t=>{
  const f=fixture(t),receipt=capturedReceipt(f),s=registerCaptured(f.home,receipt),snapshot=join(f.dir,'binding-snapshot.json');save(snapshot,receipt.binding);
  const malformed=readJSON(s.file);malformed.sourceIdentity.repository.remote='git:https://user:SYNTHETIC_SECRET@example.invalid/source.git';save(s.file,malformed);
  const result=f.cli('inspect',[],{OATS_BINDING_FILE:snapshot});assert.equal(result.status,1);assert.equal(result.out.error.code,'E_SOURCE');assert.doesNotMatch(result.stdout+result.stderr,/SYNTHETIC_SECRET/);
});

test('captured owner registry accepts legal prototype-named owners and replays its own row',t=>{
  for(const owner of ['hasOwnProperty','isPrototypeOf']) {
    const f=fixture(t,{nodes:{expert:{path:'expert',owner},peer:{path:'peer',owner:'owner-2'}}}),receipt=capturedReceipt(f);
    receipt.binding.payload.owner=owner;receipt.binding.payload.owns[0].steward=owner;receipt.binding.payload.runtime.declaration.owner=owner;
    const first=registerCaptured(f.home,receipt),file=join(f.bindings.stateDir,'owners.json'),owners=readJSON(file);
    assert.equal(Object.hasOwn(owners,owner),true);assert.deepEqual(owners[owner].identity,receipt.sourceIdentity);
    assert.equal(registerCaptured(f.home,receipt).id,first.id);
    const home=join(f.context,'second-home');fs.mkdirSync(join(home,'work'),{recursive:true});
    const second=registerCaptured(home,{...receipt,home,work:join(home,'work'),instance:'source-two'});
    assert.notEqual(second.id,first.id);assert.deepEqual(readJSON(file),owners,'another incarnation with same qualified owner does not rewrite ownership');
  }
});

test('captured helper skips ownership and legacy owner evidence requires explicit migration',t=>{
  const helper=fixture(t),helperReceipt=capturedReceipt(helper,{kind:'helper'}),bindingFile=join(helper.dir,'helper-binding.json'),receiptFile=join(helper.dir,'helper-receipt.json');save(bindingFile,helperReceipt.binding);save(receiptFile,helperReceipt);
  const helperSpawn=helper.cli('spawn',[],{OATS_BINDING_FILE:bindingFile,OATS_SOURCE_RECEIPT_FILE:receiptFile,...capturedExecutionEnv(helper,helperReceipt,'spawn')});assert.equal(helperSpawn.status,0);assert.equal(helperSpawn.out.meta.memory,'none');assert.equal(fs.existsSync(join(helper.bindings.stateDir,'owners.json')),false);
  for(const changed of [
    {...helperReceipt,home:join(helper.dir,'other-home')},
    {...helperReceipt,work:'relative'},
    {...helperReceipt,context:join(helper.dir,'other-deployment')},
    {...helperReceipt,sourceIdentity:{kind:'local-soul',source:`path:${helper.soul}`,exportPath:'.'}},
    {...helperReceipt,role:'x'.repeat(128*1024+1)},
    {...helperReceipt,responsibleHuman:{provider:'fixture'}},
  ]) assert.throws(()=>registerCaptured(helper.home,changed));
  const legacy=fixture(t);fs.mkdirSync(legacy.bindings.stateDir,{recursive:true});save(join(legacy.bindings.stateDir,'owners.json'),{'owner-1':legacy.soul});
  assert.throws(()=>registerCaptured(legacy.home,capturedReceipt(legacy)),error=>error.code==='E_MIGRATION' && /owner registry evidence/.test(error.message));
  assert.equal(fs.existsSync(join(legacy.home,'.okf-source.json')),false);assert.equal(fs.existsSync(join(legacy.bindings.stateDir,'sources')),false);
});
test('captured published commands fail closed on missing source, invalid snapshot and administration',t=>{
  const f=fixture(t),receipt=capturedReceipt(f),snapshot=join(f.dir,'binding.json'),poison=join(f.dir,'poison-state'),poisonFile=join(f.dir,'poison.json'),poisonBase=join(f.dir,'redirected-base'),nodes=join(f.dir,'poison-nodes.json');save(snapshot,receipt.binding);
  save(poisonFile,{version:1,stateDir:poison,bases:{[f.base.id]:{id:f.base.id,kind:'directory',path:poisonBase}}});save(nodes,{expert:{path:'expert',owner:'owner-1'}});fs.rmSync(f.bindingFile);fs.rmSync(f.soul,{recursive:true});
  const poisonBytes=fs.readFileSync(poisonFile),env={OATS_BINDING_FILE:snapshot,OATS_SETTINGS:JSON.stringify({'bindings-file':poisonFile,'state-dir':poison})};
  for(const [command,args=[]] of [['inspect'],['read',['--base',f.base.id]],['refresh'],['harvest',['--no-launch']],['retire'],['spawn']]) {
    const result=f.cli(command,args,env);assert.equal(result.status,1,`${command}: ${result.stdout}`);
  }
  for(const [command,args] of [['setup',['--source',join(f.dir,'missing-source.json')]],['init',['--base',f.base.id,'--nodes',nodes,'--confirm']],['migrate',['--legacy',join(f.dir,'legacy'),'--base',f.base.id,'--node','expert','--output',join(f.dir,'stage')]],['unlock',['--lock',join(f.dir,'missing-lock'),'--token','no-token']]]) {
    const result=f.cli(command,args,env);assert.equal(result.status,1);assert.equal(result.out.error.code,'E_MIGRATION',command);
  }
  assert.equal(fs.existsSync(poison),false);assert.equal(fs.existsSync(poisonBase),false);assert.deepEqual(fs.readFileSync(poisonFile),poisonBytes);assert.equal(fs.existsSync(join(f.home,'.okf-source.json')),false);
  put(snapshot,'{"schemaVersion":1,"schemaVersion":1}');const invalid=f.cli('inspect',[],env);assert.equal(invalid.status,1);assert.equal(invalid.out.error.code,'E_BINDING');assert.equal(fs.existsSync(poison),false);
  save(snapshot,receipt.binding);const receiptFile=join(f.dir,'source-receipt.json');put(receiptFile,'{"schemaVersion":1,"schemaVersion":1}');
  const invalidReceipt=f.cli('spawn',[],{...env,OATS_SOURCE_RECEIPT_FILE:receiptFile});assert.equal(invalidReceipt.status,1);assert.match(invalidReceipt.out.warning,/invalid captured source receipt/);
  save(receiptFile,receipt);const wrongAction=f.cli('inspect',[],{...env,OATS_SOURCE_RECEIPT_FILE:receiptFile});assert.equal(wrongAction.status,1);assert.equal(wrongAction.out.error.code,'E_SOURCE');
  assert.equal(f.cli('soul-scaffold',[],env).status,0,'stateless scaffold guidance remains side-effect free');assert.equal(fs.existsSync(poison),false);
});
test('completion rejects invalid judgment and credential-shaped promotion output',t=>{
  const f=fixture(t);note(f);const {s,run}=prepared(f);const j=judgment(f,s,run,{secret:true});assert.throws(()=>complete(s,run.id,j),/credential-shaped/);const doc=readJSON(j);doc.outcomes=[];save(j,doc);assert.throws(()=>complete(s,run.id,j),/exactly one outcome/);assert.equal(loadStatus(s).processed.length,0);
});
test('actual complete command dispatch validates and records processed receipt',t=>{
  const f=fixture(t);note(f);const {s,run}=prepared(f);const j=judgment(f,s,run);const r=f.cli('complete',['--source',s.file,'--run',run.id,'--judgment',j]);assert.equal(r.status,0,r.stdout+r.stderr);assert.equal(r.out.schemaVersion,1);assert.equal(r.out.result.receipts.project.status,'accepted');assert.equal(loadStatus(s).processed.length,1);
});
for(const root of ['knowledge','.']) test(`actual temporary Git ${root==='.'?'dedicated':'embedded'} base delivers verified PR, not accepted head`,t=>{
  const f=fixture(t,{kind:'git',root});note(f);const {s,run}=prepared(f);const before=git(f.repo,['rev-parse','main']);const r=complete(s,run.id,judgment(f,s,run));const receipt=r.receipts.project;
  assert.equal(receipt.status,'delivered');assert.equal(receipt.pr.number,1);assert.equal(git(f.repo,['rev-parse','main']),before);assert.equal(git(f.repo,['rev-parse',receipt.branch]),receipt.commit);assert.equal(loadStatus(s).processed.length,1);assert.equal(Object.keys(loadStatus(s).accepted).length,0);
  assert.match(git(f.repo,['show',`${receipt.commit}:${root==='.'?'':root+'/'}expert/decision.md`]),/Evidence: OKF input/);
});
test('read-only Git staging never executes attribute-selected host smudge or process filters',t=>{
  const f=fixture(t,{kind:'git'});put(join(f.repo,'.gitattributes'),'knowledge/**/*.md filter=hostprobe\n');git(f.repo,['add','.gitattributes']);git(f.repo,['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','filter selector']);
  const marker=join(f.dir,'outside-stage-marker'),filter=join(f.dir,'passthrough.mjs');
  put(filter,`import fs from 'node:fs';fs.writeFileSync(${JSON.stringify(marker)},'ran');process.stdin.pipe(process.stdout);`);
  const original=tree(join(f.repo,'knowledge'));
  for(const type of ['smudge','process']) {
    // Native staging retains normal HOME configuration for authentication, but
    // repository attributes must never cause this configured executable to run.
    put(join(process.env.HOME,'.gitconfig'),`[filter "hostprobe"]\n  ${type} = ${process.execPath} ${filter}\n`);
    const staged=stageBase(f.base,join(f.dir,`filter-free-${type}`));
    assert.deepEqual(staged.files,original);assert.equal(fs.existsSync(marker),false,`${type} was not executed, not just rejected afterward`);
    assert.equal(git(staged.checkout,['rev-parse','HEAD']),staged.head);
  }
});

test('Git PR failure never falls back; retry verifies an uncertain create without duplication',t=>{
  const f=fixture(t,{kind:'git'});note(f);const {s,run}=prepared(f);put(join(f.dir,'gh-uncertain'),'1');assert.throws(()=>complete(s,run.id,judgment(f,s,run)),/failed/);assert.equal(loadStatus(s).processed.length,0);assert.equal(readRun(s,run.id).receipts.project.status,'pr-unknown');
  fs.rmSync(join(f.dir,'gh-uncertain'));const r=retry(s);assert.equal(r.receipts.project.status,'delivered');assert.equal(readJSON(join(f.dir,'pr.json')).length,1);
});
test('Git outside-base edits and tracked directory bypass are rejected',t=>{
  const f=fixture(t,{kind:'git'});note(f);const {s,run}=prepared(f);const j=judgment(f,s,run);put(join(run.stages.project.checkout,'code.txt'),'must not deliver');assert.throws(()=>complete(s,run.id,j),/outside.*knowledge/);
  const raw={version:1,stateDir:join(f.dir,'s2'),bases:{b:{kind:'directory',id:'other',path:join(f.repo,'knowledge')}}};assert.throws(()=>validateBindings(raw,f.bindingFile),/Git custody/);
});
test('Git empty input judgment has no commit, push or PR',t=>{
  const f=fixture(t,{kind:'git'});note(f);const {s,run}=prepared(f);const r=complete(s,run.id,judgment(f,s,run,{drop:true}));assert.equal(r.receipts.project.status,'no-change');assert.equal(fs.existsSync(join(f.dir,'pr.json')),false);
});
/** Commit `files` (path → text) to the accepted repository: another writer moving its head. */
function acceptedCommit(f,files) {for(const [p,text] of Object.entries(files)) put(join(f.repo,p),text);git(f.repo,['add','.']);git(f.repo,['-c','user.name=Other','-c','user.email=other@example.invalid','commit','-qm','another writer']);return git(f.repo,['rev-parse','HEAD']);}
test('4.0.6 a written Git base whose head moved outside its root is delivered onto the new head',t=>{
  const f=fixture(t,{kind:'git'});note(f);const {s,run}=prepared(f);const j=judgment(f,s,run);
  const moved=acceptedCommit(f,{'code.txt':'busy repository\n'});
  const r=complete(s,run.id,j);assert.equal(r.status,'processed');const receipt=r.receipts.project;assert.equal(receipt.status,'delivered');
  assert.equal(git(f.repo,[`rev-parse`,`${receipt.commit}^`]),moved,'the publication commit sits on the moved head');
  assert.equal(git(f.repo,['show',`${receipt.commit}:code.txt`]),'busy repository','the other writer\'s change is kept');
  assert.match(git(f.repo,['show',`${receipt.commit}:knowledge/expert/decision.md`]),/prevents hidden delivery/);
  assert.deepEqual(git(f.repo,['diff','--name-only',moved,receipt.commit]).split('\n').sort(),['knowledge/expert/decision.md','knowledge/expert/index.md','knowledge/expert/log.md']);
});
test('4.0.6 a commit made before the head moved again outside the root is delivered as it is, never rebuilt',t=>{
  const f=fixture(t,{kind:'git'});note(f);const {s,run}=prepared(f);const j=judgment(f,s,run);
  const marker=join(f.dir,'push-failed-once');
  gitWrapper(f,`if(a.includes('push') && !fs.existsSync(${JSON.stringify(marker)})) {fs.writeFileSync(${JSON.stringify(marker)},'');process.exit(1);}`);
  assert.throws(()=>complete(s,run.id,j),/git --no-replace-objects failed/);
  const committed=readRun(s,run.id).receipts.project;assert.equal(committed.status,'push-unknown');assert.equal(committed.parent,run.stages.project.head);
  fs.rmSync(join(f.dir,'bin/git'));
  acceptedCommit(f,{'code.txt':'moved again\n'});
  const r=retry(s);const receipt=r.receipts.project;assert.equal(receipt.status,'delivered');
  assert.equal(receipt.commit,committed.commit,'the same commit is pushed');assert.equal(git(f.repo,['rev-parse',`${receipt.commit}^`]),run.stages.project.head);
  assert.equal(readJSON(join(f.dir,'pr.json')).length,1);
});
test('4.0.6 a read-only Git base whose head moved outside its root is accepted and its new head recorded',t=>{
  const f=fixture(t,{kind:'git'});note(f);const {s,run}=prepared(f);const j=judgment(f,s,run,{drop:true});
  const moved=acceptedCommit(f,{'code.txt':'busy repository\n'});
  const r=complete(s,run.id,j);assert.equal(r.status,'processed');assert.equal(r.receipts.project.status,'no-change');assert.equal(r.receipts.project.confirmedHead,moved);
  assert.equal(readRun(s,run.id).stages.project.head,run.stages.project.head,'the judged head stays the record of what was staged');
});
test('4.0.6 a change inside a Git base root needs a rejudge; the judgment stays persisted',t=>{
  const f=fixture(t,{kind:'git'});note(f);const {s,run}=prepared(f);const j=judgment(f,s,run,{drop:true});
  acceptedCommit(f,{'knowledge/peer/log.md':'* another writer\n'});
  assert.throws(()=>complete(s,run.id,j),e=>e.code==='E_BASELINE');
  const after=readRun(s,run.id);assert.ok(after.judgment,'the judgment survives the failed delivery');assert.equal(loadStatus(s).processed.length,0);
  assert.equal(retry(s,{rejudge:true}).status,'abandoned');
});
test('4.0.6 a mode-only change inside a Git base root leaves its digest, so it is no baseline change',t=>{
  const f=fixture(t,{kind:'git'});note(f);const {s,run}=prepared(f);const j=judgment(f,s,run,{drop:true});
  fs.chmodSync(join(f.repo,'knowledge/peer/log.md'),0o755);git(f.repo,['add','.']);git(f.repo,['-c','user.name=Other','-c','user.email=other@example.invalid','commit','-qm','mode only']);
  const r=complete(s,run.id,j);assert.equal(r.status,'processed');assert.equal(r.receipts.project.confirmedHead,git(f.repo,['rev-parse','HEAD']));
});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const alive=pid=>{try{process.kill(pid,0);return true;}catch{return false;}};
async function until(check,ms=20000) {const end=Date.now()+ms;for(;;){const v=check();if(v)return v;if(Date.now()>end)throw new Error('condition not met in time');await pause(50);}}
test('4.0.6 complete hands a slow delivery to ONE detached worker and returns a receipt within its budget',async t=>{
  const f=fixture(t,{kind:'git'});note(f);const {s,run}=prepared(f);const j=judgment(f,s,run);put(join(f.dir,'gh-slow'),'4000');
  const started=Date.now();const first=await completeInBackground(s,run.id,j,{receiptWithinMs:300});
  assert.ok(Date.now()-started<3000,'the receipt does not wait for delivery');
  assert.equal(first.status,'delivering');assert.equal(first.processed,false);assert.ok(first.delivery.pid);assert.match(first.next,/harvest-status|complete/);
  t.after(()=>{try{process.kill(first.delivery.pid,'SIGKILL');}catch{}});
  assert.ok(readRun(s,run.id).judgment,'the judgment is persisted before delivery');
  const again=await completeInBackground(s,run.id,join(f.dir,'no-such-judgment.json'),{receiptWithinMs:100});
  assert.equal(again.status,'delivering');assert.equal(again.delivery.pid,first.delivery.pid,'a second complete never starts another worker');
  const done=await completeInBackground(s,run.id,join(f.dir,'no-such-judgment.json'),{receiptWithinMs:20000});
  assert.equal(done.status,'processed');assert.equal(done.receipts.project.status,'delivered');assert.equal(readJSON(join(f.dir,'pr.json')).length,1);
  const after=readRun(s,run.id);assert.equal(after.delivery.state,'done');assert.match(after.delivery.step,/project: delivered/);
  assert.ok(fs.existsSync(join(dirname(join(s.bindings.stateDir,'sources',s.id,'runs',run.id,'run.json')),'delivery.log')),'the worker writes to a log in the run directory');
});
test('4.0.6 the delivery worker outlives the complete call that started it',async t=>{
  const f=fixture(t,{kind:'git'});note(f);const {s,run}=prepared(f);const j=judgment(f,s,run);put(join(f.dir,'gh-slow'),'1500');
  const workerModule=new URL('../oats-package/capabilities/oats-okf/lib/worker.mjs',import.meta.url).href,sourceModule=new URL('../oats-package/capabilities/oats-okf/lib/sources.mjs',import.meta.url).href;
  const code=`import {loadSource} from ${JSON.stringify(sourceModule)};import {completeInBackground} from ${JSON.stringify(workerModule)};const r=await completeInBackground(loadSource(${JSON.stringify(s.file)}),${JSON.stringify(run.id)},${JSON.stringify(j)},{receiptWithinMs:100});process.stdout.write(JSON.stringify(r));process.exit(0);`;
  const child=spawnSync(process.execPath,['--input-type=module','-e',code],{env:process.env,encoding:'utf8'});assert.equal(child.status,0,child.stderr);
  const answer=JSON.parse(child.stdout);assert.equal(answer.status,'delivering');t.after(()=>{try{process.kill(-answer.delivery.pid,'SIGKILL');}catch{}});
  await until(()=>readRun(s,run.id).delivery?.state==='done');
  assert.equal(readRun(s,run.id).receipts.project.status,'delivered');assert.equal(readJSON(join(f.dir,'pr.json')).length,1);
});
test('4.0.6 a complete killed after persisting its judgment leaves a resumable run and a reclaimable lock',async t=>{
  const f=fixture(t,{kind:'git'});note(f);const {s,run}=prepared(f);const j=judgment(f,s,run);
  const workerModule=new URL('../oats-package/capabilities/oats-okf/lib/worker.mjs',import.meta.url).href,sourceModule=new URL('../oats-package/capabilities/oats-okf/lib/sources.mjs',import.meta.url).href;
  const code=`import {loadSource} from ${JSON.stringify(sourceModule)};import {completeInBackground} from ${JSON.stringify(workerModule)};await completeInBackground(loadSource(${JSON.stringify(s.file)}),${JSON.stringify(run.id)},${JSON.stringify(j)},{afterJudgment:()=>process.kill(process.pid,'SIGKILL')});`;
  const child=spawnSync(process.execPath,['--input-type=module','-e',code],{env:process.env,encoding:'utf8'});assert.equal(child.signal,'SIGKILL',child.stderr);
  const lock=join(dirname(s.file),'worker.lock');assert.ok(fs.existsSync(lock),'the killed holder left its lock');
  const judged=readRun(s,run.id);assert.ok(judged.judgment,'the judgment was persisted');assert.deepEqual(judged.receipts,{});
  fs.rmSync(j);
  const r=await completeInBackground(s,run.id,j,{receiptWithinMs:20000});
  assert.equal(r.status,'processed','the rerun reclaims the dead lock and resumes without the judgment file');assert.equal(readJSON(join(f.dir,'pr.json')).length,1);
});
test('4.0.6 a delivery worker killed mid-publish is resumed without a duplicate push or PR',async t=>{
  const f=fixture(t,{kind:'git'});note(f);const {s,run}=prepared(f);const j=judgment(f,s,run);put(join(f.dir,'gh-slow'),'30000');
  const first=await completeInBackground(s,run.id,j,{receiptWithinMs:100});
  const pid=first.delivery.pid;t.after(()=>{try{process.kill(-pid,'SIGKILL');}catch{}});
  await until(()=>readRun(s,run.id).receipts.project?.status==='pr-intent');
  const pushed=readRun(s,run.id).receipts.project.commit;
  process.kill(-pid,'SIGKILL');await until(()=>!alive(pid));fs.rmSync(join(f.dir,'gh-slow')); // the worker leads its own process group, gh included
  const stalled=await completeInBackground(s,run.id,j,{receiptWithinMs:20000});
  assert.equal(stalled.status,'processed');assert.notEqual(stalled.delivery?.pid,pid);
  assert.equal(stalled.receipts.project.commit,pushed,'the pushed commit is reused, never rebuilt or force-pushed');
  assert.equal(readJSON(join(f.dir,'pr.json')).length,1);
});
test('4.0.6 retry reports a live delivery and refuses to rejudge under it',async t=>{
  const f=fixture(t,{kind:'git'});note(f);const {s,run}=prepared(f);const j=judgment(f,s,run);put(join(f.dir,'gh-slow'),'4000');
  const first=await completeInBackground(s,run.id,j,{receiptWithinMs:100});t.after(()=>{try{process.kill(-first.delivery.pid,'SIGKILL');}catch{}});
  const r=retry(s);assert.equal(r.status,'delivering');assert.equal(r.delivery.pid,first.delivery.pid);
  assert.throws(()=>retry(s,{rejudge:true}),e=>e.code==='E_RECOVERY' && /in progress/.test(e.message));
  await until(()=>readRun(s,run.id).delivery?.state==='done');
});
test('4.0.6 a delivery that fails before it starts records why',t=>{
  const f=fixture(t,{kind:'git'});note(f);const {s,run}=prepared(f);const j=judgment(f,s,run);put(join(f.dir,'gh-fail'),'1');
  assert.throws(()=>complete(s,run.id,j));
  const status=loadStatus(s);status.recoveries={[run.id]:'99999999-9999-4999-8999-999999999999'};saveStatus(s,status);
  assert.throws(()=>deliver(s,run.id),e=>e.code==='E_RECOVERY');
  const recorded=readRun(s,run.id).delivery;assert.equal(recorded.state,'failed');assert.equal(recorded.error.code,'E_RECOVERY');assert.equal(recorded.pid,process.pid);
});
test('4.0.6 the complete command answers with a receipt and delivers in the background',t=>{
  const f=fixture(t,{kind:'git'});note(f);const {s,run}=prepared(f);const j=judgment(f,s,run);
  const r=f.cli('complete',['--source',s.file,'--run',run.id,'--judgment',j]);assert.equal(r.status,0,r.stdout+r.stderr);
  assert.equal(r.out.result.status,'processed');assert.equal(r.out.result.receipts.project.status,'delivered');assert.equal(readRun(s,run.id).delivery.state,'done');
});
test('4.0.6 delivery from a partial stage fetches no blob outside the root',t=>{
  const f=fixture(t,{kind:'git'});git(f.repo,['config','uploadpack.allowFilter','true']);
  note(f);const {s,run}=prepared(f);const j=judgment(f,s,run);
  const checkout=run.stages.project.checkout,outside=git(f.repo,['rev-parse','HEAD:code.txt']);
  assert.equal(git(checkout,['config','--get','remote.origin.promisor']),'true','a real partial stage');
  const absent=()=>spawnSync('git',['-C',checkout,'cat-file','-e',outside],{env:{...process.env,GIT_NO_LAZY_FETCH:'1'}}).status!==0;
  assert.ok(absent(),'staging fetched no blob outside the root');
  const r=complete(s,run.id,j);assert.equal(r.receipts.project.status,'delivered');
  assert.ok(absent(),'delivery fetched no blob outside the root');
  assert.equal(git(f.repo,['show',`${r.receipts.project.commit}:code.txt`]),'code baseline','the outside entry is the accepted one');
});
test('migration preserves originals, rewrites root links, delivers directory and explicitly cuts over',t=>{
  const f=fixture(t);const legacy=join(f.soul,'knowledge');put(join(legacy,'index.md'),'---\nokf_version: "0.1"\n---\n\n# Old\n* [Rationale](/rationale.md) - Why.\n');put(join(legacy,'rationale.md'),'---\ntype: Decision\ntitle: Rationale\ndescription: Why.\n---\n\nPreserved human rationale.\n');put(join(legacy,'log.md'),'# History\n');const original=tree(legacy);
  const m=migrate(f.bindings,{legacy,alias:'project',node:'expert',output:join(f.dir,'migration-stage')});assert.deepEqual(tree(legacy),original);assert.match(fs.readFileSync(join(m.stage,'expert/index.md'),'utf8'),/\/expert\/rationale/);
  assert.equal(deliverMigration(m.migration).status,'accepted');const r=cutoverMigration(m.migration,f.soul);assert.equal(r.status,'complete');assert.deepEqual(tree(r.backup),original);assert.equal(fs.existsSync(legacy),false);assert.equal(readJSON(join(f.soul,'okf.json')).owner,'owner-1');
});
test('generated shell commands quote executable, cwd, descriptors and apostrophes safely',t=>{
  const f=fixture(t);const payload="x'; touch /tmp/okf-never-create; echo '";const text=command(f.context,['okf','complete','--source',payload]);assert.ok(text.includes(quote(process.env.OATS_CLI_BIN)));assert.ok(text.includes(quote(payload)));
  const script=`printf '%s\\n' ${quote(payload)}`;const r=execFileSync('/bin/sh',['-c',script],{encoding:'utf8'}).trim();assert.equal(r,payload);
});

// These names are the strengthened mutation harness's contract. Execute the
// actual manifest fixed argv and operation routing, never a hardcoded event.
const manifest=readJSON(join(CAP,'oats.json'));
function declaredRun(f,name,args=[],operation=false) {
  if(operation) {assert.ok(manifest.operations?.[name],`missing operation ${name}`);name=manifest.operations[name].command;}
  assert.ok(Object.hasOwn(manifest.commands,name),`missing command ${name}`);
  const [entry,...fixed]=manifest.commands[name].trim().split(/\s+/);
  const r=spawnSync(process.execPath,[join(CAP,entry),...fixed,...args,'--json'],{cwd:f.home,env:process.env,encoding:'utf8',timeout:10000,maxBuffer:16*1024*1024});
  assert.equal(r.status,0,r.stdout+r.stderr);return JSON.parse(r.stdout);
}
test('baseline exports the readable okf-consultation and okf-instance-knowledge skill closure',()=>{
  const hasDoc=p=>{try{return fs.statSync(join(p,'SKILL.md')).isFile();}catch{return false;}};
  const skills=new Map();
  for(const declared of manifest.skills || []) {
    const dir=join(CAP,declared);assert.ok(fs.statSync(dir).isDirectory());
    const entries=hasDoc(dir)?[{name:dir.split('/').at(-1),dir}]:fs.readdirSync(dir,{withFileTypes:true}).filter(e=>e.isDirectory() && hasDoc(join(dir,e.name))).map(e=>({name:e.name,dir:join(dir,e.name)}));
    for(const e of entries) skills.set(e.name,fs.readFileSync(join(e.dir,'SKILL.md'),'utf8'));
  }
  for(const name of ['okf-consultation','okf-instance-knowledge']) {assert.ok(skills.has(name),`missing required baseline skill ${name}`);assert.match(skills.get(name),new RegExp(`^name: ${name}$`,'m'));}
  for(const name of ['okf','memory-harvest','knowledge-theory','okf-authoring']) assert.equal(skills.has(name),false,`oats.okf ships no harvest doctrine (${name})`);
  assert.ok(fs.statSync(join(CAP,'lib/okf-validate.mjs')).isFile());
});
test('baseline harvest operation dispatches its declared command without a hook event',t=>{
  const f=fixture(t);f.source();note(f);const r=declaredRun(f,'harvest',['--no-launch'],true);assert.equal(r.schemaVersion,1);assert.equal(r.ok,true);assert.equal(r.result.status,'started');assert.equal(r.result.launched,false);assert.match(r.result.instance,/^okf-harvester-[0-9a-f-]{36}$/);assert.ok(r.result.instance.length<=64);
});
for(const operation of [false,true]) test(`baseline inspect ${operation?'operation':'command'} returns provider receipts through declared dispatch`,t=>{
  const f=fixture(t);const s=f.source();const status=loadStatus(s);status.diagnostic='large α receipt\n'.repeat(10000);saveStatus(s,status);
  const state='# State\n'+'Large live α state\n'.repeat(10000),log='# Log\n'+'Observed β limitation\n'.repeat(9000);
  put(join(f.home,'STATE.md'),state);put(join(f.home,'log.md'),log);put(join(f.home,'notes/b.md'),'second note\n');put(join(f.home,'notes/a.md'),'first note\n');put(join(f.home,'notes/nested/c.md'),'nested note\n');put(join(f.home,'notes/skip.txt'),'not Markdown');
  const before=fs.readFileSync(join(dirname(s.file),'status.json'),'utf8');
  const r=declaredRun(f,'inspect',[],operation);assert.equal(r.schemaVersion,1);assert.equal(r.ok,true);assert.equal(r.result.source,s.file);assert.equal(r.result.status.diagnostic,status.diagnostic);
  assert.deepEqual(r.result.documents.map(d=>[d.label,d.kind,d.path]),[
    ['Working state (STATE.md)','markdown',join(f.home,'STATE.md')],['Log (log.md)','markdown',join(f.home,'log.md')],
    ...['a.md','b.md','nested/c.md'].map(n=>[`Pending note: ${n}`,'markdown',join(f.home,'notes',n)]),
    ['Durable processing receipts','text',join(dirname(s.file),'status.json')]
  ]);
  assert.deepEqual(r.result.documents.slice(0,5).map(d=>d.text),[state,log,'first note\n','second note\n','nested note\n']);
  assert.equal(r.result.documents[0].truncated,undefined);assert.equal(r.result.liveMemory.available,true);
  assert.deepEqual(r.result.acceptedView,s.acceptedView);assert.deepEqual(r.result.bases,s.bindings.bases);
  assert.equal(fs.readFileSync(join(dirname(s.file),'status.json'),'utf8'),before,'inspection never changes receipts');
});

test('capture interleaved with directory completion preserves both cursors',t=>{
  const f=fixture(t);note(f);const {s,run}=prepared(f);const j=judgment(f,s,run);let captured=false;
  complete(s,run.id,j,{afterWrite:()=>{if(captured)return;captured=true;note(f,'new.md','A separate new limitation while delivery runs.');capture(s);}});
  assert.equal(loadStatus(s).captured.inputs.length,2);assert.equal(loadStatus(s).processed.length,1);
});
test('directory accepted receipt with uncleared publication journal recovers after receipt-write crash',t=>{
  const f=fixture(t);note(f);const {s,run}=prepared(f);const j=judgment(f,s,run);
  assert.throws(()=>complete(s,run.id,j,{afterWrite:()=>{throw new Error('interrupt');}}),/interrupt/);
  const current=readRun(s,run.id),r=current.receipts.project,p=readJSON(r.proposal);
  assert.throws(()=>directoryPublish(f.base,p,r,()=>{save(join(dirname(s.file),'runs',run.id,'run.json'),current);if(r.status==='accepted')throw new Error('receipt persisted, cleanup interrupted');}),/cleanup interrupted/);
  assert.equal(readRun(s,run.id).receipts.project.status,'accepted');assert.equal(fs.existsSync(journalPath(f.base)),true);
  assert.equal(retry(s).processed,true);assert.equal(fs.existsSync(journalPath(f.base)),false);
});
test('failed Git publication survives worker deletion, then merge-visible acceptance is distinct',t=>{
  const f=fixture(t,{kind:'git'});note(f);const {s,run}=prepared(f);const j=judgment(f,s,run);put(join(f.dir,'gh-fail'),'1');assert.throws(()=>complete(s,run.id,j),/failed/);
  fs.rmSync(run.worker.home,{recursive:true});fs.rmSync(join(f.dir,'gh-fail'));
  const published=retry(s);const r=published.receipts.project;assert.equal(r.status,'delivered');
  // Simulate native GitHub merge with actual Git history and deterministic gh.
  git(f.repo,['merge','--ff-only',r.branch]);const pr=readJSON(join(f.dir,'pr.json'));pr[0].state='MERGED';pr[0].mergedAt='2026-09-13T12:00:00Z';pr[0].mergeCommit={oid:r.commit};save(join(f.dir,'pr.json'),pr);
  const accepted=complete(s,run.id);assert.equal(accepted.receipts.project.status,'accepted');assert.equal(loadStatus(s).accepted[`${run.id}/project`].acceptedCommit,r.commit);
});
/** A delivered Git run whose PR the maintainer amended (a commit on the PR branch) and squash-merged. */
function amendedAndMerged(t,{verdict='amend+merge',headSha,association='OWNER',author='host',mergedBy='maintainer',comment=true,crlf=false,uncertain=false}={}) {
  const f=fixture(t,{kind:'git'});note(f);const {s,run}=prepared(f);const j=judgment(f,s,run);
  // uncertain: gh created the PR but failed, so the receipt has no PR identity.
  if(uncertain) {put(join(f.dir,'gh-uncertain'),'1');assert.throws(()=>complete(s,run.id,j));fs.rmSync(join(f.dir,'gh-uncertain'));}
  else complete(s,run.id,j);
  const r=readRun(s,run.id).receipts.project;assert.equal(r.status,uncertain?'pr-unknown':'delivered');
  const cid=['-c','user.name=Maintainer','-c','user.email=maintainer@example.invalid'];
  git(f.repo,['checkout','-q',r.branch]);fs.appendFileSync(join(f.repo,'knowledge/expert/decision.md'),'Superseded wording, amended in review.\n');
  git(f.repo,['add','.']);git(f.repo,[...cid,'commit','-qm','okf-review amendment']);const amended=git(f.repo,['rev-parse','HEAD']);
  git(f.repo,['checkout','-q','main']);git(f.repo,['merge','--squash','-q',r.branch]);git(f.repo,[...cid,'commit','-qm','squash merge']);const merge=git(f.repo,['rev-parse','HEAD']);
  const pr=readJSON(join(f.dir,'pr.json'));
  const block=JSON.stringify({verdict,pr:pr[0].url,headSha:headSha ?? amended,checks:{},amendments:['expert/decision.md: wording'],reason:'fixable'});
  Object.assign(pr[0],{state:'MERGED',mergedAt:'2026-10-01T12:00:00Z',mergeCommit:{oid:merge},headRefOid:amended,mergedBy:typeof mergedBy==='string'?{login:mergedBy}:mergedBy,
    comments:comment?[{author:{login:author},authorAssociation:association,body:`<!-- okf-review -->\n\`\`\`okf-review\n${block}\n\`\`\`\nProse.`.replaceAll('\n',crlf?'\r\n':'\n')}]:[]});
  save(join(f.dir,'pr.json'),pr);
  return {f,s,run,r,amended,merge};
}
test('4.0.7 an amend+merge verdict at the merged head records acceptance with the merge commit, never E_BASELINE',t=>{
  const {f,s,run,r,amended,merge}=amendedAndMerged(t);
  const done=complete(s,run.id);const receipt=done.receipts.project;
  assert.equal(receipt.status,'accepted');assert.equal(receipt.mergeCommit,merge);assert.equal(receipt.mergedHead,amended);assert.equal(receipt.commit,r.commit,'the delivered commit stays on the receipt');
  assert.equal(receipt.verdict,'amend+merge');assert.equal(done.status,'processed');assert.equal(loadStatus(s).accepted[`${run.id}/project`].mergeCommit,merge);
  assert.equal(complete(s,run.id).receipts.project.status,'accepted','a repeat is a no-op');
});
test('4.0.7 a merge verdict at the merged head is accepted too',t=>{
  const {s,run}=amendedAndMerged(t,{verdict:'merge'});assert.equal(complete(s,run.id).receipts.project.status,'accepted');
});
test('4.0.7 a verdict from the account that merged is accepted even with no member association (a GitHub App token)',t=>{
  // gh's shapes for an App: mergedBy is app/<name>, a comment author is <name>.
  const {s,run}=amendedAndMerged(t,{association:'NONE',author:'okf-maintainer',mergedBy:{is_bot:true,login:'app/okf-maintainer'}});
  assert.equal(complete(s,run.id).receipts.project.status,'accepted');
});
test('4.0.7 a verdict written in GitHub\'s web UI (CRLF line endings) is read',t=>{
  const {s,run}=amendedAndMerged(t,{crlf:true});assert.equal(complete(s,run.id).receipts.project.status,'accepted');
});
test('4.0.7 an amended merge of a PR whose creation was uncertain is settled by its merge too',t=>{
  const {s,run,amended,merge}=amendedAndMerged(t,{uncertain:true});const receipt=complete(s,run.id).receipts.project;
  assert.equal(receipt.status,'accepted');assert.equal(receipt.mergeCommit,merge);assert.equal(receipt.mergedHead,amended);
});
test('4.0.7 a merged PR whose head is not the delivered commit needs a member\'s merge verdict naming that head; never E_BASELINE or a rejudge',t=>{
  for(const [why,opts] of [['no verdict',{comment:false}],['a verdict for another head',{headSha:'f'.repeat(40)}],['a close verdict',{verdict:'close'}],['a verdict by a non-member who did not merge',{association:'NONE',author:'drive-by',mergedBy:'maintainer'}],['a non-member App verdict when another App merged',{association:'NONE',author:'drive-by',mergedBy:{is_bot:true,login:'app/okf-maintainer'}}]]) {
    const {s,run}=amendedAndMerged(t,opts);
    assert.throws(()=>complete(s,run.id),e=>e.code==='E_PR' && /merged at head/.test(e.message) && /okf-review/.test(e.message),why);
    assert.equal(readRun(s,run.id).receipts.project.status,'delivered',why);
    assert.throws(()=>retry(s,{run:run.id,rejudge:true}),e=>e.code==='E_RECOVERY' && /merged at an amended head .*run complete/.test(e.message),why);
  }
});
test('existing, overlapping and hidden directory stages cannot bypass publication',t=>{
  const f=fixture(t);assert.throws(()=>stageBase(f.base,f.base.path),/exists/);assert.throws(()=>stageBase(f.base,join(f.base.path,'nested')),/overlaps/);
  put(join(f.base.path,'expert','.hidden.md'),'invalid unvalidated bytes');assert.throws(()=>f.source(),/hidden knowledge/);
});
test('frozen accepted ownership/path cannot silently retarget a queued node',t=>{
  const f=fixture(t);const s=f.source();note(f);capture(s,{final:true});const meta=readJSON(join(f.base.path,'okf-base.json'));meta.nodes.expert.owner='replacement-owner';save(join(f.base.path,'okf-base.json'),meta);
  assert.throws(()=>runSource(s,{manual:true,noLaunch:true}),/ownership\/path changed/);assert.equal(loadStatus(s).processed.length,0);
});
test('absolute CLI boundary is required and unknown commands fail in one envelope',t=>{
  const f=fixture(t);const r=f.cli('unknown');assert.equal(r.status,1);assert.equal(r.out.error.code,'E_USAGE');const s=f.source();note(f);process.env.OATS_CLI_BIN='oats';assert.throws(()=>capture(s),/absolute OATS_CLI_BIN/);assert.equal(loadStatus(s).retired,false);
});
test('whole-base validation and exclusion guards include read nodes and navigation',t=>{
  const f=fixture(t);note(f);const {s,run}=prepared(f);const j=judgment(f,s,run);
  fs.appendFileSync(join(run.stages.project.root,'expert','log.md'),'ghp_abcdefghijklmnopqrstuvwxyz0123456789\n');assert.throws(()=>complete(s,run.id,j),/credential-shaped/);
  put(join(run.stages.project.root,'expert','log.md'),'# expert log\n');put(join(run.stages.project.root,'peer','bad.md'),'missing frontmatter');assert.throws(()=>complete(s,run.id,j),/frontmatter/);
});
test('real process death mid-publication retains locks/journal until explicit dead-owner recovery',t=>{
  const f=fixture(t);note(f);const {s,run}=prepared(f);const j=judgment(f,s,run);
  const sourceModule=new URL('../oats-package/capabilities/oats-okf/lib/sources.mjs',import.meta.url).href;
  const workerModule=new URL('../oats-package/capabilities/oats-okf/lib/worker.mjs',import.meta.url).href;
  const code=`import {loadSource} from ${JSON.stringify(sourceModule)};import {complete} from ${JSON.stringify(workerModule)};complete(loadSource(${JSON.stringify(s.file)}),${JSON.stringify(run.id)},${JSON.stringify(j)},{afterWrite:()=>process.exit(55)});`;
  const child=spawnSync(process.execPath,['--input-type=module','-e',code],{env:process.env,encoding:'utf8'});assert.equal(child.status,55,child.stderr);
  assert.equal(fs.existsSync(journalPath(f.base)),true);
  for(const lock of [baseLock(f.base),join(dirname(s.file),'worker.lock')]) {
    const token=readJSON(join(lock,'owner.json')).token;const r=f.cli('unlock',['--lock',lock,'--token',token]);assert.equal(r.status,0,r.stdout);
  }
  assert.equal(retry(s).processed,true);assert.equal(fs.existsSync(journalPath(f.base)),false);
});
test('unexpected source deletion cannot strand enqueued evidence or certify missing final input',t=>{
  const f=fixture(t);note(f);const s=f.source();capture(s);fs.rmSync(f.home,{recursive:true});
  const r=runSource(s,{manual:true,noLaunch:true});const run=readRun(s,r.run);assert.equal(complete(s,run.id,judgment(f,s,run)).processed,true);
  assert.equal(loadStatus(s).finalCaptureUncertified,true);assert.equal(runSource(s,{manual:true,noLaunch:true}).status,'source-unavailable');
});
test('legacy source cursor preservation is explicit, byte exact and not processed proof',t=>{
  const f=fixture(t);note(f);put(join(f.home,'.okf-harvest-record.json'),'{"threads":{"old":{"untilTurnId":"old-1"}}}\n');assert.throws(()=>f.source(),/legacy source watermarks/);
  const migrated=f.cli('migrate',['--source-home',f.home]);assert.equal(migrated.status,0,migrated.stdout);assert.equal(migrated.out.result.status,'preserved');
  const backup=readJSON(migrated.out.result.backup);assert.equal(Buffer.from(backup.files['.okf-harvest-record.json'],'base64').toString(),fs.readFileSync(join(f.home,'.okf-harvest-record.json'),'utf8'));
  const s=f.source();capture(s);assert.deepEqual(loadStatus(s).processed,[]);assert.equal(loadStatus(s).captured.inputs.length,1);
});
test('typos in mutation flags fail before any worker or scheduler side effect',t=>{
  const f=fixture(t);const r=f.cli('harvest',['--no-lauch','yes']);assert.equal(r.status,1);assert.equal(r.out.error.code,'E_USAGE');assert.equal(fs.existsSync(f.calls),false);
});
test('multi-base partial delivery keeps per-destination receipts and processes input only after both confirm',t=>{
  const f=fixture(t);const raw=readJSON(f.bindingFile);raw.bases.secondary={id:'base-2',kind:'directory',path:'second-base'};save(f.bindingFile,raw);
  const bindings=loadBindings();initBase(bindings,'secondary',join(f.dir,'nodes.json'),undefined,{confirm:true});const decl=readJSON(join(f.soul,'okf.json'));decl.owns.push('secondary/expert');save(join(f.soul,'okf.json'),decl);
  note(f);const {s,run}=prepared(f);const file=judgment(f,s,run);const first=readJSON(file);judgment(f,s,run,{base:'secondary'});const second=readJSON(file);first.outcomes[0].concepts.push(...second.outcomes[0].concepts);save(file,first);
  let writes=0;assert.throws(()=>complete(s,run.id,file,{afterWrite:()=>{if(++writes===4)throw new Error('second base interrupted');}}),/second base interrupted/);
  const pending=readRun(s,run.id);assert.equal(pending.receipts.project.status,'accepted');assert.equal(pending.receipts.secondary.status,'publishing');assert.equal(loadStatus(s).processed.length,0);
  const result=retry(s);assert.equal(result.receipts.secondary.status,'accepted');assert.equal(loadStatus(s).processed.length,1);
});

// R1 lifecycle regressions. Only fixture scaffolds / recording backends run.
const nativeCLI=process.env.OATS_OKF_NATIVE_CLI || process.env.OATS_OKF_CONSUMER_CLI;
const callsOf=f=>fs.readFileSync(f.calls,'utf8').trim().split('\n').map(JSON.parse);
function records(f,count=60,size=350000) {
  const turns=Array.from({length:count},(_,i)=>({id:`turn-${i}`,thread:'thread-large',kind:'session',ts:'2026-09-13',source:'cc',text:[{role:'assistant',text:`${i}:`+'x'.repeat(size)}]}));
  save(join(f.dir,'turns.json'),turns);save(join(f.dir,'capture.json'),{status:'complete',complete:true,sessions:[{thread:'thread-large',lastTurnId:turns.at(-1).id}],ignored:0});return turns;
}
function capturedTurns(s) {return loadStatus(s).captured.inputs.map(id=>input(s,id)).filter(v=>v.kind==='record').flatMap(v=>v.turns);}

test('R1 large legal records plan ids-only windows before text and persist every turn',t=>{
  const f=fixture(t),s=f.source(),turns=records(f);
  assert.equal(capture(s,{final:true}).complete,true);
  assert.deepEqual(capturedTurns(s),turns);assert.equal(loadStatus(s).retired,true);
  const recall=callsOf(f).filter(c=>c.a[0]==='recall');assert.ok(recall[0].a.includes('--ids-only'));
  const text=recall.filter(c=>!c.a.includes('--ids-only'));assert.equal(text.length,60);
  assert.ok(text.every(c=>c.a[c.a.indexOf('--limit')+1]==='1'));
  assert.equal(loadStatus(s).captured.inputs.length,60);assert.deepEqual(loadStatus(s).processed,[]);
  for(const id of loadStatus(s).captured.inputs) assert.ok(Buffer.byteLength(JSON.stringify(input(s,id)))<1024*1024);
});
test('R1 interrupted large backlog retries from durable cursor without losing receipts or duplicating inputs',t=>{
  const f=fixture(t),s=f.source(),turns=records(f,6);
  const before=loadStatus(s);before.delivered.prior={status:'delivered'};before.accepted.prior={status:'accepted'};saveStatus(s,before);
  put(join(f.dir,'recall-fail'),'turn-3');assert.throws(()=>capture(s,{final:true}),/failed/);
  assert.equal(loadStatus(s).captured.threads['thread-large'],'turn-2');assert.equal(loadStatus(s).retired,false);assert.equal(capturedTurns(s).length,3);
  fs.rmSync(join(f.dir,'recall-fail'));assert.equal(capture(s,{final:true}).complete,true);assert.deepEqual(capturedTurns(s),turns);
  const after=loadStatus(s);assert.equal(after.captured.inputs.length,6);assert.deepEqual(after.delivered,before.delivered);assert.deepEqual(after.accepted,before.accepted);assert.deepEqual(after.processed,[]);
});
test('R1 individually oversize records fail closed after making durable progress on legal prefix',t=>{
  const f=fixture(t),s=f.source(),turns=records(f,2);turns[1].text[0].text='x'.repeat(1024*1024);save(join(f.dir,'turns.json'),turns);
  assert.throws(()=>capture(s,{final:true}),/exceeds 1MiB/);assert.equal(capturedTurns(s).length,1);assert.equal(loadStatus(s).retired,false);assert.equal(loadStatus(s).captured.threads['thread-large'],'turn-0');
  assert.equal(fs.existsSync(f.home),true);assert.deepEqual(loadStatus(s).processed,[]);
});
test('R1 near-limit legal compact input is not rejected merely for pretty-print overhead',t=>{
  const f=fixture(t),s=f.source(),turns=records(f,1,1024*1024-500);
  assert.equal(capture(s,{final:true}).complete,true);assert.deepEqual(capturedTurns(s),turns);
});

test('4.2.0 registration, replayed spawn, checkpoint, retire and removed setup flags never add, show or change a job',t=>{
  const f=fixture(t),s=f.source();note(f);capture(s);
  const before=loadStatus(s);assert.equal(f.source().id,s.id);assert.equal(loadStatus(s).schedule,undefined);
  for(const flags of [['--source',s.file],['--source',s.file,'--enable'],['--source',s.file,'--disable'],['--install-host']]) {
    const r=f.cli('setup',flags);assert.equal(r.status,1);assert.equal(r.out.error.code,'E_REMOVED');assert.match(r.out.error.message,/checkpoints[\s\S]*setup --harvest on\|off[\s\S]*setup --remove-schedules/);
  }
  assert.equal(f.cli('spawn').status,0);assert.equal(f.cli('harvest',['--no-launch']).status,0);assert.equal(f.cli('retire').status,0);
  assert.deepEqual(loadStatus(s).captured.inputs,before.captured.inputs);
  assert.equal(callsOf(f).some(c=>c.a[0]==='schedule'),false,'no scheduler call at all');assert.equal(fs.existsSync(join(f.dir,'schedules.json')),false);
});
test('2.1.3 a soul without okf.json refuses the spawn hook with E_CONFIG naming the remedy, never a raw ENOENT',t=>{
  const f=fixture(t);fs.rmSync(join(f.soul,'okf.json'));
  const r=f.cli('spawn');assert.equal(r.status,1,r.stdout+r.stderr);
  // Hook failures travel as {meta, warning}: the kernel quotes `warning` in its E_SPAWN_FAILED message.
  assert.ok(r.out,`no JSON: ${r.stdout}\n${r.stderr}`);assert.match(r.out.warning,/no okf.json/);assert.match(r.out.warning,/oats okf init/);assert.match(r.out.warning,/nothing was created/);
  assert.doesNotMatch(r.stdout+r.stderr,/ENOENT/);assert.equal(fs.existsSync(join(f.soul,'okf.json')),false,'no knowledge is created implicitly');
  assert.ok(!fs.existsSync(join(f.home,'.okf-source.json')),'no source registered');
});
// okf 4.2.0: the okf <= 4.1 schedule lifecycle tests (2.1.4 retire-time job
// removal, R1 registration scheduling failure and collision) are replaced by
// the explicit `setup --remove-schedules` migration tests below.
test('R1 harvest after legacy source migration registers one durable source (no job) that survives retirement',t=>{
  const f=fixture(t);note(f);put(join(f.home,'.okf-harvest-record.json'),'{}\n');assert.equal(f.cli('migrate',['--source-home',f.home]).status,0);
  const h=f.cli('harvest',['--no-launch']);assert.equal(h.status,0,h.stdout);assert.equal(h.out.result.status,'started');
  const marker=readJSON(join(f.home,'.okf-source.json')),s=loadSource(marker.source);assert.equal(loadStatus(s).schedule,undefined);
  const r=f.cli('retire');assert.equal(r.status,0,r.stdout);assert.equal(r.out.meta.drain.status,'already-running');fs.rmSync(f.home,{recursive:true});
  assert.equal(fs.existsSync(join(f.dir,'schedules.json')),false);
  assert.equal(loadStatus(s).captured.inputs.length,1);assert.equal(loadStatus(s).processed.length,0);assert.ok(callsOf(f).every(c=>c.a[0]!=='schedule'));
});

function aliasedFixture(t,alias) {
  const f=fixture(t),raw=readJSON(f.bindingFile);
  raw.bases={[alias]:raw.bases.project};save(f.bindingFile,raw);
  save(join(f.soul,'okf.json'),{version:1,owner:'owner-1',owns:[`${alias}/expert`],reads:[]});
  return f;
}
/** okf 3.0.0: an instance home holds no base copy at all. */
function assertNoLocalCopy(home) {
  assert.equal(fs.existsSync(join(home,'knowledge')),false,'no ./knowledge/ snapshot');
  assert.deepEqual(fs.readdirSync(home).filter(p=>p.startsWith('.okf-view-') || p.startsWith('knowledge-view-')),[],'no view directories');
}
for(const alias of ['input.json','view.json','staging.json','judgment.json','bases']) test(`R1 alias ${alias} uses isolated base namespace through delivery and consult reads`,t=>{
  const f=aliasedFixture(t,alias);
  note(f);const {s,run}=prepared(f);assert.equal(run.stages[alias].root,join(run.worker.home,'work','bases',alias));
  assertNoLocalCopy(f.home);assert.ok(s.acceptedView[alias].digest);assert.deepEqual(Object.keys(s.acceptedNodes[alias]).sort(),['expert','peer']);
  const spawn=f.cli('spawn');assert.equal(spawn.status,0,spawn.stdout);assert.match(spawn.out.brief,/oats okf index/);assert.match(spawn.out.brief,new RegExp(`owns: ${alias.replace('.','\\.')}/expert`));
  assert.equal(readJSON(join(run.worker.home,'work','input.json')).source.id,s.id);assert.ok(readJSON(join(run.worker.home,'work','staging.json'))[alias]);
  const r=complete(s,run.id,judgment(f,s,run,{base:alias}));assert.equal(r.receipts[alias].status,'accepted');assert.equal(loadStatus(s).processed.length,1);
  assert.match(readAccepted(s,'/expert/decision.md',alias).text,/Explicit custody/);
  const refresh=f.cli('refresh');assert.equal(refresh.status,1);assert.equal(refresh.out.error.code,'E_REMOVED');
  const read=f.cli('cat',['--base',alias,'expert/decision.md']);assert.equal(read.status,0,read.stdout);
  assert.equal(read.out.result.receipt.base,alias);assert.equal(read.out.result.path,'expert/decision.md');assert.match(read.out.result.text,/Explicit custody/);
  assertNoLocalCopy(f.home);
  assert.equal(f.cli('cat',['--base',alias,'../../view.json']).out.error.code,'E_PATH');
  assert.equal(f.cli('read',['--base',alias,'--path','expert/decision.md']).out.error.code,'E_REMOVED');
});
// Fail real filesystem renames in-process, then restore the built-in export.
// No test-only fault controls are added to the shipped implementation.
function renameFailure(predicate,fn) {
  const original=fs.default.renameSync;
  fs.default.renameSync=(from,to)=>{if(predicate(from,to)) throw Object.assign(new Error('injected view I/O failure'),{code:'EIO'});return original(from,to);};
  syncBuiltinESMExports();
  try {return fn();} finally {fs.default.renameSync=original;syncBuiltinESMExports();}
}
for(const alias of ['input.json','view.json','staging.json']) {
  test(`base alias ${alias}: an invalid second base fails registration cleanly, then retry`,t=>{
    const f=aliasedFixture(t,alias),raw=readJSON(f.bindingFile);
    raw.bases.secondary={id:'base-2',kind:'directory',path:'second-base'};save(f.bindingFile,raw);
    const bindings=loadBindings();initBase(bindings,'secondary',join(f.dir,'nodes.json'),undefined,{confirm:true});
    const index=join(bindings.bases.secondary.path,'index.md'),bytes=fs.readFileSync(index);
    fs.rmSync(index); // The first base resolves before second-base validation fails.
    const failed=f.cli('spawn');assert.equal(failed.status,1);assert.match(failed.out.warning,/index.md.*required/);
    assertNoLocalCopy(f.home);assert.equal(fs.existsSync(join(f.home,'.okf-source.json')),false);
    assert.deepEqual(fs.readdirSync(join(bindings.stateDir,'sources')),[]);
    put(index,bytes);const s=f.source();assertNoLocalCopy(f.home);
    const before=fs.readdirSync(f.home).sort();
    fs.rmSync(index);
    const invalid=f.cli('bases').out.result.bases.find(b=>b.alias==='secondary');
    assert.equal(invalid.validated.ok,false);assert.match(invalid.validated.error.message,/index.md.*required/);
    assert.equal(f.cli('refresh').out.error.code,'E_REMOVED');assert.deepEqual(fs.readdirSync(f.home).sort(),before);
    put(index,bytes);assert.equal(f.cli('bases').out.result.bases.find(b=>b.alias==='secondary').validated.ok,true);
    assert.equal(f.source().id,s.id);assert.equal(fs.readdirSync(join(bindings.stateDir,'sources')).length,1);
  });
  test(`base alias ${alias}: failure before source pointer does not strand registration`,t=>{
    const f=aliasedFixture(t,alias);
    renameFailure((from,to)=>to.endsWith('/source.json'),()=>assert.throws(()=>f.source(),/injected view I\/O failure/));
    assertNoLocalCopy(f.home);assert.equal(fs.existsSync(join(f.home,'.okf-source.json')),false);
    assert.deepEqual(fs.readdirSync(join(f.bindings.stateDir,'sources')),[]);
    const s=f.source();assertNoLocalCopy(f.home);assert.equal(f.source().id,s.id);
  });
  test(`base alias ${alias}: failure after source pointer resumes the same accepted resolution and evidence`,t=>{
    const f=aliasedFixture(t,alias);
    renameFailure((from,to)=>to===join(f.home,'STATE.md'),()=>assert.throws(()=>f.source(),/injected view I\/O failure/));
    const pointer=readJSON(join(f.home,'.okf-source.json')),s=loadSource(pointer.source);assert.equal(fs.existsSync(f.calls),false);
    note(f);capture(s);const before=loadStatus(s);
    // Retry resumes the registered source; it never re-resolves or resets it.
    fs.appendFileSync(join(f.base.path,'expert/log.md'),'\nLater accepted event.\n');
    const result=f.cli('spawn');assert.equal(result.status,0,result.stdout);assert.equal(result.out.meta.source,s.file);
    assert.deepEqual(loadSource(pointer.source).acceptedView,s.acceptedView);assertNoLocalCopy(f.home);
    assert.deepEqual(loadStatus(s).captured,before.captured);assert.equal(loadStatus(s).schedule,undefined);
    assert.equal(f.source().id,s.id);assert.equal(fs.readdirSync(join(s.bindings.stateDir,'sources')).length,1);
  });
}
test('accepted resolution refuses unresolved nodes and materializes nothing',t=>{
  const f=fixture(t),s=f.source(),before=fs.readdirSync(f.dir).sort();
  assert.throws(()=>acceptedResolution(s.bindings,{...s.decl,reads:['project/missing']}),/unresolved node/);
  const again=acceptedResolution(s.bindings,s.decl);assert.equal(again.project.digest,s.acceptedView.project.digest);assert.deepEqual(again.project.nodes,s.acceptedView.project.nodes);
  assert.deepEqual(fs.readdirSync(f.dir).sort(),before);assertNoLocalCopy(f.home);
});
test('registration leaves an existing ./knowledge/ (okf 2.x) untouched and never follows a symlinked one',t=>{
  const f=fixture(t),target=join(f.home,'knowledge');put(join(target,'keep.md'),'unregistered bytes');
  const s=f.source();assert.equal(fs.readFileSync(join(target,'keep.md'),'utf8'),'unregistered bytes');
  assert.equal(inspectSource(s).legacyLocalView.status,'legacy-local-view');
  fs.rmSync(target,{recursive:true});fs.symlinkSync(f.base.path,target);
  assert.equal(inspectSource(s).legacyLocalView.symlink,true,'reported, not followed');assert.equal(f.source().id,s.id);assert.ok(fs.existsSync(join(f.base.path,'index.md')),'base untouched');
});
function migrationFixture(f) {
  const legacy=join(f.soul,'knowledge');put(join(legacy,'index.md'),'---\nokf_version: "0.1"\n---\n\n# Legacy\n* [Decision](decision.md) - Preserved.\n');put(join(legacy,'log.md'),'# History\n');put(join(legacy,'decision.md'),'---\ntype: Decision\ntitle: Decision\ndescription: Preserved.\n---\n\nPreserved legacy rationale.\n');
  const m=migrate(f.bindings,{legacy,alias:'project',node:'expert',output:join(f.dir,'migration-stage')});deliverMigration(m.migration);return {m,legacy,original:tree(legacy),decl:readJSON(join(f.soul,'okf.json'))};
}
function unchangedCutover(f,{m,legacy,original,decl}) {
  assert.deepEqual(tree(legacy),original);assert.deepEqual(readJSON(join(f.soul,'okf.json')),decl);assert.equal(fs.existsSync(join(f.soul,'.okf-cutover.json')),false);assert.equal(readJSON(m.migration).cutover,undefined);assert.equal(readJSON(m.migration).receipt.status,'accepted');
}
test('R1 migration cutover rejects current alias retargeting before changing legacy bundle or declaration',t=>{
  const f=fixture(t),mf=migrationFixture(f),raw=readJSON(f.bindingFile);
  const variants=[{...raw,bases:{project:{...raw.bases.project,path:'other-empty'}}},{...raw,bases:{project:{...raw.bases.project,id:'other-id'}}},{...raw,bases:{other:raw.bases.project}}];
  // An empty accepted replacement with exactly the SAME identity and owner is
  // still different custody. The frozen locator, not just owner/ID, must match.
  const alternate=structuredClone(raw);alternate.bases.project.path='other-empty';save(f.bindingFile,alternate);initBase(loadBindings(),'project',join(f.dir,'nodes.json'),undefined,{confirm:true});
  for(const changed of variants) {save(f.bindingFile,changed);assert.throws(()=>cutoverMigration(mf.m.migration,f.soul),/current migration alias differs/);unchangedCutover(f,mf);}
  save(f.bindingFile,raw);assert.equal(cutoverMigration(mf.m.migration,f.soul).status,'complete');
});
test('R1 cutover verifies accepted readiness, frozen owner/path, delivered content and all declared refs',t=>{
  const f=fixture(t),mf=migrationFixture(f),metaFile=join(f.base.path,'okf-base.json'),meta=readJSON(metaFile);
  const wrong=structuredClone(meta);wrong.nodes.expert.owner='owner-other';save(metaFile,wrong);assert.throws(()=>cutoverMigration(mf.m.migration,f.soul),/ownership\/path differs/);unchangedCutover(f,mf);save(metaFile,meta);
  const index=fs.readFileSync(join(f.base.path,'index.md'));fs.rmSync(join(f.base.path,'index.md'));assert.throws(()=>cutoverMigration(mf.m.migration,f.soul),/index.md.*required/);unchangedCutover(f,mf);put(join(f.base.path,'index.md'),index);
  const concept=join(f.base.path,'expert/decision.md'),text=fs.readFileSync(concept);fs.appendFileSync(concept,'\nUnreviewed replacement.\n');assert.throws(()=>cutoverMigration(mf.m.migration,f.soul),/no longer matches delivered content/);unchangedCutover(f,mf);put(concept,text);
  const declarationFile=join(f.soul,'okf.json');save(declarationFile,{...mf.decl,reads:['project/missing']});assert.throws(()=>cutoverMigration(mf.m.migration,f.soul),/unresolved node/);assert.equal(fs.existsSync(mf.legacy),true);assert.equal(readJSON(mf.m.migration).cutover,undefined);save(declarationFile,mf.decl);
  assert.equal(cutoverMigration(mf.m.migration,f.soul).status,'complete');assert.equal(cutoverMigration(mf.m.migration,f.soul).status,'complete');
});

test('R1 actual native capture/recall transports 60 large Claude records into durable bounded inputs',{skip:!nativeCLI},t=>{
  const f=fixture(t),s=f.source(),fakeCLI=process.env.OATS_CLI_BIN;
  // This is a standalone synthetic inventory, not a kernel-managed launch.
  // Opt in explicitly to observer roots; production final capture does not.
  const nativeFixtureCLI=join(f.dir,'native-fixture-cli');
  put(nativeFixtureCLI,`#!/bin/sh\nif [ "$1" = capture ]; then exec ${quote(process.execPath)} ${quote(resolve(nativeCLI))} "$@" --current-roots; fi\nexec ${quote(process.execPath)} ${quote(resolve(nativeCLI))} "$@"\n`);fs.chmodSync(nativeFixtureCLI,0o755);
  process.env.OATS_CLI_BIN=nativeFixtureCLI;process.env.TURN_RECORD_ROOT=join(f.dir,'native-record');process.env.TURN_RECORD_OWNER='fixture';
  const transcript=join(process.env.HOME,'.claude/projects/-fixture/fixture-session.jsonl');
  put(transcript,Array.from({length:60},(_,i)=>JSON.stringify({type:'assistant',cwd:f.home,sessionId:'fixture-session',timestamp:'2026-09-13T12:00:00Z',message:{role:'assistant',content:[{type:'text',text:`${i}:`+'x'.repeat(350000)}]}})).join('\n')+'\n');
  assert.equal(capture(s,{final:true}).complete,true);
  const all=capturedTurns(s);assert.equal(all.length,60);assert.ok(all.every(v=>v.text[0].text.length>350000));assert.equal(loadStatus(s).captured.inputs.length,60);
  fs.rmSync(f.home,{recursive:true});fs.rmSync(transcript);process.env.OATS_CLI_BIN=fakeCLI;
  // Post-removal worker consumes only durable input; no runtime is launched.
  const run=readRun(s,runSource(loadSource(s.file),{manual:true,noLaunch:true}).run);const evidence=readJSON(join(run.worker.home,'work/input.json'));assert.ok(evidence.inputs[0].turns[0].text[0].text.startsWith('0:'));
  assert.equal(complete(s,run.id,judgment(f,s,run,{drop:true})).processed,true);assert.equal(loadStatus(s).processed.length,1);assert.equal(loadStatus(s).captured.inputs.length,60);
});
test('4.2.0 actual native scheduler: registration adds no job; --remove-schedules removes an authentic okf 4.1 job, keeps a foreign one, installs no host timer',{skip:!nativeCLI},t=>{
  const f=fixture(t),s=f.source();put(join(f.context,'oats-local.yaml'),'schemaVersion: 2\nworkspace: local:okf-fixture\n');process.env.OATS_CLI_BIN=resolve(nativeCLI);
  const native=args=>{const r=spawnSync(process.execPath,[resolve(nativeCLI),...args,'--dir',f.context,'--json'],{cwd:f.context,env:process.env,encoding:'utf8'});return JSON.parse(r.stdout);};
  assert.deepEqual(native(['schedule','list']).result.schedules.filter(j=>j.id.startsWith('okf-')),[],'registration added no job');
  // The exact definition okf 4.1 registered, through the real kernel.
  const job=`okf-${s.id}`,old={id:job,kind:'command',enabled:true,cron:'*/15 * * * *',tz:'UTC',cwd:f.context,argv:legacyScheduleArgv(s)};
  save(join(f.dir,'old-job.json'),old);assert.equal(native(['schedule','add',job,'--file',join(f.dir,'old-job.json')]).ok,true);
  const g=seat(f,'seat-foreign');save(join(f.dir,'foreign.json'),{...old,id:`okf-${g.id}`,argv:['oats','status']});assert.equal(native(['schedule','add',`okf-${g.id}`,'--file',join(f.dir,'foreign.json')]).ok,true);
  const r=deploymentCli(f,'setup',['--remove-schedules']);assert.equal(r.out.error.code,'E_SCHEDULE_OWNERSHIP',r.stdout);assert.deepEqual(r.out.error.result.removed,[job]);
  const left=native(['schedule','list']).result;assert.deepEqual(left.schedules.map(j=>j.id),[`okf-${g.id}`]);assert.notEqual(left.scheduler.installed,true);
  assert.equal(readJSON(join(dirname(s.file),'schedule-migration.json')).effects.at(-1).result,'confirmed');
});

// Custody R1: publication must confirm the delivered tree, not merely a valid
// working copy. All repositories, HOME configs and killed processes are fixtures.
function fixtureCommit(repo,message) {git(repo,['add','.']);git(repo,['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm',message]);}
function noPublication(f,s) {
  assert.deepEqual(loadStatus(s).processed,[]);
  assert.equal(fs.existsSync(join(f.dir,'pr.json')),false);
  assert.equal(git(f.repo,['for-each-ref','--format=%(refname)','refs/heads/okf/']),'');
}
test('custody R1 ignored concept cannot disappear from the validated Git proposal',t=>{
  // An ignore rule outside the base root is never materialized into the staging
  // tree (only the base root is), so it cannot reach the add step: the validated
  // concept is published exactly as validated. An ignore rule inside the base
  // stays subject to the omission guard below.
  const f=fixture(t,{kind:'git'});put(join(f.repo,'.gitignore'),'**/decision.md\n');fixtureCommit(f.repo,'ordinary ignore rule');
  note(f);const {s,run}=prepared(f),j=judgment(f,s,run);
  const r=complete(s,run.id,j);assert.equal(r.processed,true);
  assert.equal(git(f.repo,['cat-file','-t',`${r.receipts.project.commit}:knowledge/expert/decision.md`]),'blob');
});
test('custody R1 Git normalization cannot change validated CRLF proposal bytes',t=>{
  const f=fixture(t,{kind:'git'});put(join(f.repo,'.gitattributes'),'**/*.md text eol=lf\n');fixtureCommit(f.repo,'ordinary text normalization');
  note(f);const {s,run}=prepared(f),j=judgment(f,s,run),p=join(run.stages.project.root,'expert/decision.md');
  put(p,fs.readFileSync(p,'utf8').replace('fallback.\n','fallback.\r\n'));
  assert.throws(()=>complete(s,run.id,j),/publication tree bytes differ/);noPublication(f,s);
});
test('custody R1 staged outside-base edit is rejected even when working bytes match baseline',t=>{
  const f=fixture(t,{kind:'git'});note(f);const {s,run}=prepared(f),j=judgment(f,s,run),cwd=run.stages.project.checkout;
  put(join(cwd,'code.txt'),'unauthorized index content\n');git(cwd,['add','code.txt']);put(join(cwd,'code.txt'),'code baseline\n');
  assert.equal(git(cwd,['diff',run.stages.project.head,'--','code.txt']),'');
  assert.throws(()=>complete(s,run.id,j),/outside.*knowledge/);noPublication(f,s);
  assert.equal(git(cwd,['show',':code.txt']),'unauthorized index content','rejection preserves the worker index');
});
function gitWrapper(f,body) {
  const real=execFileSync('/bin/sh',['-c','command -v git'],{env:{PATH:hostPath},encoding:'utf8'}).trim();
  const p=join(f.dir,'bin/git');
  put(p,`#!${process.execPath}\nimport fs from 'node:fs';import {spawnSync,execFileSync} from 'node:child_process';const real=${JSON.stringify(real)},a=process.argv.slice(2),cwd=a[a.indexOf('-C')+1];${body}\nconst r=spawnSync(real,a,{stdio:'inherit'});process.exit(r.status ?? 1);\n`);fs.chmodSync(p,0o755);
}
test('custody R1 publication index is rebuilt from baseline, not copied from worker index',t=>{
  const f=fixture(t,{kind:'git'});note(f);const {s,run}=prepared(f),j=judgment(f,s,run);
  // Modify the ordinary index AFTER scope checks, at private read-tree. This
  // must not contaminate publication, nor be overwritten by the private index.
  gitWrapper(f,`if(a.includes('read-tree') && process.env.GIT_INDEX_FILE) {const env={...process.env};delete env.GIT_INDEX_FILE;fs.writeFileSync(cwd+'/code.txt','late index edit\\n');execFileSync(real,['-C',cwd,'add','code.txt'],{env});fs.writeFileSync(cwd+'/code.txt','code baseline\\n');}`);
  const r=complete(s,run.id,j);assert.equal(r.processed,true);
  assert.equal(git(f.repo,['show',`${r.receipts.project.commit}:code.txt`]),'code baseline');
  assert.equal(git(run.stages.project.checkout,['show',':code.txt']),'late index edit');
});
test('custody R1 actual full publication tree diff rejects an out-of-base index change',t=>{
  const f=fixture(t,{kind:'git'});note(f);const {s,run}=prepared(f),j=judgment(f,s,run);
  // Independently exercise the final tree guard, after both scope checks.
  gitWrapper(f,`if(a.includes('write-tree') && process.env.GIT_INDEX_FILE) {fs.writeFileSync(cwd+'/code.txt','unauthorized publication index\\n');execFileSync(real,['-C',cwd,'add','code.txt']);fs.writeFileSync(cwd+'/code.txt','code baseline\\n');}`);
  assert.throws(()=>complete(s,run.id,j),/publication tree changes files outside/);noPublication(f,s);
});
test('4.0.6 the publication tree of a partial stage still refuses an out-of-base index change',t=>{
  const f=fixture(t,{kind:'git'});git(f.repo,['config','uploadpack.allowFilter','true']);note(f);const {s,run}=prepared(f),j=judgment(f,s,run);
  // Independently exercise the final tree guard, after both scope checks.
  gitWrapper(f,`if(a.includes('write-tree') && process.env.GIT_INDEX_FILE) {fs.writeFileSync(cwd+'/code.txt','unauthorized publication index\\n');execFileSync(real,['-C',cwd,'add','code.txt']);fs.writeFileSync(cwd+'/code.txt','code baseline\\n');}`);
  assert.throws(()=>complete(s,run.id,j),/publication tree changes files outside/);noPublication(f,s);
});
for(const mode of ['local','ambient','multiple','pushInsteadOf']) test(`custody R1 ${mode} effective push destination fails BEFORE unauthorized transfer`,t=>{
  const f=fixture(t,{kind:'git'}),wrong=join(f.dir,'unapproved.git');fs.mkdirSync(wrong);git(wrong,['init','--bare','-q']);
  const before=tree(wrong);note(f);const {s,run}=prepared(f),j=judgment(f,s,run),cwd=run.stages.project.checkout;
  if(mode==='ambient') put(join(process.env.HOME,'.gitconfig'),`[remote "origin"]\n\tpushurl = ${wrong}\n`);
  else if(mode==='pushInsteadOf') git(cwd,['config',`url.${wrong}.pushInsteadOf`,f.repo]);
  else {
    git(cwd,['remote','set-url','--push','origin',mode==='multiple'?f.repo:wrong]);
    if(mode==='multiple') git(cwd,['remote','set-url','--add','--push','origin',wrong]);
  }
  assert.equal(git(cwd,['remote','get-url','origin']),f.repo);
  assert.throws(()=>complete(s,run.id,j),/frozen Git publication remote or effective push destination/);
  noPublication(f,s);assert.deepEqual(tree(wrong),before,'no objects OR refs transferred to the unapproved repository');
});
test('custody R1 retry rechecks effective push URLs after an uncertain successful push',t=>{
  const f=fixture(t,{kind:'git'});note(f);const {s,run}=prepared(f),j=judgment(f,s,run);
  const count=join(f.dir,'push-count');
  gitWrapper(f,`if(a.includes('push')) {const r=spawnSync(real,a,{stdio:'inherit'});if(r.status===0){fs.appendFileSync(${JSON.stringify(count)},'p');process.exit(73);}process.exit(r.status ?? 1);}`);
  assert.throws(()=>complete(s,run.id,j),/failed/);assert.equal(readRun(s,run.id).receipts.project.status,'push-unknown');
  const wrong=join(f.dir,'unapproved.git');fs.mkdirSync(wrong);git(wrong,['init','--bare','-q']);const before=tree(wrong);
  git(run.stages.project.checkout,['remote','set-url','--push','origin',wrong]);assert.throws(()=>retry(s),/effective push destination/);
  assert.deepEqual(tree(wrong),before);assert.deepEqual(loadStatus(s).processed,[]);
  // Reconstructing the deleted worker uses the frozen remote and reconciles
  // the already successful push, rather than creating a duplicate delivery.
  fs.rmSync(run.worker.home,{recursive:true});assert.equal(retry(s).processed,true);assert.equal(fs.readFileSync(count,'utf8'),'p');
});
for(const phase of ['before-write','partial-write','before-rename']) test(`custody R1 SIGKILL ${phase} inside atomic publication recovers after explicit unlock`,t=>{
  const f=fixture(t);note(f);const {s,run}=prepared(f),j=judgment(f,s,run),target=join(f.base.path,'expert/decision.md');
  const code=`import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';import {loadSource} from ${JSON.stringify(new URL('../oats-package/capabilities/oats-okf/lib/sources.mjs',import.meta.url).href)};import {complete} from ${JSON.stringify(new URL('../oats-package/capabilities/oats-okf/lib/worker.mjs',import.meta.url).href)};
    const phase=${JSON.stringify(phase)},open=fs.openSync,write=fs.writeFileSync,rename=fs.renameSync;let tempFd;
    fs.openSync=(p,...args)=>{const fd=open(p,...args);if(String(p).includes('decision.md.tmp-'))tempFd=fd;return fd;};
    fs.writeFileSync=(fd,bytes,...args)=>{if(fd===tempFd && phase!=='before-rename'){if(phase==='partial-write'){write(fd,bytes.subarray(0,17),...args);fs.fsyncSync(fd);}process.kill(process.pid,'SIGKILL');}return write(fd,bytes,...args);};
    fs.renameSync=(from,to)=>{if(to===${JSON.stringify(target)} && phase==='before-rename')process.kill(process.pid,'SIGKILL');return rename(from,to);};syncBuiltinESMExports();
    complete(loadSource(${JSON.stringify(s.file)}),${JSON.stringify(run.id)},${JSON.stringify(j)});`;
  const child=spawnSync(process.execPath,['--input-type=module','-e',code],{env:process.env,encoding:'utf8'});assert.equal(child.signal,'SIGKILL',child.stderr);
  assert.equal(fs.existsSync(journalPath(f.base)),true);assert.deepEqual(loadStatus(s).processed,[]);
  assert.ok(fs.readdirSync(baseLock(f.base)).some(p=>p.startsWith('decision.md.tmp-')));
  assert.ok(!Object.keys(tree(f.base.path)).some(p=>p.includes('.tmp-')),'accepted namespace has no atomic-write scratch');
  for(const lock of [baseLock(f.base),join(dirname(s.file),'worker.lock')]) {const r=f.cli('unlock',['--lock',lock,'--token',readJSON(join(lock,'owner.json')).token]);assert.equal(r.status,0,r.stdout);}
  assert.throws(()=>readAccepted(s),/publication pending/);
  if(phase==='partial-write') {
    const unrelated=join(f.base.path,'expert/unrelated.tmp-foreign');put(unrelated,'unrelated bytes');
    assert.throws(()=>retry(s),/unexpected bytes during publication recovery/);assert.equal(fs.readFileSync(unrelated,'utf8'),'unrelated bytes');
    fs.rmSync(unrelated); // Only the fixture/operator may resolve unrelated bytes.
  }
  assert.equal(retry(s).processed,true);assert.equal(complete(s,run.id).processed,true);assert.equal(loadStatus(s).processed.length,1);
  const p=readJSON(readRun(s,run.id).receipts.project.proposal);assert.deepEqual(tree(f.base.path),p.after);
  assert.equal(fs.existsSync(journalPath(f.base)),false);readAccepted(s);
});
function secondDirectory(f,{owned=false}={}) {
  const raw=readJSON(f.bindingFile);raw.bases.secondary={id:'base-2',kind:'directory',path:'second-base'};save(f.bindingFile,raw);
  const bindings=loadBindings();initBase(bindings,'secondary',join(f.dir,'nodes.json'),undefined,{confirm:true});
  if(owned) {const decl=readJSON(join(f.soul,'okf.json'));decl.owns.push('secondary/expert');save(join(f.soul,'okf.json'),decl);}
  return bindings;
}
test('custody R1 migration stage cannot overlap ANY configured base or coordination artifact',t=>{
  const f=fixture(t),bindings=secondDirectory(f),peer=bindings.bases.secondary,legacy=join(f.soul,'knowledge');
  put(join(legacy,'index.md'),'---\nokf_version: "0.1"\n---\n\n# Legacy\n');put(join(legacy,'log.md'),'# History\n');
  const original=tree(legacy),before=Object.fromEntries(Object.entries(bindings.bases).map(([a,b])=>[a,tree(b.path)]));
  for(const output of [join(peer.path,'expert/migration-stage'),peer.path,f.dir,baseLock(peer),join(baseLock(peer),'stage'),journalPath(peer),join(journalPath(peer),'stage'),baseLock(f.base),join(f.base.path,'expert/stage')]) {
    assert.throws(()=>migrate(bindings,{legacy,alias:'project',node:'expert',output}),/overlap|disjoint/);
    for(const [a,b] of Object.entries(bindings.bases)) assert.deepEqual(tree(b.path),before[a]);
    assert.deepEqual(tree(legacy),original);assert.equal(fs.existsSync(bindings.stateDir),false,'rejected staging creates no preservation or staging state');
  }
  assert.equal(migrate(bindings,{legacy,alias:'project',node:'expert',output:join(f.dir,'valid-stage')}).status,'staged');
});
function partialConflict(f) {
  const bindings=secondDirectory(f,{owned:true});note(f);const {s,run}=prepared(f),j=judgment(f,s,run),first=readJSON(j);
  judgment(f,s,run,{base:'secondary'});first.outcomes[0].concepts.push(...readJSON(j).outcomes[0].concepts);save(j,first);
  let changed=false;
  assert.throws(()=>complete(s,run.id,j,{afterWrite:()=>{if(changed)return;changed=true;withLock(baseLock(bindings.bases.secondary),()=>fs.appendFileSync(join(bindings.bases.secondary.path,'peer/log.md'),'newer cooperative accepted update\n'));}}),/directory base changed/);
  const pending=readRun(s,run.id);assert.equal(pending.receipts.project.status,'accepted');assert.equal(pending.receipts.secondary.status,'validated');
  for(const b of Object.values(bindings.bases)) {assert.equal(fs.existsSync(baseLock(b)),false);assert.equal(fs.existsSync(journalPath(b)),false);}
  return {bindings,s,run:pending,j};
}
test('custody R1 partial-success CAS conflict rejudges ONLY outstanding destinations without duplicate delivery',t=>{
  const f=fixture(t),{bindings,s,run,j}=partialConflict(f),accepted=tree(f.base.path),receipt=structuredClone(run.receipts.project);
  assert.throws(()=>retry(s),/directory base changed/);assert.deepEqual(loadStatus(s).processed,[]);
  const rejudged=retry(s,{rejudge:true});assert.equal(rejudged.status,'ready');assert.deepEqual(rejudged.outstanding,['secondary']);assert.deepEqual(rejudged.settled,['project']);
  const next=readRun(s,run.id);assert.deepEqual(next.inputs,run.inputs);assert.deepEqual(next.receipts.project,receipt);
  assert.deepEqual(readJSON(next.history[0]).receipts,run.receipts);assert.ok(fs.existsSync(run.stages.secondary.root));
  const map=readJSON(join(run.worker.home,'work/staging.json'));assert.equal(map.project.settled,true);assert.deepEqual(map.project.owned,[]);assert.equal(map.project.root,undefined);
  assert.equal(runSource(s,{manual:true,noLaunch:true}).run,run.id);assert.deepEqual(loadStatus(s).processed,[]);
  assert.throws(()=>complete(s,run.id,j),/destination already settled/);
  // Another CAS change before the new judgment can also be rejudged; neither
  // failure may erase the earlier receipt or mutate the accepted destination.
  const secondFile=judgment(f,s,next,{base:'secondary'});withLock(baseLock(bindings.bases.secondary),()=>fs.appendFileSync(join(bindings.bases.secondary.path,'peer/log.md'),'second accepted update\n'));
  assert.throws(()=>complete(s,run.id,secondFile),/accepted base changed/);assert.equal(retry(s,{rejudge:true}).rejudged,true);
  const last=readRun(s,run.id),lastFile=judgment(f,s,last,{base:'secondary'});
  const r=complete(s,run.id,lastFile);assert.equal(r.processed,true);assert.deepEqual(r.receipts.project,receipt);assert.equal(r.receipts.secondary.status,'accepted');
  assert.deepEqual(tree(f.base.path),accepted);assert.equal(loadStatus(s).processed.length,1);assert.equal(loadStatus(s).activeRun,null);
  assert.match(fs.readFileSync(join(bindings.bases.secondary.path,'peer/log.md'),'utf8'),/newer cooperative accepted update\nsecond accepted update/);
  assert.equal(complete(s,run.id).processed,true);assert.deepEqual(tree(f.base.path),accepted);assert.equal(loadStatus(s).processed.length,1);
});
test('custody R1 partial-success rejudgment still enforces frozen owner and outstanding journals',t=>{
  const f=fixture(t),{bindings,s,run}=partialConflict(f),second=bindings.bases.secondary,accepted=tree(f.base.path);
  const metaFile=join(second.path,'okf-base.json'),meta=readJSON(metaFile);save(metaFile,{...meta,nodes:{...meta.nodes,expert:{...meta.nodes.expert,owner:'changed-owner'}}});
  assert.throws(()=>retry(s,{rejudge:true}),/ownership\/path changed/);assert.deepEqual(readRun(s,run.id),run);assert.deepEqual(loadStatus(s).processed,[]);save(metaFile,meta);
  assert.equal(retry(s,{rejudge:true}).rejudged,true);const next=readRun(s,run.id),j=judgment(f,s,next,{base:'secondary'});
  assert.throws(()=>complete(s,run.id,j,{afterWrite:()=>{throw new Error('interrupted outstanding publication');}}),/interrupted outstanding/);
  assert.throws(()=>retry(s,{rejudge:true}),/directory publication pending/);assert.deepEqual(tree(f.base.path),accepted);assert.deepEqual(loadStatus(s).processed,[]);
  assert.equal(retry(s).processed,true);assert.deepEqual(tree(f.base.path),accepted);assert.equal(loadStatus(s).processed.length,1);
});
test('custody R1 partial delivered Git PR is retained during rejudgment and still reconciles later merge',t=>{
  const f=fixture(t,{kind:'git'}),bindings=secondDirectory(f,{owned:true}),second=bindings.bases.secondary;
  note(f);const {s,run}=prepared(f),j=judgment(f,s,run),first=readJSON(j);judgment(f,s,run,{base:'secondary'});first.outcomes[0].concepts.push(...readJSON(j).outcomes[0].concepts);save(j,first);
  // Cooperatively advance the second base while the first base's real local
  // Git proposal receives its deterministic fixture PR.
  const gh=join(f.dir,'bin/gh'),code=`import {withLock,fs} from ${JSON.stringify(new URL('../oats-package/capabilities/oats-okf/lib/io.mjs',import.meta.url).href)};withLock(${JSON.stringify(baseLock(second))},()=>fs.appendFileSync(${JSON.stringify(join(second.path,'peer/log.md'))},'new accepted update\\n'));`;
  put(gh,fs.readFileSync(gh,'utf8').replace("else if(a[1]==='create') {",`else if(a[1]==='create') {execFileSync(${JSON.stringify(process.execPath)},['--input-type=module','-e',${JSON.stringify(code)}]);`));
  assert.throws(()=>complete(s,run.id,j),/directory base changed/);const delivered=readRun(s,run.id).receipts.project;assert.equal(delivered.status,'delivered');assert.deepEqual(loadStatus(s).processed,[]);
  assert.equal(retry(s,{rejudge:true}).rejudged,true);const next=readRun(s,run.id);assert.equal(complete(s,run.id,judgment(f,s,next,{base:'secondary'})).processed,true);
  assert.equal(git(f.repo,['for-each-ref','--format=%(refname)','refs/heads/okf/']),`refs/heads/${delivered.branch}`);assert.equal(readRun(s,run.id).receipts.project.commit,delivered.commit);
  git(f.repo,['merge','--ff-only',delivered.branch]);const prs=readJSON(join(f.dir,'pr.json'));prs[0].state='MERGED';prs[0].mergedAt='2026-09-13T12:00:00Z';prs[0].mergeCommit={oid:delivered.commit};save(join(f.dir,'pr.json'),prs);
  assert.equal(complete(s,run.id).receipts.project.status,'accepted');assert.equal(loadStatus(s).accepted[`${run.id}/project`].acceptedCommit,delivered.commit);assert.equal(loadStatus(s).processed.length,1);
});
test('custody R1 migration stage rejects an embedded local Git base belonging to another alias',t=>{
  const f=fixture(t,{kind:'git'}),bindings=secondDirectory(f),legacy=join(f.soul,'knowledge');
  put(join(legacy,'index.md'),'---\nokf_version: "0.1"\n---\n\n# Legacy\n');put(join(legacy,'log.md'),'# History\n');
  const before=tree(f.repo,{git:true}),directory=tree(bindings.bases.secondary.path);
  assert.throws(()=>migrate(bindings,{legacy,alias:'secondary',node:'expert',output:join(f.repo,'knowledge/expert/migration-stage')}),/overlaps configured accepted base/);
  assert.deepEqual(tree(f.repo,{git:true}),before);assert.deepEqual(tree(bindings.bases.secondary.path),directory);
});
test('custody R1 unsupported cross-filesystem atomic staging fails before publication intent or accepted writes',t=>{
  const f=fixture(t);note(f);const {s,run}=prepared(f),j=judgment(f,s,run),before=tree(f.base.path),stat=fs.default.statSync;
  // No mounts or host configuration: model only the filesystem device check.
  fs.default.statSync=(p,...args)=>{const value=stat(p,...args);return p===baseLock(f.base)?{...value,dev:value.dev+1}:value;};syncBuiltinESMExports();
  try {assert.throws(()=>complete(s,run.id,j),/must share a filesystem/);} finally {fs.default.statSync=stat;syncBuiltinESMExports();}
  assert.equal(fs.existsSync(journalPath(f.base)),false);assert.deepEqual(tree(f.base.path),before);assert.deepEqual(loadStatus(s).processed,[]);
  assert.equal(readRun(s,run.id).receipts.project.status,'validated');assert.equal(retry(s).processed,true);
});

// Custody R2: replacement refs must never substitute frozen publication objects.
test('custody R2 replace-ref baseline cannot hide an unauthorized out-of-base edit',t=>{
  const f=fixture(t,{kind:'git'});note(f);const {s,run}=prepared(f),j=judgment(f,s,run),stage=run.stages.project,cwd=stage.checkout;
  put(join(cwd,'code.txt'),'unauthorized replacement baseline\n');git(cwd,['add','code.txt']);
  const replacement=git(cwd,['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit-tree',git(cwd,['write-tree']),'-m','replacement baseline']);
  git(cwd,['replace',stage.head,replacement]);
  assert.equal(git(cwd,['show',`${stage.head}:code.txt`]),'unauthorized replacement baseline','fixture reproduces replacement-aware object reads');
  assert.throws(()=>complete(s,run.id,j),/outside.*knowledge/);noPublication(f,s);
  // Repair only the unauthorized edit. A remaining replacement ref is harmless,
  // not an instruction to delete/rewrite the worker's repository metadata.
  git(cwd,['--no-replace-objects','checkout',stage.head,'--','code.txt']);
  const r=complete(s,run.id,j);assert.equal(r.receipts.project.status,'delivered');
  assert.equal(git(f.repo,['--no-replace-objects','show',`${r.receipts.project.commit}:code.txt`]),'code baseline');
  assert.equal(git(f.repo,['diff','--name-only',stage.head,r.receipts.project.commit]).split('\n').every(p=>p.startsWith('knowledge/')),true);
  assert.equal(git(cwd,['replace','-l']),stage.head);assert.equal(loadStatus(s).processed.length,1);
});
test('custody R2 late replacement refs cannot contaminate private baseline or transport',t=>{
  const f=fixture(t,{kind:'git'});note(f);const {s,run}=prepared(f),j=judgment(f,s,run),stage=run.stages.project,cwd=stage.checkout;
  put(join(cwd,'code.txt'),'late replacement baseline\n');git(cwd,['add','code.txt']);
  const replacement=git(cwd,['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit-tree',git(cwd,['write-tree']),'-m','late replacement']);
  git(cwd,['checkout',stage.head,'--','code.txt']);
  const calls=join(f.dir,'git-calls.jsonl');
  gitWrapper(f,`fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify({a,env:process.env.GIT_NO_REPLACE_OBJECTS})+'\\n');if(a.includes('read-tree') && process.env.GIT_INDEX_FILE) execFileSync(real,['-C',cwd,'replace',${JSON.stringify(stage.head)},${JSON.stringify(replacement)}]);`);
  // Host Git environment cannot turn replacement interpretation back on.
  process.env.GIT_NO_REPLACE_OBJECTS='0';
  const r=complete(s,run.id,j);assert.equal(r.processed,true);
  const recorded=fs.readFileSync(calls,'utf8').trim().split('\n').map(JSON.parse);
  for(const c of recorded.filter(c=>c.a.includes('core.hooksPath=/dev/null'))) {assert.ok(c.a.includes('--no-replace-objects'));assert.equal(c.env,'1');}
  // complete confirms the baseline by a fetch into the stage: it clones only for recovery.
  for(const cmd of ['fetch','diff','read-tree','write-tree','commit-tree','cat-file','ls-tree','push']) assert.ok(recorded.some(c=>c.a.includes(cmd)),cmd);
  fs.rmSync(join(f.dir,'bin/git'));
  assert.equal(git(f.repo,['--no-replace-objects','show',`${r.receipts.project.commit}:code.txt`]),'code baseline');
  assert.equal(git(f.repo,['--no-replace-objects','cat-file','commit',r.receipts.project.commit]).split('\n').filter(l=>l.startsWith('parent ')).join('\n'),`parent ${stage.head}`);
});
for(const defect of ['tree','parent']) test(`custody R2 final raw commit verification rejects replacement-hidden ${defect} substitution`,t=>{
  const f=fixture(t,{kind:'git'});note(f);const {s,run}=prepared(f),j=judgment(f,s,run),cwd=run.stages.project.checkout;
  // Make the command return an unexpected real object, then map it to a clean
  // replacement. The final guard must inspect what Git will actually publish.
  const mutation=defect==='tree'?`fs.writeFileSync(cwd+'/code.txt','unauthorized actual object\\n');execFileSync(real,['-C',cwd,'add','--all']);badArgs[badArgs.indexOf('commit-tree')+1]=execFileSync(real,['-C',cwd,'write-tree'],{encoding:'utf8'}).trim();`:`badArgs.splice(badArgs.indexOf('-p'),2);`;
  gitWrapper(f,`if(a.includes('commit-tree')) {const good=execFileSync(real,a,{encoding:'utf8'}).trim(),badArgs=[...a];${mutation}const bad=execFileSync(real,badArgs,{encoding:'utf8'}).trim();execFileSync(real,['-C',cwd,'replace','-f',bad,good]);console.log(bad);process.exit(0);}`);
  assert.throws(()=>complete(s,run.id,j),defect==='tree'?/publication tree changes files outside/:/exactly its recorded accepted parent/);noPublication(f,s);
  const receipt=readRun(s,run.id).receipts.project;assert.equal(receipt.status,'committed');
  // Retry re-verifies the immutable object, even with a persisted commit receipt.
  fs.rmSync(join(f.dir,'bin/git'));
  assert.throws(()=>retry(s),defect==='tree'?/publication tree changes files outside/:/exactly its recorded accepted parent/);noPublication(f,s);
});
function journalCrash(f,s,run,j,base,phase='before-install') {
  const code=`import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';import {loadSource} from ${JSON.stringify(new URL('../oats-package/capabilities/oats-okf/lib/sources.mjs',import.meta.url).href)};import {complete} from ${JSON.stringify(new URL('../oats-package/capabilities/oats-okf/lib/worker.mjs',import.meta.url).href)};
    const rename=fs.renameSync;fs.renameSync=(from,to)=>{if(to!==${JSON.stringify(journalPath(base))})return rename(from,to);if(${JSON.stringify(phase)}==='after-install')rename(from,to);process.kill(process.pid,'SIGKILL');};syncBuiltinESMExports();complete(loadSource(${JSON.stringify(s.file)}),${JSON.stringify(run.id)},${JSON.stringify(j)});`;
  const child=spawnSync(process.execPath,['--input-type=module','-e',code],{env:process.env,encoding:'utf8'});assert.equal(child.signal,'SIGKILL',child.stderr);
  assert.equal(fs.existsSync(journalPath(base)),phase==='after-install');
  assert.equal(readRun(s,run.id).receipts[base.alias].status,'publication-intent');
  for(const lock of [baseLock(base),join(dirname(s.file),'worker.lock')]) {const r=f.cli('unlock',['--lock',lock,'--token',readJSON(join(lock,'owner.json')).token]);assert.equal(r.status,0,r.stdout);}
}
for(const firstAction of ['retry','rejudge']) test(`custody R2 SIGKILL before journal installation permits ${firstAction} after cooperative baseline drift`,t=>{
  const f=fixture(t);note(f);const {s,run}=prepared(f),j=judgment(f,s,run),before=tree(f.base.path);
  journalCrash(f,s,run,j,{...f.base,alias:'project'});assert.deepEqual(tree(f.base.path),before);assert.deepEqual(loadStatus(s).processed,[]);
  withLock(baseLock(f.base),()=>fs.appendFileSync(join(f.base.path,'peer/log.md'),'cooperative update after interrupted intent\n'));
  const newer=tree(f.base.path);readAccepted(s);
  if(firstAction==='retry') {assert.throws(()=>retry(s),/directory base changed/);assert.equal(readRun(s,run.id).receipts.project.status,'validated');}
  assert.equal(retry(s,{rejudge:true}).status,'abandoned');assert.deepEqual(tree(f.base.path),newer);assert.deepEqual(loadStatus(s).processed,[]);
  const next=readRun(s,runSource(s,{manual:true,noLaunch:true}).run);assert.notEqual(next.id,run.id);assert.deepEqual(next.inputs,run.inputs);
  assert.equal(complete(s,next.id,judgment(f,s,next)).processed,true);assert.equal(loadStatus(s).processed.length,1);
  assert.equal(fs.existsSync(run.worker.home),true);assert.equal(fs.existsSync(readRun(s,run.id).receipts.project.proposal),true);
  assert.equal(tree(f.base.path)['peer/log.md'],newer['peer/log.md']);
});
test('custody R2 absent-journal intent retries the same proposal when baseline is unchanged',t=>{
  const f=fixture(t);note(f);const {s,run}=prepared(f),j=judgment(f,s,run);journalCrash(f,s,run,j,{...f.base,alias:'project'});
  assert.equal(retry(s).processed,true);assert.equal(complete(s,run.id).processed,true);assert.equal(loadStatus(s).processed.length,1);
  assert.deepEqual(tree(f.base.path),readJSON(readRun(s,run.id).receipts.project.proposal).after);
});
test('custody R2 installed journal before publishing receipt blocks rejudgment and recovers',t=>{
  const f=fixture(t);note(f);const {s,run}=prepared(f),j=judgment(f,s,run),before=tree(f.base.path);journalCrash(f,s,run,j,{...f.base,alias:'project'},'after-install');
  assert.deepEqual(tree(f.base.path),before);assert.throws(()=>retry(s,{rejudge:true}),/publication pending/);
  assert.throws(()=>readAccepted(s),/publication pending/);
  assert.equal(retry(s).processed,true);assert.equal(loadStatus(s).processed.length,1);
});
for(const firstAction of ['retry','rejudge']) test(`custody R2 partial accepted delivery survives pre-journal death and outstanding ${firstAction}`,t=>{
  const f=fixture(t),bindings=secondDirectory(f,{owned:true}),second=bindings.bases.secondary;note(f);const {s,run}=prepared(f),j=judgment(f,s,run),first=readJSON(j);
  judgment(f,s,run,{base:'secondary'});first.outcomes[0].concepts.push(...readJSON(j).outcomes[0].concepts);save(j,first);
  journalCrash(f,s,run,j,{...second,alias:'secondary'});
  const pending=readRun(s,run.id),receipt=structuredClone(pending.receipts.project),accepted=tree(f.base.path);
  assert.equal(receipt.status,'accepted');assert.equal(fs.existsSync(journalPath(f.base)),false);assert.deepEqual(loadStatus(s).processed,[]);
  withLock(baseLock(second),()=>fs.appendFileSync(join(second.path,'peer/log.md'),'new cooperative baseline\n'));
  if(firstAction==='retry') assert.throws(()=>retry(s),/directory base changed/);
  const result=retry(s,{rejudge:true});assert.equal(result.rejudged,true);assert.deepEqual(result.outstanding,['secondary']);assert.deepEqual(result.settled,['project']);
  const next=readRun(s,run.id);assert.deepEqual(next.receipts.project,receipt);assert.deepEqual(next.inputs,run.inputs);
  assert.ok(fs.existsSync(next.history[0]));assert.ok(fs.existsSync(pending.receipts.secondary.proposal));
  const completed=complete(s,run.id,judgment(f,s,next,{base:'secondary'}));assert.equal(completed.processed,true);assert.deepEqual(completed.receipts.project,receipt);
  assert.deepEqual(tree(f.base.path),accepted);assert.match(fs.readFileSync(join(second.path,'peer/log.md'),'utf8'),/new cooperative baseline/);
  assert.equal(complete(s,run.id).processed,true);assert.equal(loadStatus(s).processed.length,1);
});
test('custody R2 missing write-authorized journal is uncertain, never safe to abandon or replay',t=>{
  const f=fixture(t);note(f);const {s,run}=prepared(f),j=judgment(f,s,run);
  assert.throws(()=>complete(s,run.id,j,{afterWrite:()=>{throw new Error('partial publication');}}),/partial publication/);
  const pending=readRun(s,run.id),jp=journalPath(f.base),journal=fs.readFileSync(jp),partial=tree(f.base.path);
  assert.equal(pending.receipts.project.status,'publishing');
  // Emulate loss/removal OUTSIDE the cooperative protocol. Absence must not be
  // treated as proof of no writes once the write-authorized receipt exists.
  fs.rmSync(jp);
  for(const opts of [{},{rejudge:true}]) assert.throws(()=>retry(s,opts),/journal missing after writes were authorized/);
  assert.deepEqual(tree(f.base.path),partial);assert.deepEqual(loadStatus(s).processed,[]);assert.equal(loadStatus(s).activeRun,run.id);
  put(jp,journal);
  // Already accepted individual bytes are not atomically replaced a second time.
  const proposal=readJSON(pending.receipts.project.proposal),done=proposal.changed.filter(p=>partial[p]===proposal.after[p]);assert.ok(done.length);
  renameFailure((from,to)=>done.some(p=>to===join(f.base.path,p)),()=>assert.equal(retry(s).processed,true));
  assert.deepEqual(tree(f.base.path),proposal.after);assert.equal(loadStatus(s).processed.length,1);
});
test('custody R2 durable accepted receipt with pending journal requires cleanup only, no accepted rewrites',t=>{
  const f=fixture(t);note(f);const {s,run}=prepared(f),j=judgment(f,s,run);
  assert.throws(()=>complete(s,run.id,j,{afterWrite:()=>{throw new Error('partial publication');}}),/partial publication/);
  const current=readRun(s,run.id),r=current.receipts.project,p=readJSON(r.proposal);
  assert.throws(()=>directoryPublish(f.base,p,r,()=>{save(join(dirname(s.file),'runs',run.id,'run.json'),current);if(r.status==='accepted')throw new Error('receipt durable, cleanup interrupted');}),/cleanup interrupted/);
  const accepted=tree(f.base.path),receipt=structuredClone(r);
  renameFailure((from,to)=>to.startsWith(f.base.path+'/'),()=>assert.equal(retry(s).processed,true));
  assert.deepEqual(tree(f.base.path),accepted);assert.deepEqual(readRun(s,run.id).receipts.project,receipt);assert.equal(fs.existsSync(journalPath(f.base)),false);assert.equal(loadStatus(s).processed.length,1);
});

// Custody R3: content authorization never grants executable-bit ownership.
// These are real disposable Git repositories; gh, configs and faults are local.
for(const root of ['knowledge','.']) for(const mask of ['ordinary','hidden','remove-executable']) test(`custody R3 ${root} ${mask} peer mode-only edit is rejected before publication`,t=>{
  const f=fixture(t,{kind:'git',root}),prefix=root==='.'?'':root+'/';
  if(mask==='remove-executable') {fs.chmodSync(join(f.repo,prefix+'peer/log.md'),0o755);fixtureCommit(f.repo,'accepted executable peer file');}
  note(f);const {s,run}=prepared(f),j=judgment(f,s,run),cwd=run.stages.project.checkout,path=prefix+'peer/log.md';
  fs.chmodSync(join(cwd,path),mask==='remove-executable'?0o644:0o755);
  if(mask==='hidden') {
    git(cwd,['config','core.fileMode','false']);git(cwd,['update-index','--assume-unchanged','--skip-worktree','--',path]);
    assert.equal(git(cwd,['diff','--summary','--',path]),'','ordinary Git status can conceal the mode change');
  } else assert.match(git(cwd,['diff','--summary','--',path]),/mode change/);
  assert.throws(()=>complete(s,run.id,j),e=>e.code==='E_OWNER' && /Git file mode/.test(e.message));noPublication(f,s);
  assert.equal(readRun(s,run.id).judgment,undefined,'reject before freezing or publishing any destination');
});
test('custody R3 all-drop does not certify a worker that changed peer file modes',t=>{
  const f=fixture(t,{kind:'git'});note(f);const {s,run}=prepared(f),j=judgment(f,s,run,{drop:true});
  fs.chmodSync(join(run.stages.project.root,'peer/log.md'),0o755);
  assert.throws(()=>complete(s,run.id,j),{code:'E_OWNER'});noPublication(f,s);
});
function entryMode(repo,oid,path) {return git(repo,['--no-replace-objects','ls-tree',oid,'--',path]).split(' ')[0];}
function indexBoundaryProbe(f,stage,race=null) {
  const scratch=join(f.dir,'index-probe-tmp');fs.mkdirSync(scratch);
  const module=new URL('../oats-package/capabilities/oats-okf/lib/stores.mjs',import.meta.url).href;
  const code=`import fs from 'node:fs';import {spawnSync} from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';import {verifyGitScope} from ${JSON.stringify(module)};
const index=${JSON.stringify(join(stage.checkout,'.git/index'))},race=${JSON.stringify(race)},observed={race:false,opened:false,closed:false,reads:0,nonblock:false,nofollow:false};
const open=fs.openSync,close=fs.closeSync,read=fs.readSync;let indexFd;
fs.openSync=(path,flags,...rest)=>{
  if(path===index){
    observed.nonblock=typeof flags==='number'&&(flags&fs.constants.O_NONBLOCK)!==0;observed.nofollow=typeof flags==='number'&&(flags&fs.constants.O_NOFOLLOW)!==0;
    if(race&&!observed.race){observed.race=true;
      if(race==='ancestor-race'){const dir=index.slice(0,index.lastIndexOf('/'));fs.renameSync(dir,dir+'-original');fs.symlinkSync(dir+'-original',dir);}
      else {fs.renameSync(index,index+'.before-race');if(race==='fifo-race'){const r=spawnSync('/usr/bin/mkfifo',[index]);if(r.status!==0)throw new Error('fixture mkfifo failed');}else if(race==='symlink-race')fs.symlinkSync(index+'.before-race',index);else fs.writeFileSync(index,'DO_NOT_READ_REPLACEMENT');}
    }
  }
  const fd=open(path,flags,...rest);if(path===index){indexFd=fd;observed.opened=true;}return fd;
};
fs.readSync=(fd,...rest)=>{if(fd===indexFd)observed.reads++;return read(fd,...rest);};
fs.closeSync=fd=>{if(fd===indexFd)observed.closed=true;return close(fd);};syncBuiltinESMExports();
let answer;try{verifyGitScope(${JSON.stringify(f.base)},${JSON.stringify(stage.checkout)},${JSON.stringify(stage.head)});answer={ok:true};}catch(error){answer={ok:false,code:error.code,message:error.message};}
process.stdout.write(JSON.stringify({...answer,observed})+'\\n');`;
  const result=spawnSync(process.execPath,['--input-type=module','-e',code],{cwd:f.context,env:{...process.env,TMPDIR:scratch},encoding:'utf8',timeout:5000,killSignal:'SIGKILL',maxBuffer:1024*1024});
  let answer;try{answer=JSON.parse(result.stdout);}catch{}
  return {...result,answer,scratch};
}

test('index copy boundary refuses split dependencies without freshening original backing files',t=>{
  const f=fixture(t,{kind:'git'}),stage=stageBase(f.base,join(f.dir,'index-stage')),gitdir=join(stage.checkout,'.git'),index=join(gitdir,'index');
  git(stage.checkout,['update-index','--split-index']);
  const shared=fs.readdirSync(gitdir).filter(name=>/^sharedindex\.[a-f0-9]+$/.test(name)).map(name=>join(gitdir,name));assert.ok(shared.length);
  const original=fs.readFileSync(index),contents=shared.map(path=>fs.readFileSync(path));
  for(const path of shared)fs.utimesSync(path,new Date('2000-01-01T00:00:00Z'),new Date('2000-01-02T00:00:00Z'));
  const stat=path=>{const s=fs.statSync(path,{bigint:true});return {atime:s.atimeNs,mtime:s.mtimeNs,ctime:s.ctimeNs,ino:s.ino};};
  const before=shared.map(stat),calls=join(f.dir,'index-native-calls.jsonl');
  gitWrapper(f,`fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify({args:a,gitdir:process.env.GIT_DIR||null,index:process.env.GIT_INDEX_FILE||null})+'\\n');`);
  const result=indexBoundaryProbe(f,stage),after=shared.map(stat);
  assert.deepEqual(after,before,'native split-index parsing must not freshen original sharedindex timestamps');
  assert.equal(result.status,0,result.stderr);assert.equal(result.answer?.code,'E_INDEX',result.stdout);
  assert.deepEqual(fs.readFileSync(index),original);shared.forEach((path,i)=>assert.deepEqual(fs.readFileSync(path),contents[i]));
  const native=fs.readFileSync(calls,'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(native.some(({args})=>args.includes('diff')),false,'unsupported split input refuses before original-gitdir verification');
  assert.ok(native.some(({args,gitdir:dir,index:copy})=>args.includes('--shared-index-path')&&dir?.startsWith(result.scratch+'/')&&copy?.startsWith(result.scratch+'/')),'dependency read context is private, not only the primary index filename');
  assert.deepEqual(fs.readdirSync(result.scratch),[],'private preflight scratch is removed');
});

for(const condition of ['fifo','directory','symlink','fifo-race','symlink-race','regular-race','ancestor-race','oversized']) test(`index copy boundary safely refuses ${condition}`,t=>{
  const f=fixture(t,{kind:'git'}),stage=stageBase(f.base,join(f.dir,'index-stage')),index=join(stage.checkout,'.git/index'),original=fs.readFileSync(index),race=condition.endsWith('-race')?condition:null;
  if(!race){
    fs.renameSync(index,index+'.original');
    if(condition==='fifo')execFileSync('/usr/bin/mkfifo',[index]);
    else if(condition==='directory')fs.mkdirSync(index);
    else if(condition==='symlink')fs.symlinkSync(index+'.original',index);
    else {const fd=fs.openSync(index,'wx');try{fs.ftruncateSync(fd,16*1024*1024+1);}finally{fs.closeSync(fd);}}
  }
  const result=indexBoundaryProbe(f,stage,race);
  assert.equal(result.status,0,`${condition} must return before subprocess timeout: ${result.error?.code||result.stderr}`);
  assert.equal(result.answer?.code,'E_INDEX',result.stdout);assert.doesNotMatch(result.stdout,/DO_NOT_READ_REPLACEMENT/);
  const observed=result.answer.observed;assert.equal(observed.reads,0,'no special/replaced/oversize source bytes read');
  if(race){assert.equal(observed.race,true);assert.equal(observed.nonblock,true);assert.equal(observed.nofollow,true);}
  if(observed.opened)assert.equal(observed.closed,true,'rejected acquired descriptor is closed');
  const saved=race?(condition==='ancestor-race'?join(stage.checkout,'.git-original/index'):index+'.before-race'):index+'.original';
  assert.deepEqual(fs.readFileSync(saved),original,'the original regular index is preserved by the fixture and never rewritten');
  assert.deepEqual(fs.readdirSync(result.scratch),[],'bounded failure cleans only its private scratch');
});

test('custody R3 worker index mode-only entries are preserved but cannot contaminate publication',t=>{
  const f=fixture(t,{kind:'git'});note(f);const {s,run}=prepared(f),j=judgment(f,s,run),cwd=run.stages.project.checkout,path='knowledge/peer/log.md';
  git(cwd,['update-index','--chmod=+x','--',path]);
  const index=fs.readFileSync(join(cwd,'.git/index')),probes=join(f.dir,'scope-index-reads.jsonl');
  // Observe the real Git reads individually, not an index restored afterward.
  gitWrapper(f,`if(a.includes('diff')) {const p=cwd+'/.git/index',before=fs.readFileSync(p);const r=spawnSync(real,a,{stdio:'inherit'});fs.appendFileSync(${JSON.stringify(probes)},JSON.stringify({args:a,indexUnchanged:before.equals(fs.readFileSync(p)),privateIndex:process.env.GIT_INDEX_FILE||null})+'\\n');process.exit(r.status ?? 1);}`);
  assert.equal(git(cwd,['ls-files','--stage','--',path]).split(' ')[0],'100755');
  const r=complete(s,run.id,j);assert.equal(r.processed,true);
  assert.equal(entryMode(f.repo,r.receipts.project.commit,path),'100644');
  assert.deepEqual(fs.readFileSync(join(cwd,'.git/index')),index,'worker index remains byte-for-byte intact');
  const reads=fs.readFileSync(probes,'utf8').trim().split('\n').map(JSON.parse);
  assert.ok(reads.some(({args})=>args.includes('--cached')) && reads.some(({args})=>!args.includes('--cached')));
  assert.ok(reads.every(({args,indexUnchanged,privateIndex})=>indexUnchanged && args.includes('--no-optional-locks') && privateIndex && privateIndex!==join(cwd,'.git/index')),'native scope reads never write the worker index');
  assert.ok(reads.every(({privateIndex})=>!fs.existsSync(dirname(privateIndex))),'verification copies are removed, not retained as another worker/publication index');
});
test('custody R3 late mode edits cannot enter the private index; add scope is the exact validated content delta',t=>{
  const f=fixture(t,{kind:'git'});note(f);const {s,run}=prepared(f),j=judgment(f,s,run),cwd=run.stages.project.checkout;
  const calls=join(f.dir,'private-adds.jsonl');
  gitWrapper(f,`if(a.includes('read-tree') && process.env.GIT_INDEX_FILE) {fs.chmodSync(cwd+'/knowledge/peer/log.md',0o755);fs.chmodSync(cwd+'/knowledge/expert/decision.md',0o755);execFileSync(real,['-C',cwd,'config','core.fileMode','false']);}if(a.includes('add') && process.env.GIT_INDEX_FILE)fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify(a)+'\\n');`);
  const r=complete(s,run.id,j);assert.equal(r.processed,true);
  const paths=fs.readFileSync(calls,'utf8').trim().split('\n').map(JSON.parse).flatMap(a=>{assert.ok(a.includes('--literal-pathspecs'));return a.slice(a.indexOf('--')+1);});
  assert.deepEqual(paths.sort(),['knowledge/expert/decision.md','knowledge/expert/index.md','knowledge/expert/log.md']);
  for(const path of ['knowledge/peer/log.md','knowledge/expert/decision.md']) assert.equal(entryMode(f.repo,r.receipts.project.commit,path),'100644');
  assert.equal(fs.statSync(join(cwd,'knowledge/peer/log.md')).mode & 0o100,0o100,'late worker modes are not rewritten');
});
for(const path of ['knowledge/peer/log.md','knowledge/expert/decision.md']) test(`custody R3 final publication tree rejects injected mode for ${path}`,t=>{
  const f=fixture(t,{kind:'git'});note(f);const {s,run}=prepared(f),j=judgment(f,s,run);
  gitWrapper(f,`if(a.includes('write-tree') && process.env.GIT_INDEX_FILE) execFileSync(real,['-C',cwd,'update-index','--chmod=+x','--',${JSON.stringify(path)}]);`);
  assert.throws(()=>complete(s,run.id,j),{code:'E_OWNER'});noPublication(f,s);
  assert.equal(readRun(s,run.id).receipts.project.commit,undefined);
});
for(const path of ['knowledge/peer/log.md','knowledge/expert/decision.md']) test(`custody R3 raw commit and retry reject replacement-hidden mode for ${path}`,t=>{
  const f=fixture(t,{kind:'git'});note(f);const {s,run}=prepared(f),j=judgment(f,s,run);
  gitWrapper(f,`if(a.includes('commit-tree')) {const good=execFileSync(real,a,{encoding:'utf8'}).trim();execFileSync(real,['-C',cwd,'add','--all']);execFileSync(real,['-C',cwd,'update-index','--chmod=+x','--',${JSON.stringify(path)}]);const badArgs=[...a];badArgs[badArgs.indexOf('commit-tree')+1]=execFileSync(real,['-C',cwd,'write-tree'],{encoding:'utf8'}).trim();const bad=execFileSync(real,badArgs,{encoding:'utf8'}).trim();execFileSync(real,['-C',cwd,'replace',bad,good]);console.log(bad);process.exit(0);}`);
  assert.throws(()=>complete(s,run.id,j),{code:'E_OWNER'});noPublication(f,s);
  const receipt=readRun(s,run.id).receipts.project;assert.equal(receipt.status,'committed');
  fs.rmSync(join(f.dir,'bin/git'));
  assert.throws(()=>retry(s),{code:'E_OWNER'});noPublication(f,s);
});
test('custody R3 recovery rebuilds the same commit and preserves accepted executable modes despite materialization',t=>{
  const f=fixture(t,{kind:'git'}),paths=['code.txt','knowledge/peer/log.md','knowledge/expert/log.md'];
  for(const path of paths) fs.chmodSync(join(f.repo,path),0o755);
  fixtureCommit(f.repo,'accepted executable files');note(f);const {s,run}=prepared(f),j=judgment(f,s,run);
  const committed=join(f.dir,'unrecorded-commit');
  gitWrapper(f,`if(a.includes('commit-tree') && !fs.existsSync(${JSON.stringify(committed)})) {const oid=execFileSync(real,a,{encoding:'utf8'}).trim();fs.writeFileSync(${JSON.stringify(committed)},oid);process.exit(73);}`);
  assert.throws(()=>complete(s,run.id,j),/failed/);noPublication(f,s);
  assert.equal(readRun(s,run.id).receipts.project.status,'commit-intent');
  fs.rmSync(run.worker.home,{recursive:true});
  const r=retry(s);assert.equal(r.processed,true);assert.equal(r.receipts.project.commit,fs.readFileSync(committed,'utf8'));
  for(const path of paths) assert.equal(entryMode(f.repo,r.receipts.project.commit,path),'100755',path);
  assert.equal(entryMode(f.repo,r.receipts.project.commit,'knowledge/expert/decision.md'),'100644');
});
test('custody R3 content-only Git migration preserves executable peer and changed-node baseline modes',t=>{
  const f=fixture(t,{kind:'git'}),paths=['knowledge/peer/log.md','knowledge/expert/index.md'];
  for(const path of paths) fs.chmodSync(join(f.repo,path),0o755);
  fixtureCommit(f.repo,'accepted executable files');
  const legacy=join(f.soul,'knowledge');fs.cpSync(join(f.repo,'knowledge/expert'),legacy,{recursive:true});
  put(join(legacy,'index.md'),'---\nokf_version: "0.1"\n---\n\n# Migrated expertise\n');
  const m=migrate(f.bindings,{legacy,alias:'project',node:'expert',output:join(f.dir,'migration-stage')});
  const receipt=deliverMigration(m.migration);assert.equal(receipt.status,'delivered');
  for(const path of paths) assert.equal(entryMode(f.repo,receipt.commit,path),'100755',path);
});
test('custody R3 exact content staging supports deletion and literal metacharacters in concept paths',t=>{
  const f=fixture(t,{kind:'git'}),old='expert/obsolete.md';
  put(join(f.repo,'knowledge',old),'---\ntype: Decision\ntitle: Obsolete\ndescription: Previous decision.\n---\n\nPrevious rationale.\n');
  fs.appendFileSync(join(f.repo,'knowledge/expert/index.md'),'* [Obsolete](obsolete.md) - Previous decision.\n');fixtureCommit(f.repo,'previous expertise');
  note(f);const {s,run}=prepared(f),j=judgment(f,s,run),root=run.stages.project.root,next='expert/decision[one].md';
  fs.renameSync(join(root,'expert/decision.md'),join(root,next));fs.rmSync(join(root,old));
  const index=join(root,'expert/index.md');put(index,fs.readFileSync(index,'utf8').replace('* [Obsolete](obsolete.md) - Previous decision.\n','').replace('(decision.md)','(decision[one].md)'));
  const judgmentFile=readJSON(j);judgmentFile.outcomes[0].concepts[0].path=next;judgmentFile.removals=[{base:'project',path:old,reason:'Replaced by the accepted current decision.'}];save(j,judgmentFile);
  const r=complete(s,run.id,j);assert.equal(r.processed,true);
  assert.equal(git(f.repo,['ls-tree','-r','--name-only',r.receipts.project.commit]).includes('knowledge/'+old),false);
  assert.match(git(f.repo,['show',`${r.receipts.project.commit}:knowledge/${next}`]),/Evidence: OKF input/);
});

// Inspection-only compatibility. No capture/worker protocol changes.
function externalView(f,cmd,args=[]) {
  const r=spawnSync(process.execPath,[CLI,cmd,...args,'--json'],{cwd:f.context,env:{...process.env,OATS_HOME:f.context,OATS_INSTANCE_HOME:f.context},encoding:'utf8',timeout:30000,maxBuffer:16*1024*1024});
  assert.equal(r.status,0,r.stdout+r.stderr);const out=JSON.parse(r.stdout);assert.equal(out.ok,true);return out.result;
}
test('inspect preserves the explicit 256 KiB document preview and UTF-8 boundary contract',t=>{
  const f=fixture(t);f.source();const text='x'.repeat(256*1024-1)+'α trailing bytes';put(join(f.home,'STATE.md'),text);
  const r=f.cli('inspect');assert.equal(r.status,0,r.stdout);const d=r.out.result.documents[0];
  assert.equal(d.text,'x'.repeat(256*1024-1));assert.equal(d.truncated,true);assert.equal(d.bytes,Buffer.byteLength(text));
  assert.doesNotMatch(d.text,/\uFFFD/);assert.equal(r.out.result.documents.at(-1).label,'Durable processing receipts');
});
for(const mode of ['retired','missing-home','missing-marker','reused-marker','reused-metadata','invalid-marker','invalid-metadata','symlink-home']) test(`inspect keeps durable receipts without exposing ${mode} live memory`,t=>{
  const f=fixture(t),s=f.source();note(f);capture(s,{final:mode==='retired'});
  if(mode==='missing-home') fs.rmSync(f.home,{recursive:true});
  else if(mode==='missing-marker') fs.unlinkSync(join(f.home,'.okf-source.json'));
  else if(mode==='reused-marker') save(join(f.home,'.okf-source.json'),{version:1,id:'00000000-0000-0000-0000-000000000000',source:join(f.dir,'untrusted.json')});
  else if(mode==='reused-metadata') save(join(f.home,'instance.json'),{agent:'other',instance:s.instance});
  else if(mode==='invalid-marker') put(join(f.home,'.okf-source.json'),'DO_NOT_EXPOSE_REPLACEMENT_OR_RETIRED_HOME');
  else if(mode==='invalid-metadata') put(join(f.home,'instance.json'),'DO_NOT_EXPOSE_REPLACEMENT_OR_RETIRED_HOME');
  else if(mode==='symlink-home') {fs.renameSync(f.home,join(f.context,'moved-home'));fs.symlinkSync(join(f.context,'moved-home'),f.home);}
  if(mode!=='missing-home') put(join(f.home,'STATE.md'),'DO_NOT_EXPOSE_REPLACEMENT_OR_RETIRED_HOME');
  const r=externalView(f,'inspect',['--source',s.file]);assert.equal(r.liveMemory.available,false);
  assert.equal(r.status.captured.inputs.length,1);assert.equal(r.documents.length,1);assert.equal(r.documents[0].kind,'text');
  assert.deepEqual(r.status,loadStatus(s));assert.deepEqual(r.acceptedView,s.acceptedView);assert.deepEqual(r.bases,s.bindings.bases);
  assert.doesNotMatch(JSON.stringify(r),/DO_NOT_EXPOSE_REPLACEMENT_OR_RETIRED_HOME/);
  assert.match(r.summary,/live memory unavailable/);
});
for(const mode of ['state-symlink','state-hardlink','state-directory','note-symlink','notes-symlink','note-hardlink','notes-file']) test(`inspect fails explicitly for unsafe live documents: ${mode}`,t=>{
  const f=fixture(t),s=f.source(),secret=join(f.dir,'secret');put(secret,'DO_NOT_EXPOSE_UNSAFE_DOCUMENT');
  const state=join(f.home,'STATE.md'),notes=join(f.home,'notes');
  if(mode.startsWith('state-')) {
    fs.unlinkSync(state);
    if(mode==='state-symlink') fs.symlinkSync(secret,state);
    else if(mode==='state-hardlink') fs.linkSync(secret,state);
    else fs.mkdirSync(state);
  } else if(mode==='note-symlink') fs.symlinkSync(secret,join(notes,'secret.md'));
  else if(mode==='note-hardlink') fs.linkSync(secret,join(notes,'secret.md'));
  else {fs.rmSync(notes,{recursive:true});if(mode==='notes-symlink') fs.symlinkSync(f.dir,notes);else put(notes,'not a directory');}
  const r=f.cli('inspect',['--source',s.file]);assert.equal(r.status,1,r.stdout);assert.equal(r.out.ok,false);
  assert.equal(r.out.error.code,mode==='notes-file'?'E_INSPECT_FAILED':'E_PATH');assert.equal(r.out.result,undefined);
  assert.doesNotMatch(r.stdout,/DO_NOT_EXPOSE_UNSAFE_DOCUMENT/);assert.equal(loadStatus(s).processed.length,0);
});
test('inspect tolerates absent live documents, but not a malformed durable descriptor',t=>{
  const f=fixture(t),s=f.source();for(const p of ['STATE.md','log.md','notes']) fs.rmSync(join(f.home,p),{recursive:true});
  const r=f.cli('inspect');assert.equal(r.status,0,r.stdout);assert.equal(r.out.result.liveMemory.available,true);assert.equal(r.out.result.documents.length,1);
  const bad=join(f.dir,'bad-source.json');save(bad,{version:1,id:s.id,bindings:s.bindings});
  const broken=f.cli('inspect',['--source',bad]);assert.equal(broken.status,1);assert.equal(broken.out.error.code,'E_SOURCE');
  const ambiguous=f.cli('inspect',['--source',s.file,'--home',f.home]);assert.equal(ambiguous.status,1);assert.equal(ambiguous.out.error.code,'E_USAGE');
});
test('inspect drops every live document if the matching home is replaced during the read',async t=>{
  const f=fixture(t),s=f.source();put(join(f.home,'notes/a.md'),'original note');
  const {workingDocuments}=await mod('inspection'),native=await import('node:fs');const original=native.default.readdirSync;
  native.default.readdirSync=function(path,...args) {
    if(path===join(f.home,'notes')) {
      fs.renameSync(f.home,join(f.context,'old-home'));fs.mkdirSync(join(f.home,'notes'),{recursive:true});
      save(join(f.home,'.okf-source.json'),{version:1,id:s.id,source:s.file});
      put(join(f.home,'notes/replacement.md'),'DO_NOT_EXPOSE_RACING_REPLACEMENT');
    }
    return original(path,...args);
  };syncBuiltinESMExports();
  try {const result=workingDocuments(s);assert.equal(result.liveMemory.reason,'home-changed');assert.deepEqual(result.documents,[]);}
  finally {native.default.readdirSync=original;syncBuiltinESMExports();}
});
for(const mode of ['live','retired','missing','reused']) test(`descriptor-selected consult reads write nothing anywhere: ${mode}`,t=>{
  const f=fixture(t),s=f.source();
  if(mode==='retired') capture(s,{final:true});
  if(mode==='missing' || mode==='reused') fs.rmSync(f.home,{recursive:true});
  if(mode==='reused') {put(join(f.home,'STATE.md'),'replacement home');save(join(f.home,'.okf-source.json'),{version:1,id:'replacement',source:'untrusted'});}
  const before=fs.readdirSync(f.context).sort(),homeFiles=fs.existsSync(f.home)?fs.readdirSync(f.home).sort():null;
  const sourceFiles=fs.readdirSync(dirname(s.file)).sort();
  const read=externalView(f,'cat',['--source',s.file,'--base','project','expert/index.md']);
  assert.equal(read.path,'expert/index.md');assert.equal(read.text,fs.readFileSync(join(f.base.path,'expert/index.md'),'utf8'));
  assert.equal(externalView(f,'cat',['--source',s.file,'--base','project','/expert/index.md']).text,read.text);
  const refresh=spawnSync(process.execPath,[CLI,'refresh','--source',s.file,'--json'],{cwd:f.context,env:{...process.env,OATS_HOME:f.context,OATS_INSTANCE_HOME:f.context},encoding:'utf8'});
  assert.equal(JSON.parse(refresh.stdout).error.code,'E_REMOVED');
  assert.deepEqual(fs.readdirSync(f.context).sort(),before);assert.deepEqual(fs.existsSync(f.home)?fs.readdirSync(f.home).sort():null,homeFiles);
  assert.deepEqual(fs.readdirSync(dirname(s.file)).sort(),sourceFiles,'no views/ cache under the durable source either');
});
test('descriptor-selected reads still reject traversal and non-Markdown paths',t=>{
  const f=fixture(t),s=f.source();capture(s,{final:true});
  for(const [path,code] of [['../../../../status.json','E_PATH'],['../view.json','E_PATH'],['okf-base.json','E_NOT_MARKDOWN']]) {const r=f.cli('cat',['--source',s.file,'--base','project',path]);assert.equal(r.status,1);assert.equal(r.out.error.code,code,path);}
  assert.equal(fs.readdirSync(f.home).some(p=>p.startsWith('knowledge-view-')),false);
});

function descriptorCLI(f,cmd,args=[]) {
  const r=spawnSync(process.execPath,[CLI,cmd,...args,'--json'],{cwd:f.context,env:process.env,encoding:'utf8',timeout:30000,maxBuffer:16*1024*1024});
  return {...r,out:JSON.parse(r.stdout)};
}

test('closed proposal recovery: delivered then worker/source deleted then later closed can explicitly rejudge retained evidence',t=>{
  const f=fixture(t,{kind:'git'});note(f);const {s,run}=prepared(f);
  capture(s,{final:true});
  const delivered=complete(s,run.id,judgment(f,s,run));assert.equal(delivered.receipts.project.status,'delivered');
  assert.equal(loadStatus(s).activeRun,null);assert.deepEqual(loadStatus(s).processed,run.inputs);
  fs.rmSync(run.worker.home,{recursive:true});fs.rmSync(f.home,{recursive:true});
  const prs=readJSON(join(f.dir,'pr.json'));prs[0].state='CLOSED';save(join(f.dir,'pr.json'),prs);
  const reconcile=descriptorCLI(f,'complete',['--source',s.file,'--run',run.id]);assert.equal(reconcile.status,1);assert.match(reconcile.out.error.message,/closed without merge/);
  assert.equal(readRun(s,run.id).receipts.project.status,'rejected');
  const automatic=descriptorCLI(f,'retry',['--source',s.file]);assert.equal(automatic.status,0);assert.equal(automatic.out.result.status,'empty','ordinary retry never automatically resubmits rejected input');
  const recovered=descriptorCLI(f,'retry',['--source',s.file,'--run',run.id,'--rejudge']);
  assert.equal(recovered.status,0,recovered.stdout+recovered.stderr);assert.equal(recovered.out.result.status,'ready');
  assert.notEqual(recovered.out.result.run,run.id);
  const result=recovered.out.result,next=readRun(s,result.run),previous=readRun(s,run.id);
  assert.deepEqual(next.inputs,run.inputs);assert.equal(next.recoveryOf,run.id);assert.equal(next.noLaunch,true);
  assert.deepEqual(readJSON(join(next.worker.home,'work/input.json')).inputs.map(i=>i.id),run.inputs);
  assert.deepEqual(readJSON(join(next.worker.home,'work/previous.json')),previous);
  assert.equal(fs.existsSync(join(next.stages.project.root,'expert/decision.md')),false,'rejected content is not restored to fresh staging');
  const proposal=fs.readFileSync(previous.receipts.project.proposal),oldReceipt=structuredClone(previous.receipts.project);
  const evidence=tree(join(dirname(s.file),'runs',run.id,'receipt-history'));
  assert.ok(Object.values(evidence).map(v=>JSON.parse(Buffer.from(v,'base64'))).some(r=>r.status==='delivered'));
  assert.ok(Object.values(evidence).map(v=>JSON.parse(Buffer.from(v,'base64'))).some(r=>r.status==='rejected'));
  assert.equal(readJSON(join(f.dir,'pr.json')).length,1,'recovery only scaffolds; no publication without fresh judgment');
  const repeated=descriptorCLI(f,'retry',['--source',s.file,'--run',run.id,'--rejudge']);assert.equal(repeated.status,0);assert.equal(repeated.out.result.run,next.id);assert.equal(repeated.out.result.existing,true);
  const j=judgment(f,s,next);fs.appendFileSync(join(next.stages.project.root,'expert/decision.md'),'Fresh human-reviewed correction, not automatic replay.\n');
  const completed=descriptorCLI(f,'complete',['--source',s.file,'--run',next.id,'--judgment',j]);assert.equal(completed.status,0,completed.stdout);assert.equal(completed.out.result.processed,true);
  const receipt=completed.out.result.receipts.project;assert.equal(receipt.status,'delivered');assert.notEqual(receipt.branch,oldReceipt.branch);assert.notEqual(receipt.commit,oldReceipt.commit);
  assert.equal(readJSON(join(f.dir,'pr.json')).length,2);assert.equal(git(f.repo,['rev-parse',oldReceipt.branch]),oldReceipt.commit);
  assert.deepEqual(readRun(s,run.id),previous);assert.deepEqual(fs.readFileSync(oldReceipt.proposal),proposal);assert.deepEqual(tree(join(dirname(s.file),'runs',run.id,'receipt-history')),evidence);
  assert.equal(loadStatus(s).activeRun,null);assert.deepEqual(loadStatus(s).processed,run.inputs);
  assert.equal(descriptorCLI(f,'retry',['--source',s.file,'--run',run.id,'--rejudge']).out.result.run,next.id,'a settled successor is not duplicated either');
  assert.equal(descriptorCLI(f,'complete',['--source',s.file,'--run',run.id]).out.error.code,'E_RECOVERY','old completion cannot republish a superseded proposal');
});

function closePR(f,number,state='CLOSED') {const rows=readJSON(join(f.dir,'pr.json'));rows.find(p=>p.number===number).state=state;save(join(f.dir,'pr.json'),rows);}
function closedOriginal(t,{withSettled=false}={}) {
  const f=fixture(t,{kind:'git'});if(withSettled) secondDirectory(f);note(f);const {s,run}=prepared(f);capture(s,{final:true});
  complete(s,run.id,judgment(f,s,run));fs.rmSync(f.home,{recursive:true});fs.rmSync(run.worker.home,{recursive:true});closePR(f,1);
  const recovered=retry(s,{run:run.id,rejudge:true});return {f,s,original:readRun(s,run.id),next:readRun(s,recovered.run)};
}
test('closed proposal recovery: partial rejudgment guards every intermediate PR, not only the original',t=>{
  const {f,s,next}=closedOriginal(t,{withSettled:true});
  put(join(f.dir,'gh-uncertain'),'1');assert.throws(()=>complete(s,next.id,judgment(f,s,next)),/failed/);fs.rmSync(join(f.dir,'gh-uncertain'));
  assert.equal(readRun(s,next.id).receipts.project.status,'pr-unknown');closePR(f,2);
  assert.deepEqual(retry(s,{rejudge:true}).settled,['secondary']);const partial=readRun(s,next.id);
  assert.equal(partial.history.length,1);assert.equal(partial.recoveryGuards.length,2);
  closePR(f,2,'OPEN');assert.throws(()=>complete(s,partial.id,judgment(f,s,partial)),/open\/merged PR/);
  assert.equal(readJSON(join(f.dir,'pr.json')).length,2);assert.equal(readRun(s,next.id).judgment,undefined);
});
for(const boundary of ['proposal','push']) test(`closed proposal recovery: rechecks ancestor after ${boundary} before new PR creation`,t=>{
  const {f,s,next}=closedOriginal(t);const j=judgment(f,s,next);let reopened=false;
  const rename=fs.default.renameSync;
  fs.default.renameSync=(from,to)=>{
    const result=rename(from,to);
    if(!reopened && ((boundary==='proposal' && to===join(dirname(s.file),'runs',next.id,'project-proposal.json')) || (boundary==='push' && to===join(dirname(s.file),'runs',next.id,'run.json') && readJSON(to).receipts.project?.status==='pushed'))) {closePR(f,1,'OPEN');reopened=true;}
    return result;
  };syncBuiltinESMExports();
  try {assert.throws(()=>complete(s,next.id,j),/open\/merged PR/);} finally {fs.default.renameSync=rename;syncBuiltinESMExports();}
  assert.equal(reopened,true);assert.equal(readJSON(join(f.dir,'pr.json')).length,1);
});
test('closed proposal recovery: abandon and ordinary rerun retain replacement lineage',t=>{
  const f=fixture(t,{kind:'git'});note(f);const {s,run}=prepared(f);
  put(join(f.dir,'gh-fail'),'1');assert.throws(()=>complete(s,run.id,judgment(f,s,run)),/failed/);fs.rmSync(join(f.dir,'gh-fail'));
  assert.equal(retry(s,{rejudge:true}).status,'abandoned');assert.throws(()=>retry(s,{run:run.id,rejudge:true}),/pending-input processing/);
  const requested=runSource(s,{manual:true,noLaunch:true}),successor=readRun(s,requested.run);
  assert.deepEqual(successor.inputs,run.inputs);assert.equal(successor.recoveryOf,run.id);assert.equal(successor.recoveryGuards.length,1);
  assert.equal(complete(s,successor.id,judgment(f,s,successor)).processed,true);
  const repeated=retry(s,{run:run.id,rejudge:true});assert.equal(repeated.existing,true);assert.equal(repeated.run,successor.id);
  assert.equal(readJSON(join(f.dir,'pr.json')).length,1);assert.equal(loadStatus(s).pendingRejudgment,undefined);
});
test('closed proposal recovery: another active run cannot be clobbered by historical rejudgment',t=>{
  const f=fixture(t,{kind:'git'});note(f);const {s,run}=prepared(f);complete(s,run.id,judgment(f,s,run));
  note(f,'later.md','Another human-accepted rationale captured after delivery.');const active=runSource(s,{manual:true,noLaunch:true});assert.notEqual(active.run,run.id);
  closePR(f,1);assert.throws(()=>complete(s,run.id),/closed without merge/);assert.equal(loadStatus(s).activeRun,active.run);
  fs.rmSync(run.worker.home,{recursive:true});capture(s,{final:true});fs.rmSync(f.home,{recursive:true});
  const before=tree(join(dirname(s.file),'runs')),status=loadStatus(s),calls=fs.readFileSync(f.calls,'utf8');
  const result=descriptorCLI(f,'retry',['--source',s.file,'--run',run.id,'--rejudge']);assert.equal(result.status,1);assert.match(result.out.error.message,/another active run/);
  assert.deepEqual(tree(join(dirname(s.file),'runs')),before);assert.deepEqual(loadStatus(s),status);assert.equal(fs.readFileSync(f.calls,'utf8'),calls);
});
test('closed proposal recovery: deleted worker preserves accepted and no-change destinations, including later baseline advances',t=>{
  const f=fixture(t,{kind:'git'});secondDirectory(f,{owned:true});
  const raw=readJSON(f.bindingFile);raw.bases.unchanged={id:'base-3',kind:'directory',path:'unchanged-base'};save(f.bindingFile,raw);
  const bindings=loadBindings();initBase(bindings,'unchanged',join(f.dir,'nodes.json'),undefined,{confirm:true});
  note(f);const {s,run}=prepared(f),j=judgment(f,s,run),doc=readJSON(j);
  judgment(f,s,run,{base:'secondary'});doc.outcomes[0].concepts.push(...readJSON(j).outcomes[0].concepts);save(j,doc);
  capture(s,{final:true});const delivered=complete(s,run.id,j);assert.equal(delivered.receipts.secondary.status,'accepted');assert.equal(delivered.receipts.unchanged.status,'no-change');
  fs.rmSync(f.home,{recursive:true});fs.rmSync(run.worker.home,{recursive:true});closePR(f,1);assert.throws(()=>complete(s,run.id),/closed without merge/);
  for(const alias of ['secondary','unchanged']) fs.appendFileSync(join(bindings.bases[alias].path,'peer/log.md'),'Later accepted observation, outside recovery.\n');
  const accepted=tree(bindings.bases.secondary.path),unchanged=tree(bindings.bases.unchanged.path),previous=readRun(s,run.id),snapshots=Object.fromEntries(Object.entries(previous.receipts).map(([a,r])=>[a,fs.readFileSync(r.proposal)]));
  const requested=retry(s,{run:run.id,rejudge:true}),next=readRun(s,requested.run);
  assert.deepEqual(requested.outstanding,['project']);assert.deepEqual(requested.settled,['secondary','unchanged']);
  const map=readJSON(join(next.worker.home,'work/staging.json'));
  for(const alias of requested.settled) {assert.equal(map[alias].settled,true);assert.equal(map[alias].root,undefined);assert.deepEqual(map[alias].owned,[]);assert.deepEqual(map[alias].receipt,previous.receipts[alias]);}
  // A new all-drop judgment explicitly resolves the rejected destination. It
  // neither republishes its rejected bytes nor retracts the accepted promotion.
  const done=complete(s,next.id,judgment(f,s,next,{drop:true}));assert.equal(done.processed,true);assert.equal(done.receipts.project.status,'no-change');
  for(const alias of requested.settled) assert.deepEqual(done.receipts[alias],previous.receipts[alias]);
  assert.equal(readJSON(join(f.dir,'pr.json')).length,1);assert.deepEqual(tree(bindings.bases.secondary.path),accepted);assert.deepEqual(tree(bindings.bases.unchanged.path),unchanged);
  assert.deepEqual(readRun(s,run.id),previous);for(const [a,r] of Object.entries(previous.receipts)) assert.deepEqual(fs.readFileSync(r.proposal),snapshots[a]);
  assert.deepEqual(loadStatus(s).processed,run.inputs);assert.equal(loadStatus(s).activeRun,null);
});
for(const disposition of ['open','accepted','unknown','missing','wrong-head']) test(`closed proposal recovery: ${disposition} Git identity cannot authorize a duplicate`,t=>{
  const f=fixture(t,{kind:'git'});note(f);const {s,run}=prepared(f);capture(s,{final:true});const delivered=complete(s,run.id,judgment(f,s,run));
  fs.rmSync(run.worker.home,{recursive:true});fs.rmSync(f.home,{recursive:true});
  if(disposition==='accepted') {
    const r=delivered.receipts.project;git(f.repo,['merge','--ff-only',r.branch]);const rows=readJSON(join(f.dir,'pr.json'));rows[0].state='MERGED';rows[0].mergedAt='2026-09-13T12:00:00Z';rows[0].mergeCommit={oid:r.commit};save(join(f.dir,'pr.json'),rows);
    assert.equal(complete(s,run.id).receipts.project.status,'accepted');
  } else if(disposition==='unknown') put(join(f.dir,'gh-unavailable'),'1');
  else if(disposition==='missing') save(join(f.dir,'pr.json'),[]);
  else if(disposition==='wrong-head') {const rows=readJSON(join(f.dir,'pr.json'));rows[0].state='CLOSED';rows[0].headRefOid='a'.repeat(40);save(join(f.dir,'pr.json'),rows);}
  const before=readRun(s,run.id),status=loadStatus(s),calls=fs.readFileSync(f.calls,'utf8');
  const r=descriptorCLI(f,'retry',['--source',s.file,'--run',run.id,'--rejudge']);assert.equal(r.status,1);
  assert.deepEqual(readRun(s,run.id),before);assert.deepEqual(loadStatus(s),status);assert.equal(fs.readFileSync(f.calls,'utf8'),calls);
});
test('closed proposal recovery: explicit run requires explicit rejudgment and rejects ambiguous adoption',t=>{
  const f=fixture(t);const s=f.source();
  for(const args of [['--run','invalid'],['--run','invalid','--rejudge','--adopt-home',f.home]]) {
    const r=f.cli('retry',['--source',s.file,...args]);assert.equal(r.status,1);assert.equal(r.out.error.code,'E_USAGE');
  }
});
test('closed proposal recovery: all-unsettled fresh baseline conflict retains processed evidence and successor history',t=>{
  const {f,s,next,original}=closedOriginal(t);const j=judgment(f,s,next);
  fs.appendFileSync(join(f.repo,'knowledge/peer/log.md'),'New accepted context\n');git(f.repo,['add','.']);git(f.repo,['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','new accepted context']);
  assert.throws(()=>complete(s,next.id,j),/accepted base changed/);
  const requested=retry(s,{rejudge:true}),fresh=readRun(s,requested.run);assert.notEqual(fresh.id,next.id);assert.deepEqual(fresh.inputs,original.inputs);assert.equal(fresh.recoveryOf,next.id);
  assert.match(fs.readFileSync(join(fresh.stages.project.root,'peer/log.md'),'utf8'),/New accepted context/);
  assert.equal(complete(s,fresh.id,judgment(f,s,fresh,{drop:true})).processed,true);assert.equal(readJSON(join(f.dir,'pr.json')).length,1);
});
for(const otherState of ['open','accepted']) test(`closed proposal recovery: settled ${otherState} Git destination stays on its original PR`,t=>{
  const f=fixture(t,{kind:'git'}),otherRepo=join(f.dir,'other-repo');git(f.dir,['clone','-q',f.repo,otherRepo]);
  const metaFile=join(otherRepo,'knowledge/okf-base.json'),meta=readJSON(metaFile);meta.id='base-2';save(metaFile,meta);
  git(otherRepo,['add','.']);git(otherRepo,['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','other base identity']);
  const raw=readJSON(f.bindingFile);raw.bases.secondary={...raw.bases.project,id:'base-2',repository:otherRepo,pr:{repository:'fixture/other'}};save(f.bindingFile,raw);
  const decl=readJSON(join(f.soul,'okf.json'));decl.owns.push('secondary/expert');save(join(f.soul,'okf.json'),decl);
  note(f);const {s,run}=prepared(f),j=judgment(f,s,run),doc=readJSON(j);judgment(f,s,run,{base:'secondary'});doc.outcomes[0].concepts.push(...readJSON(j).outcomes[0].concepts);save(j,doc);
  capture(s,{final:true});let delivered=complete(s,run.id,j);
  if(otherState==='accepted') {
    const r=delivered.receipts.secondary;git(otherRepo,['merge','--ff-only',r.branch]);const rows=readJSON(join(f.dir,'pr.json'));rows[1].state='MERGED';rows[1].mergedAt='2026-09-13T12:00:00Z';rows[1].mergeCommit={oid:r.commit};save(join(f.dir,'pr.json'),rows);delivered=complete(s,run.id);
  }
  const settled=structuredClone(delivered.receipts.secondary),branches=git(otherRepo,['for-each-ref','--format=%(refname):%(objectname)','refs/heads']);
  fs.rmSync(run.worker.home,{recursive:true});fs.rmSync(f.home,{recursive:true});closePR(f,1);assert.throws(()=>complete(s,run.id),/closed without merge/);
  const requested=retry(s,{run:run.id,rejudge:true}),next=readRun(s,requested.run);assert.deepEqual(requested.settled,['secondary']);assert.deepEqual(requested.outstanding,['project']);
  const result=complete(s,next.id,judgment(f,s,next,{drop:true}));assert.equal(result.processed,true);assert.deepEqual(result.receipts.secondary,settled);
  assert.equal(readJSON(join(f.dir,'pr.json')).length,2);assert.equal(git(otherRepo,['for-each-ref','--format=%(refname):%(objectname)','refs/heads']),branches);
});
test('closed proposal recovery: stale completion during abandon-to-successor interval cannot block later inputs',t=>{
  const f=fixture(t,{kind:'git'});note(f);const {s,run}=prepared(f);
  put(join(f.dir,'gh-fail'),'1');assert.throws(()=>complete(s,run.id,judgment(f,s,run)),/failed/);fs.rmSync(join(f.dir,'gh-fail'));
  assert.equal(retry(s,{rejudge:true}).status,'abandoned');const previous=readRun(s,run.id),status=loadStatus(s);
  const stale=descriptorCLI(f,'complete',['--source',s.file,'--run',run.id]);assert.equal(stale.status,1);assert.match(stale.out.error.message,/abandoned run cannot complete/);
  assert.deepEqual(readRun(s,run.id),previous);assert.deepEqual(loadStatus(s),status);assert.equal(fs.existsSync(join(f.dir,'pr.json')),false);
  note(f,'new.md','Separate rationale learned after abandonment.');capture(s);
  const replacement=readRun(s,runSource(s,{manual:true,noLaunch:true}).run);assert.deepEqual(replacement.inputs,run.inputs);
  assert.equal(complete(s,replacement.id,judgment(f,s,replacement,{drop:true})).processed,true);
  const later=readRun(s,runSource(s,{manual:true,noLaunch:true}).run);assert.equal(later.inputs.length,1);assert.ok(!run.inputs.includes(later.inputs[0]));
  assert.equal(complete(s,later.id,judgment(f,s,later,{drop:true})).processed,true);assert.equal(loadStatus(s).activeRun,null);
});
test('closed proposal recovery: uncertain replacement spawn is linked once and exact-home adoption recovers without respawning',t=>{
  const f=fixture(t,{kind:'git'});note(f);const {s,run}=prepared(f);capture(s,{final:true});complete(s,run.id,judgment(f,s,run));
  fs.rmSync(f.home,{recursive:true});fs.rmSync(run.worker.home,{recursive:true});closePR(f,1);
  const fake=process.env.OATS_CLI_BIN;put(fake,fs.readFileSync(fake,'utf8').replace('out({instance,home,work:', 'process.exit(48);out({instance,home,work:'));
  assert.throws(()=>retry(s,{run:run.id,rejudge:true}),/failed/);
  const next=readRun(s,loadStatus(s).activeRun);assert.equal(next.status,'spawn-intent');assert.equal(loadStatus(s).recoveries[run.id],next.id);
  assert.equal(retry(s,{run:run.id,rejudge:true}).run,next.id);
  assert.throws(()=>retry(s,{rejudge:true}),/uncertain worker/);assert.throws(()=>retry(s,{run:next.id,rejudge:true}),/unjudged worker/);
  const home=join(f.dir,'workers',`okf-harvester-${next.id}`);assert.equal(retry(s,{adoptHome:home}).status,'ready');
  const calls=fs.readFileSync(f.calls,'utf8').trim().split('\n').map(JSON.parse);assert.equal(calls.filter(c=>c.a[0]==='spawn' && !c.a.includes('--preview')).length,2);
  assert.equal(complete(s,next.id,judgment(f,s,readRun(s,next.id),{drop:true})).processed,true);assert.equal(readJSON(join(f.dir,'pr.json')).length,1);
});

function recoveryObservations(s) {return Object.values(tree(join(dirname(s.file),'recovery-observations'))).map(v=>JSON.parse(Buffer.from(v,'base64')));}
function uncertainClosed(t,{settled=false,absent=false}={}) {
  const f=fixture(t,{kind:'git'});if(settled) secondDirectory(f);note(f);const {s,run}=prepared(f);capture(s,{final:true});
  const fault=join(f.dir,absent?'gh-fail':'gh-uncertain');put(fault,'1');
  const result=descriptorCLI(f,'complete',['--source',s.file,'--run',run.id,'--judgment',judgment(f,s,run)]);
  assert.equal(result.status,1,result.stdout);fs.rmSync(fault);
  const previous=readRun(s,run.id);assert.equal(previous.receipts.project.status,'pr-unknown');assert.equal(previous.receipts.project.pr,undefined);
  if(!absent) closePR(f,1);
  fs.rmSync(f.home,{recursive:true});return {f,s,run:previous};
}
for(const mode of ['explicit','abandon','partial']) test(`recovery identity observation: uncertain create retains identity through ${mode} and rejects disappearance/drift`,t=>{
  const {f,s,run}=uncertainClosed(t,{settled:mode==='partial'});
  if(mode!=='partial') fs.rmSync(run.worker.home,{recursive:true});
  const receipt=structuredClone(run.receipts.project),proposal=fs.readFileSync(receipt.proposal),history=tree(join(dirname(s.file),'runs',run.id,'receipt-history'));
  const requested=descriptorCLI(f,'retry',['--source',s.file,...(mode==='explicit'?['--run',run.id]:[]),'--rejudge']);
  assert.equal(requested.status,0,requested.stdout);
  const observations=recoveryObservations(s);assert.equal(observations.length,1);
  assert.equal(observations[0].pr.number,1);assert.equal(observations[0].pr.url,'https://github.com/fixture/knowledge/pull/1');
  assert.equal(observations[0].publication.branch,receipt.branch);assert.equal(observations[0].publication.commit,receipt.commit);
  let next;
  if(mode==='abandon') {
    assert.equal(requested.out.result.status,'abandoned');
    next=readRun(s,runSource(s,{manual:true,noLaunch:true}).run);
  } else next=readRun(s,requested.out.result.run);
  assert.equal(next.recoveryGuards.length,1);assert.deepEqual(next.recoveryGuards[0].receipt,receipt,'observation never alters the receipt in a guard');
  if(mode==='explicit') assert.deepEqual(readRun(s,run.id),run);
  else if(mode==='partial') {
    assert.deepEqual(requested.out.result.settled,['secondary']);assert.deepEqual(readJSON(next.history[0]).receipts,run.receipts);
  } else assert.deepEqual(readRun(s,run.id).receipts,run.receipts);
  const j=judgment(f,s,next),closed=readJSON(join(f.dir,'pr.json'))[0];
  const states={
    'reopened and retargeted':[{...closed,state:'OPEN',baseRefName:'release'}],
    'closed but retargeted':[{...closed,baseRefName:'release'}],
    reopened:[{...closed,state:'OPEN'}],
    merged:[{...closed,state:'MERGED',mergedAt:'2026-09-13T12:00:00Z',mergeCommit:{oid:receipt.commit}}],
    missing:[],number:[{...closed,number:2}],url:[{...closed,url:closed.url+'-different'}],
    head:[{...closed,headRefOid:'a'.repeat(40)}],branch:[{...closed,headRefName:'changed-branch'}]
  };
  for(const [label,rows] of Object.entries(states)) {
    save(join(f.dir,'pr.json'),rows);
    const before=readRun(s,next.id),status=loadStatus(s);
    const failed=descriptorCLI(f,'complete',['--source',s.file,'--run',next.id,'--judgment',j]);
    assert.equal(failed.status,1,label+': '+failed.stdout);assert.match(failed.out.error.message,/identity|known PR missing|open\/merged PR/,label);
    const queries=fs.readFileSync(join(f.dir,'gh-calls.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
    assert.deepEqual(queries.at(-1).slice(0,5),['pr','view','1','--repo','fixture/knowledge'],label);
    assert.deepEqual(readJSON(join(f.dir,'pr.json')),rows,'no duplicate publication: '+label);
    assert.deepEqual(readRun(s,next.id),before);assert.deepEqual(loadStatus(s),status);assert.deepEqual(recoveryObservations(s),observations);
  }
  save(join(f.dir,'pr.json'),[closed]);
  const done=descriptorCLI(f,'complete',['--source',s.file,'--run',next.id,'--judgment',j]);assert.equal(done.status,0,done.stdout);
  assert.equal(readJSON(join(f.dir,'pr.json')).filter(pr=>['OPEN','MERGED'].includes(pr.state)).length,1);
  assert.deepEqual(fs.readFileSync(receipt.proposal),proposal);
  const retained=tree(join(dirname(s.file),'runs',run.id,'receipt-history'));
  for(const [path,bytes] of Object.entries(history)) assert.equal(retained[path],bytes,'historical receipt bytes unchanged');
  if(mode!=='partial') assert.deepEqual(retained,history);
  assert.deepEqual(loadStatus(s).processed,run.inputs);assert.equal(loadStatus(s).activeRun,null);
});

test('recovery identity observation: first discovery during an ancestor check survives failed completion and further rejudgment',t=>{
  const {f,s,run}=uncertainClosed(t,{absent:true});fs.rmSync(run.worker.home,{recursive:true});
  const next=readRun(s,retry(s,{run:run.id,rejudge:true}).run);assert.equal(fs.existsSync(join(dirname(s.file),'recovery-observations')),false);
  const receipt=run.receipts.project;
  const pr={number:1,url:'https://github.com/fixture/knowledge/pull/1',state:'CLOSED',headRefName:receipt.branch,headRefOid:receipt.commit,baseRefName:'main',mergedAt:null,mergeCommit:null};
  save(join(f.dir,'pr.json'),[pr]);
  const j=join(next.worker.home,'work/invalid.json');save(j,{version:1});
  assert.throws(()=>complete(s,next.id,j),/judgment requires/);
  assert.equal(recoveryObservations(s)[0].pr.number,1);assert.deepEqual(readRun(s,run.id),run);
  pr.state='OPEN';pr.baseRefName='release';save(join(f.dir,'pr.json'),[pr]);
  for(const args of [
    ['complete',['--source',s.file,'--run',next.id,'--judgment',j]],
    ['retry',['--source',s.file,'--run',next.id,'--rejudge']],
    ['retry',['--source',s.file,'--rejudge']]
  ]) {const result=descriptorCLI(f,...args);assert.equal(result.status,1,result.stdout);assert.match(result.out.error.message,/identity\/head\/base/);}
  assert.equal(readJSON(join(f.dir,'pr.json')).length,1);assert.equal(loadStatus(s).activeRun,next.id);
});

test('recovery identity observation: failed recovery retains discovery before a later destination blocks it',t=>{
  const {f,s,run}=uncertainClosed(t,{settled:true});fs.rmSync(run.worker.home,{recursive:true});
  const journal=journalPath(s.bindings.bases.secondary);save(journal,{fixture:'pending publication'});
  const attempt=()=>descriptorCLI(f,'retry',['--source',s.file,'--run',run.id,'--rejudge']);
  let result=attempt();assert.equal(result.status,1,result.stdout);assert.match(result.out.error.message,/directory publication pending/);
  assert.equal(recoveryObservations(s)[0].pr.number,1);assert.deepEqual(readRun(s,run.id),run);assert.equal(loadStatus(s).recoveries?.[run.id],undefined);
  fs.rmSync(journal);const rows=readJSON(join(f.dir,'pr.json'));rows[0].state='OPEN';rows[0].baseRefName='release';save(join(f.dir,'pr.json'),rows);
  result=attempt();assert.equal(result.status,1,result.stdout);assert.match(result.out.error.message,/identity\/head\/base/);
  assert.deepEqual(readRun(s,run.id),run);assert.equal(loadStatus(s).activeRun,run.id);
  // Ordinary publication retry must also use the identity learned by the failed
  // recovery, not list the original base and create a second PR.
  result=descriptorCLI(f,'retry',['--source',s.file]);assert.equal(result.status,1,result.stdout);
  assert.equal(readJSON(join(f.dir,'pr.json')).length,1);
  const queries=fs.readFileSync(join(f.dir,'gh-calls.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(queries.filter(q=>q[0]==='pr' && q[1]==='create').length,1);assert.equal(queries.at(-1)[1],'view');
});

// okf 4.0.0: the harvest switch (deployment on AND soul not off), turn
// citation, and the provenance-carrying harvest PR.
const offSettings=f=>({OATS_SETTINGS:JSON.stringify({'bindings-file':f.bindingFile,harvest:'off'})});
const hasCalls=f=>fs.existsSync(f.calls)?callsOf(f):[];
test('4.0.0 switch: deployment off spawns with instance knowledge only; retire and manual harvest honour it',t=>{
  const f=fixture(t);const r=f.cli('spawn',[],offSettings(f));assert.equal(r.status,0,r.stdout+r.stderr);
  assert.equal(r.out.meta.harvest,'off');assert.match(r.out.meta.reason,/deployment/);assert.match(r.out.brief,/Harvest is off/);assert.match(r.out.brief,/instance knowledge/);
  assert.equal(fs.existsSync(join(f.home,'.okf-source.json')),false,'no source registered');assert.deepEqual(hasCalls(f),[],'no schedule, capture or spawn call');
  assert.equal(readJSON(join(f.home,'.okf-instance.json')).harvest,'off');for(const p of ['STATE.md','log.md','notes']) assert.ok(fs.existsSync(join(f.home,p)),p);
  note(f);const h=f.cli('harvest',[],offSettings(f));assert.equal(h.status,1);assert.equal(h.out.error.code,'E_HARVEST_OFF');
  const retire=f.cli('retire',[],offSettings(f));assert.equal(retire.status,0,retire.stdout+retire.stderr);assert.deepEqual(retire.out.meta,{retired:true,reason:'harvest-off'});assert.deepEqual(hasCalls(f),[]);
});
test('4.0.0 switch: the soul opt-out is absolute; a soul "on" never switches harvest on',t=>{
  const f=fixture(t);put(join(f.soul,'soul.yaml'),'name: source\nwork: directory\nknowledge: { harvest: off }\n');
  const r=f.cli('spawn');assert.equal(r.status,0,r.stdout+r.stderr);assert.equal(r.out.meta.harvest,'off');assert.match(r.out.meta.reason,/soul/);assert.equal(fs.existsSync(join(f.home,'.okf-source.json')),false);
  const g=fixture(t);put(join(g.soul,'soul.yaml'),'name: source\nwork: directory\nknowledge:\n  harvest: on\n');
  const on=g.cli('spawn');assert.equal(on.status,0,on.stdout+on.stderr);assert.equal(on.out.meta.harvest,'off');assert.match(on.out.warning,/on/);
  const bad=fixture(t);put(join(bad.soul,'soul.yaml'),'name: source\nknowledge: {harvest: {nested: off}}\n');
  const closed=bad.cli('spawn');assert.equal(closed.out.meta.harvest,'off','unreadable soul fails closed');
  const yes=fixture(t);const reg=yes.cli('spawn');assert.equal(reg.status,0,reg.stdout+reg.stderr);assert.equal(reg.out.meta.harvest,'on');assert.ok(fs.existsSync(join(yes.home,'.okf-source.json')));
});
test('4.0.0 switch: a registered source captures nothing once the deployment turns harvest off',t=>{
  const f=fixture(t);const s=f.source();note(f);const before=hasCalls(f).length;
  const r=f.cli('run-source',['--source',s.file,'--manual','--no-launch'],offSettings(f));assert.equal(r.status,0,r.stdout+r.stderr);assert.equal(r.out.result.status,'harvest-off');
  assert.equal(hasCalls(f).length,before,'no capture, recall or spawn');assert.equal(loadStatus(s).captured.inputs.length,0);assert.equal(loadStatus(s).activeRun ?? null,null);
});
test('4.0.0 harvest-status and setup --harvest report and edit only the deployment setting',t=>{
  const f=fixture(t);f.source();const st=f.cli('harvest-status');assert.equal(st.status,0,st.stdout+st.stderr);
  assert.equal(st.out.result.harvest,'on');assert.equal(st.out.result.instance.spawnedWith,'on');assert.equal(st.out.result.sources.length,1);assert.equal(st.out.result.sources[0].soul,'source');
  const other=f.cli('harvest-status',['--soul','nobody']);assert.deepEqual(other.out.result.sources,[]);
  const ws=join(f.dir,'ws');put(join(ws,'oats-local.yaml'),'# local\nsettings:\n  oats.okf:\n    bindings-file: b.json\n');
  const w=f.cli('setup',['--harvest','on'],{OATS_WORKSPACE:ws});assert.equal(w.status,0,w.stdout+w.stderr);assert.equal(w.out.result.written,true);
  assert.equal(fs.readFileSync(join(ws,'oats-local.yaml'),'utf8'),'# local\nsettings:\n  oats.okf:\n    harvest: on\n    bindings-file: b.json\n');
  f.cli('setup',['--harvest','off'],{OATS_WORKSPACE:ws});assert.match(fs.readFileSync(join(ws,'oats-local.yaml'),'utf8'),/ {4}harvest: off\n/);
  put(join(ws,'oats-local.yaml'),'settings: {oats.okf: {harvest: off}}\n');const flow=f.cli('setup',['--harvest','on'],{OATS_WORKSPACE:ws});assert.equal(flow.out.result.written,false);assert.match(flow.out.result.add,/harvest: on/);
  assert.equal(f.cli('setup',['--harvest','yes'],{OATS_WORKSPACE:ws}).out.error.code,'E_USAGE');assert.equal(f.cli('setup',['--harvest','on','--enable'],{OATS_WORKSPACE:ws}).out.error.code,'E_REMOVED');assert.equal(f.cli('setup',['--harvest','on','--remove-schedules'],{OATS_WORKSPACE:ws}).out.error.code,'E_USAGE');
});
test('4.0.6 harvest-status reports unknown, with the reason, when the soul opt-out cannot be read',t=>{
  const f=fixture(t);f.source();
  const unset=f.cli('harvest-status',[],{OATS_SOUL:''});assert.equal(unset.status,0,unset.stdout+unset.stderr);
  assert.equal(unset.out.result.harvest,'unknown','an unreadable opt-out is not a definite off');assert.match(unset.out.result.reason,/OATS_SOUL unset/);assert.match(unset.out.result.reason,/capture treats it as off/);
  put(join(f.soul,'soul.yaml'),'name: source\nknowledge: {harvest: {nested: off}}\n');
  const bad=f.cli('harvest-status');assert.equal(bad.out.result.harvest,'unknown');assert.match(bad.out.result.reason,/flow mapping/);
  // A deployment that does not switch harvest on is a definite off, whatever the soul says.
  const off=f.cli('harvest-status',[],{OATS_SETTINGS:JSON.stringify({...JSON.parse(process.env.OATS_SETTINGS),harvest:'off'})});assert.equal(off.out.result.harvest,'off');
  put(join(f.soul,'soul.yaml'),'name: source\nknowledge: { harvest: off }\n');assert.equal(f.cli('harvest-status').out.result.harvest,'off','a readable opt-out is off');
});
test('4.0.0 judgment: transcript promotions cite their turn ids; task refs are bounded strings',t=>{
  const f=fixture(t),s=f.source();records(f,2,64);capture(s);const r=runSource(s,{manual:true,noLaunch:true});const run=readRun(s,r.run);
  const file=judgment(f,s,run,{cite:false});assert.throws(()=>complete(s,run.id,file),/must cite the turn ids/);
  const j=readJSON(file);j.outcomes[0].turns=['turn-404'];save(file,j);assert.throws(()=>complete(s,run.id,file),/turns must be turn ids/);
  const cited=judgment(f,s,run);const k=readJSON(cited);
  for(const tasks of [{refs:[42]},{refs:['x'.repeat(257)]},{refs:['a\nb']},{refs:Array(101).fill('t')},{refs:['t'],extra:1},['t']]) {save(cited,{...k,tasks});assert.throws(()=>complete(s,run.id,cited),/tasks must be/);}
  save(cited,{...k,tasks:{refs:['aweb:task-7','aweb:task-7']}});const done=complete(s,run.id,cited);assert.equal(done.processed,true);
});
test('4.0.0 note inputs carry no turns',t=>{
  const f=fixture(t);note(f);const {s,run}=prepared(f);const file=judgment(f,s,run);const j=readJSON(file);j.outcomes[0].turns=['turn-0'];save(file,j);
  assert.throws(()=>complete(s,run.id,file),/only transcript/);j.outcomes[0].turns=[];save(file,j);assert.equal(complete(s,run.id,file).processed,true);
});
test('4.0.0 Git delivery opens a labelled okf-harvest PR carrying the provenance block',t=>{
  const f=fixture(t,{kind:'git'});note(f);const {s,run}=prepared(f);const file=judgment(f,s,run);save(file,{...readJSON(file),tasks:{refs:['aweb:task-7']}});
  const r=complete(s,run.id,file);assert.equal(r.receipts.project.status,'delivered');
  const gh=fs.readFileSync(join(f.dir,'gh-calls.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
  assert.ok(gh.some(a=>a[0]==='label' && a[1]==='create' && a[2]==='okf-harvest' && a.includes('--repo') && a.includes('fixture/knowledge')),'the label is ensured first');
  const pr=readJSON(join(f.dir,'pr-1-created.json'));assert.deepEqual(pr.labels,['okf-harvest']);assert.equal(pr.title,`okf-harvest: ${run.id}`);
  const m=/```okf-harvest\n([\s\S]*?)\n```/.exec(pr.body);assert.ok(m,'fenced provenance block');const p=JSON.parse(m[1]);
  assert.equal(p.version,1);assert.equal(p.run,run.id);assert.deepEqual(p.input,run.inputs);assert.equal(p.source.soul,'source');assert.equal(p.source.instance,'source-one');
  assert.deepEqual(p.source.ownedNodes,['project/expert']);assert.deepEqual(p.tasks.refs,['aweb:task-7']);assert.equal(p.harvester.instance,run.worker.instance);
  assert.equal(git(f.repo,['log','-1','--format=%s',r.receipts.project.branch]),`okf-harvest: ${run.id}`);
});
test('4.0.0 a failing label create never blocks the PR',t=>{
  const f=fixture(t,{kind:'git'});note(f);put(join(f.dir,'gh-label-fail'),'');const {s,run}=prepared(f);
  assert.equal(complete(s,run.id,judgment(f,s,run)).receipts.project.status,'delivered');assert.deepEqual(readJSON(join(f.dir,'pr-1-created.json')).labels,['okf-harvest']);
});
// okf 4.0.1 #6: run-source and retire re-read the switch, soul included, after spawn.
const soulOff = f => put(join(f.soul, 'soul.yaml'), 'name: source\nwork: directory\nknowledge: { harvest: off }\n');
test('4.0.1 switch: a soul opting out after spawn stops run-source capture', t => {
  const f = fixture(t); const s = f.source(); note(f); soulOff(f); const before = hasCalls(f).length;
  const r = f.cli('run-source', ['--source', s.file, '--manual', '--no-launch']); assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.out.result.status, 'harvest-off'); assert.match(r.out.result.reason, /soul opts out/);
  assert.equal(hasCalls(f).length, before, 'no capture, recall or spawn'); assert.equal(loadStatus(s).captured.inputs.length, 0);
});
for (const [label, arrange, env, why] of [['the deployment switched off', () => {}, offSettings, /deployment does not switch harvest on/], ['the soul opted out', soulOff, () => ({}), /soul opts out/]]) test(`4.0.1 switch: retire takes no final capture once ${label}`, t => {
  const f = fixture(t); const s = f.source(); note(f); arrange(f); const before = hasCalls(f).filter(c => c.a[0] !== 'schedule').length;
  const r = f.cli('retire', [], env(f)); assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.out.meta.retired, true); assert.equal(r.out.meta.reason, 'harvest-off'); assert.match(r.out.meta.switch, why);
  assert.equal(hasCalls(f).filter(c => c.a[0] !== 'schedule').length, before, 'no capture or recall');
  const st = loadStatus(s); assert.equal(st.retired, true); assert.equal(st.captured.inputs.length, 0); assert.match(st.harvestOff.reason, why);
  assert.equal(hasCalls(f).length, before, 'okf 4.2.0: no scheduler call, no drain, no spawn'); assert.equal(st.drain, undefined); assert.equal(st.activeRun, null);
});
test('4.0.1 registration records the soul directory for later switch re-reads', t => {
  const f = fixture(t); const s = f.source(); assert.equal(s.soulDir, fs.realpathSync(f.soul));
});

// ------------------------------------------------------------------ 4.1.0 one-shot harvest (#37)
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
/** A harvest-off seat run by the operator (no instance env), with notes in its
 *  home and one archived note, and a manifest naming them. */
function onceFixture(t,{notes=2,body=''}={}) {
  const f=fixture(t,{kind:'git'});
  process.env.OATS_SETTINGS=JSON.stringify({'bindings-file':f.bindingFile,harvest:'off'});
  for(const k of ['OATS_HOME','OATS_INSTANCE_HOME','OATS_INSTANCE','OATS_AGENT']) delete process.env[k];
  const entries=[];
  for(let i=0;i<notes;i++) {const path=`notes/n${i}.md`,text=`---\ntype: Decision\ntitle: N${i}\n---\n\nNote ${i}: explicit custody prevents hidden fallback.${body}\n`;put(join(f.home,path),text);entries.push({path,sha256:sha256(text)});}
  const archive=join(f.dir,'archive');const old='---\ntype: Lesson\ntitle: Old\n---\n\nArchived lesson from the classic seat.\n';put(join(archive,'old.md'),old);
  entries.push({path:join(archive,'old.md'),sha256:sha256(old)});
  const manifest={version:1,instance:'source-one',roots:[archive],notes:entries};
  const file=join(f.dir,'manifest.json');const write=(m=manifest)=>{save(file,m);return file;};write();
  const sources=()=>{const d=join(f.bindings.stateDir,'sources');return fs.existsSync(d)?fs.readdirSync(d):[];};
  return {f,manifest,file,write,archive,sources};
}
test('4.1.0 harvest --once refuses a bad manifest before anything is stored',t=>{
  const o=onceFixture(t);const {f,manifest}=o;
  const refuse=(m,code,re,why)=>{assert.throws(()=>harvestOnce({home:f.home,records:o.write(m),noLaunch:true}),e=>e.code===code && re.test(e.message),why);assert.deepEqual(o.sources(),[],`${why}: nothing stored`);};
  const note=(i,patch)=>({...manifest,notes:manifest.notes.map((n,j)=>j===i?{...n,...patch}:n)});
  refuse(note(0,{sha256:'0'.repeat(64)}),'E_RECORDS',/sha256 mismatch.*notes\/n0\.md/,'hash mismatch');
  refuse(note(0,{path:join(f.dir,'elsewhere.md')}),'E_PATH',/outside/,'outside the home and roots');
  put(join(f.dir,'elsewhere.md'),'x');fs.symlinkSync(join(f.dir,'elsewhere.md'),join(f.home,'notes','link.md'));
  refuse(note(0,{path:'notes/link.md',sha256:sha256('x')}),'E_PATH',/symlink/,'symlinked file');
  fs.mkdirSync(join(f.home,'notes','folder.md'));
  refuse(note(0,{path:'notes/folder.md'}),'E_PATH',/regular file/,'directory entry');
  fs.linkSync(join(f.home,'notes','n1.md'),join(f.home,'notes','hard.md'));
  refuse(note(0,{path:'notes/hard.md',sha256:manifest.notes[1].sha256}),'E_PATH',/hardlink/,'hardlink');
  refuse({...manifest,notes:[manifest.notes[0],manifest.notes[0]]},'E_RECORDS',/duplicate/,'duplicate');
  refuse(note(0,{path:'notes/n0.txt'}),'E_RECORDS',/\.md/,'not markdown');
  refuse({...manifest,instance:'someone-else'},'E_RECORDS',/instance/,'another instance');
  refuse({...manifest,notes:[{path:'notes/*.md',sha256:manifest.notes[0].sha256}]},'E_PATH',/no such file|outside|regular file/,'no globbing');
  refuse({...manifest,sessions:[{path:'notes/n0.md',sha256:manifest.notes[0].sha256,format:'codex'}]},'E_UNSUPPORTED',/capture-file/,'sessions need the kernel feature');
  refuse({...manifest,extra:1},'E_RECORDS',/unknown/,'unknown key');
  fs.symlinkSync(o.archive,join(f.dir,'archive-link'));
  refuse({...manifest,roots:[join(f.dir,'archive-link')]},'E_PATH',/symlink/,'symlinked root');
});
test('4.1.0 harvest --once harvests the listed notes through the normal review path and registers nothing',t=>{
  const o=onceFixture(t);const {f}=o;const before=fs.readdirSync(f.home).sort();
  const r=harvestOnce({home:f.home,records:o.file,noLaunch:true});
  assert.equal(r.status,'ready');assert.equal(r.inputs.total,3);assert.equal(r.inputs.remaining,0);
  assert.equal(fs.existsSync(join(f.home,'.okf-source.json')),false,'no source marker in the home');
  assert.deepEqual(fs.readdirSync(f.home).sort(),before,'the home is not written');
  assert.equal(hasCalls(f).filter(c=>c.a[0]==='schedule' || c.a[0]==='capture').length,0,'no schedule, no capture');
  const s=loadSource(r.source);assert.equal(s.once.manifestHash.length,64);assert.equal(s.instance,'source-one');assert.equal(s.owner,'owner-1');
  const once=readJSON(join(dirname(r.source),'once.json'));assert.deepEqual(once.entries.map(e=>e.name),['notes/n0.md','notes/n1.md','old.md']);
  assert.doesNotMatch(JSON.stringify(once),new RegExp(o.archive.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')),'no archive paths in the receipt');
  const run=readRun(s,r.run);assert.equal(run.inputs.length,3);
  const task=fs.readFileSync(join(run.worker.home,'TASK.md'),'utf8');assert.match(task,/archived records/);assert.match(task,/never copy third-party/);
  const done=complete(s,run.id,judgment(f,s,run));assert.equal(done.receipts.project.status,'delivered');
  const created=readJSON(join(f.dir,'pr-1-created.json'));assert.deepEqual(created.labels,['okf-harvest']);
  const block=JSON.parse(/```okf-harvest\n([\s\S]*?)\n```/.exec(created.body)[1]);assert.deepEqual(block.once,{manifest:s.once.manifestHash,entries:3,override:false});
  const again=harvestOnce({home:f.home,records:o.file,noLaunch:true});assert.equal(again.status,'already-delivered');assert.equal(again.source,r.source);
  assert.equal(readJSON(join(f.dir,'pr.json')).length,1,'a rerun never opens another PR');
  const st=f.cli('harvest-status',['--home',f.home]);assert.equal(st.status,0,st.stdout+st.stderr);assert.equal(st.out.result.instance.registered,false);
  assert.deepEqual(st.out.result.sources,[],'one-shots are not registered sources');assert.equal(st.out.result.once.length,1);assert.equal(st.out.result.once[0].state,'delivered');
  fs.renameSync(f.home,join(f.dir,'retired-home'));
  const gone=spawnSync(process.execPath,[CLI,'harvest-status','--home',f.home,'--json'],{cwd:f.dir,env:process.env,encoding:'utf8'});assert.equal(gone.status,0,gone.stdout+gone.stderr);
  assert.equal(JSON.parse(gone.stdout).result.once.length,1,'a retired seat\'s one-shots still list');
});
test('4.1.0 a large set drains in several runs; each says how many inputs remain',t=>{
  const o=onceFixture(t,{notes:8,body:' '+'x'.repeat(60000)});const {f}=o;
  const first=harvestOnce({home:f.home,records:o.file,noLaunch:true});
  assert.ok(first.inputs.remaining>0);assert.match(first.next,new RegExp(`${first.inputs.remaining} inputs remain; rerun the same command to continue`));
  const s=loadSource(first.source);let run=readRun(s,first.run);complete(s,run.id,judgment(f,s,run));
  const second=harvestOnce({home:f.home,records:o.file,noLaunch:true});assert.notEqual(second.run,first.run);
  assert.equal(second.inputs.total,first.inputs.total);assert.ok(second.inputs.processed>=run.inputs.length);
  assert.equal(readJSON(join(dirname(first.source),'once.json')).runs.length,2,'the receipt shows the progress');
  const cli=f.cli('harvest',['--once','--home',f.home,'--records',o.file,'--no-launch']);assert.equal(cli.status,0,cli.stdout+cli.stderr);assert.match(cli.out.result.next,/inputs remain; rerun the same command/);
  const text=spawnSync(process.execPath,[CLI,'harvest','--once','--home',f.home,'--records',o.file,'--no-launch'],{cwd:f.dir,env:process.env,encoding:'utf8'});
  assert.equal(text.status,0,text.stderr);assert.match(text.stdout,/one-shot harvest of .*inputs \d+\/\d+ processed; \d+ inputs remain; rerun the same command/);
});
test('4.1.0 a different manifest repeating already-harvested notes is refused',t=>{
  const o=onceFixture(t);const {f,manifest}=o;
  const r=harvestOnce({home:f.home,records:o.file,noLaunch:true});const s=loadSource(r.source);const run=readRun(s,r.run);complete(s,run.id,judgment(f,s,run));
  assert.throws(()=>harvestOnce({home:f.home,records:o.write({...manifest,notes:manifest.notes.slice(0,2)}),noLaunch:true}),e=>e.code==='E_ONCE_OVERLAP' && e.message.includes(s.id));
});
test('4.1.0 a soul opt-out (or an unreadable one) is refused unless overridden, and the override is recorded',t=>{
  const o=onceFixture(t);const {f}=o;
  put(join(f.soul,'soul.yaml'),'name: source\nknowledge: { harvest: off }\n');
  assert.throws(()=>harvestOnce({home:f.home,records:o.file,noLaunch:true}),e=>e.code==='E_HARVEST_OFF' && /opts out/.test(e.message) && /--override-opt-out/.test(e.message) && /recorded in the PR/.test(e.message));
  put(join(f.soul,'soul.yaml'),'name: source\nknowledge: {harvest: {nested: off}}\n');
  assert.throws(()=>harvestOnce({home:f.home,records:o.file,noLaunch:true}),e=>e.code==='E_HARVEST_OFF' && /could not be read/.test(e.message));
  assert.deepEqual(o.sources(),[]);
  const r=harvestOnce({home:f.home,records:o.file,noLaunch:true,overrideOptOut:true});const s=loadSource(r.source);assert.equal(r.once.override,true);
  const run=readRun(s,r.run);assert.equal(run.once.override,true,'the override is the run\'s');
  assert.deepEqual(readJSON(join(dirname(r.source),'once.json')).runs,[{run:run.id,override:true}]);
  complete(s,run.id,judgment(f,s,run));
  assert.equal(JSON.parse(/```okf-harvest\n([\s\S]*?)\n```/.exec(readJSON(join(f.dir,'pr-1-created.json')).body)[1]).once.override,true);
});
test('4.1.0 harvest --once is the operator\'s: refused from inside the target seat or for another soul',t=>{
  const o=onceFixture(t);const {f}=o;
  assert.throws(()=>harvestOnce({home:f.home,records:o.file,noLaunch:true,env:{...process.env,OATS_INSTANCE_HOME:f.home}}),e=>e.code==='E_INVOCATION' && /itself/.test(e.message));
  put(join(f.soul,'soul.yaml'),'name: another-soul\nwork: directory\n');
  assert.throws(()=>harvestOnce({home:f.home,records:o.file,noLaunch:true}),e=>e.code==='E_INVOCATION' && /another-soul/.test(e.message));
  assert.deepEqual(o.sources(),[]);
});
test('4.1.0 a one-shot writes only the nodes its soul owns; other nodes stay read-only',t=>{
  const o=onceFixture(t);const {f}=o;
  const r=harvestOnce({home:f.home,records:o.file,noLaunch:true});const s=loadSource(r.source);const run=readRun(s,r.run);
  assert.throws(()=>complete(s,run.id,judgment(f,s,run,{node:'peer'})),e=>['E_JUDGMENT','E_OWNER'].includes(e.code));
  assert.equal(fs.existsSync(join(f.dir,'pr.json')),false,'nothing was published');
});
test('4.1.0 a one-shot whose first call died before its receipt is finished by the rerun, never reported delivered',t=>{
  const o=onceFixture(t);const {f}=o;
  // The state a call killed between custody and receipt leaves: a source with no inputs and no once.json.
  const workerModule=new URL('../oats-package/capabilities/oats-okf/lib/once.mjs',import.meta.url).href;
  const code=`import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';const {harvestOnce}=await import(${JSON.stringify(workerModule)});
const save=fs.renameSync;fs.renameSync=(a,b)=>{if(/\\/inputs\\/[0-9a-f]{64}\\.json$/.test(b)) process.kill(process.pid,'SIGKILL');return save(a,b);};syncBuiltinESMExports();
harvestOnce({home:${JSON.stringify(f.home)},records:${JSON.stringify(o.file)},noLaunch:true});`;
  const child=spawnSync(process.execPath,['--input-type=module','-e',code],{env:process.env,encoding:'utf8'});assert.equal(child.signal,'SIGKILL',child.stderr);
  const r=harvestOnce({home:f.home,records:o.file,noLaunch:true});
  assert.equal(r.status,'ready');assert.equal(r.inputs.total,3);assert.ok(fs.existsSync(join(dirname(r.source),'once.json')));
});
test('4.1.0 a manifest repeating notes another one-shot still holds (not yet processed) is refused',t=>{
  const o=onceFixture(t,{notes:8,body:' '+'x'.repeat(60000)});const {f,manifest}=o;
  const first=harvestOnce({home:f.home,records:o.file,noLaunch:true});assert.ok(first.inputs.remaining>0);
  put(join(f.home,'notes','forgotten.md'),'forgotten\n');
  const more={...manifest,notes:[...manifest.notes,{path:'notes/forgotten.md',sha256:sha256('forgotten\n')}]};
  assert.throws(()=>harvestOnce({home:f.home,records:o.write(more),noLaunch:true}),e=>e.code==='E_ONCE_OVERLAP' && e.message.includes(loadSource(first.source).id));
});
test('4.1.0 a relative manifest path stays in the home',t=>{
  const o=onceFixture(t);const {f,manifest}=o;
  const climbing={...manifest,notes:[{path:'../../archive/old.md',sha256:manifest.notes[2].sha256}]};
  assert.throws(()=>harvestOnce({home:f.home,records:o.write(climbing),noLaunch:true}),e=>['E_PATH','E_RECORDS'].includes(e.code));
  assert.deepEqual(o.sources(),[]);
});
// ------------------------------------------------------------------ 4.1.1 one-shot fixes (#39, #40)
const ONCE_MODULE=new URL('../oats-package/capabilities/oats-okf/lib/once.mjs',import.meta.url).href;
/** A real process running harvest --once on `records`. `onInput` runs (as
 *  source text) when the process first stores an input: the window between
 *  its overlap check and its install. It prints {ok,result} or {ok,code}. */
function onceChild(f,records,onInput='') {
  const code=`import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';const {harvestOnce}=await import(${JSON.stringify(ONCE_MODULE)});
const rename=fs.renameSync;let first=true;fs.renameSync=(a,b)=>{if(first && /\\/inputs\\/[0-9a-f]{64}\\.json$/.test(b)) {first=false;${onInput}}return rename(a,b);};syncBuiltinESMExports();
try {console.log(JSON.stringify({ok:true,result:harvestOnce({home:${JSON.stringify(f.home)},records:${JSON.stringify(records)},noLaunch:true})}));}
catch(e) {console.log(JSON.stringify({ok:false,code:e.code,message:e.message}));}`;
  return spawn(process.execPath,['--input-type=module','-e',code],{env:process.env,stdio:['ignore','pipe','pipe']});
}
const finished=child=>new Promise(done=>{let out='',err='';child.stdout.on('data',d=>out+=d);child.stderr.on('data',d=>err+=d);child.on('close',(status,signal)=>done({status,signal,out,err}));});
const onceLocks=f=>fs.existsSync(f.bindings.stateDir)?fs.readdirSync(f.bindings.stateDir).filter(n=>/^once-.*\.lock$/.test(n)):[];
test('4.1.1 two one-shots of a seat with overlapping manifests started together: exactly one installs, the other gets E_ONCE_OVERLAP',async t=>{
  const o=onceFixture(t);const {f,manifest}=o;
  const first=o.write();const second=join(f.dir,'manifest-2.json');
  put(join(f.home,'notes','extra.md'),'extra\n');
  save(second,{...manifest,notes:[manifest.notes[1],{path:'notes/extra.md',sha256:sha256('extra\n')}]});
  // Each process pauses after its overlap check, before its install.
  const pause='Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,1500);';
  const results=await Promise.all([onceChild(f,first,pause),onceChild(f,second,pause)].map(finished));
  const answers=results.map(r=>{assert.equal(r.status,0,r.err);return JSON.parse(r.out);});
  assert.deepEqual(answers.map(a=>a.ok).sort(),[false,true],JSON.stringify(answers));
  const refused=answers.find(a=>!a.ok);assert.equal(refused.code,'E_ONCE_OVERLAP',refused.message);
  assert.equal(o.sources().length,1,'only one one-shot is installed');
  assert.deepEqual(onceLocks(f),[],'the lock is released');
});
test('4.1.1 a one-shot lock whose owner died is reclaimed by the rerun',async t=>{
  const o=onceFixture(t);const {f}=o;
  const killed=await finished(onceChild(f,o.file,'process.kill(process.pid,"SIGKILL");'));assert.equal(killed.signal,'SIGKILL',killed.err);
  const [lock]=onceLocks(f);assert.ok(lock,'the killed process held the seat\'s one-shot lock');
  assert.equal(readJSON(join(f.bindings.stateDir,lock,'owner.json')).pid>0,true);
  const r=harvestOnce({home:f.home,records:o.file,noLaunch:true});
  assert.equal(r.status,'ready');assert.equal(r.inputs.total,3);assert.deepEqual(onceLocks(f),[],'reclaimed and released');
});
/** Every file under `dir` whose bytes contain `marker`. */
function filesWith(dir,marker) {
  return fs.readdirSync(dir,{recursive:true,withFileTypes:true}).filter(d=>d.isFile() && fs.readFileSync(join(d.parentPath,d.name)).includes(marker)).map(d=>join(d.parentPath,d.name));
}
test('4.1.1 a rerun of a draining one-shot continues from custody: notes edited since never enter it',t=>{
  const o=onceFixture(t,{notes:8,body:' '+'x'.repeat(60000)});const {f,manifest}=o;
  const first=harvestOnce({home:f.home,records:o.file,noLaunch:true});assert.ok(first.inputs.remaining>0);
  const s=loadSource(first.source);let run=readRun(s,first.run);complete(s,run.id,judgment(f,s,run));
  const marker='EDITED-AFTER-THE-ONE-SHOT-TOOK-IT';
  for(const n of manifest.notes) fs.appendFileSync(n.path.startsWith('/')?n.path:join(f.home,n.path),`\n${marker}\n`);
  for(let next=harvestOnce({home:f.home,records:o.file,noLaunch:true});next.status!=='already-delivered';next=harvestOnce({home:f.home,records:o.file,noLaunch:true})) {
    assert.equal(next.status,'ready');run=readRun(s,next.run);
    for(const id of run.inputs) assert.doesNotMatch(input(s,id).text,new RegExp(marker));
    assert.deepEqual(filesWith(run.worker.home,marker),[],'the run\'s worker sees no edited bytes');
    complete(s,run.id,judgment(f,s,run));
  }
  assert.deepEqual(filesWith(dirname(s.file),marker),[],'custody holds no edited bytes');
  assert.equal(loadStatus(s).processed.length,first.inputs.total);
});
test('4.1.1 a different manifest listing a held note by its old sha256 is refused as that one-shot\'s, never as a sha256 mismatch',t=>{
  const o=onceFixture(t);const {f,manifest}=o;
  const r=harvestOnce({home:f.home,records:o.file,noLaunch:true});const s=loadSource(r.source);
  fs.appendFileSync(join(f.home,manifest.notes[0].path),'\nTidied by the operator.\n');
  const other=join(f.dir,'manifest-2.json');save(other,{...manifest,notes:manifest.notes.slice(0,2)});
  assert.throws(()=>harvestOnce({home:f.home,records:other,noLaunch:true}),e=>{
    assert.equal(e.code,'E_ONCE_OVERLAP',e.message);assert.doesNotMatch(e.message,/sha256 mismatch/);
    assert.ok(e.message.includes(s.id),'names the one-shot');assert.match(e.message,/notes\/n0\.md/);assert.match(e.message,/in custody/);
    assert.ok(e.message.includes(`its own manifest unchanged (sha256 ${s.once.manifestHash})`),'says what to do');return true;});
  assert.equal(o.sources().length,1,'nothing else is stored');
});
test('4.1.1 a one-shot whose receipt names another manifest is refused, naming the one-shot and its custody',t=>{
  const o=onceFixture(t);const {f}=o;
  const r=harvestOnce({home:f.home,records:o.file,noLaunch:true});const s=loadSource(r.source);
  const file=join(dirname(r.source),'once.json'),receipt=readJSON(file);save(file,{...receipt,manifestHash:'0'.repeat(64)});
  assert.throws(()=>harvestOnce({home:f.home,records:o.file,noLaunch:true}),e=>e.code==='E_RECORDS' && e.message.includes(s.id) && /in custody/.test(e.message) && /rerun with the manifest it was started from/.test(e.message) && !/sha256 mismatch/.test(e.message));
});
// ------------------------------------------------------------------ 4.1.1 complete on an amended, open PR (#36)
/** A delivered Git run whose publication branch the maintainer moved while
 *  its PR is open: `amend` commits on top of the delivered commit; `rewrite`
 *  replaces the branch with a commit that does not contain it. */
function amendedOpen(t,{rewrite=false}={}) {
  const f=fixture(t,{kind:'git'});note(f);const {s,run}=prepared(f);complete(s,run.id,judgment(f,s,run));
  const r=readRun(s,run.id).receipts.project;assert.equal(r.status,'delivered');
  const cid=['-c','user.name=Maintainer','-c','user.email=maintainer@example.invalid'];
  if(rewrite) git(f.repo,['checkout','-q','-B',r.branch,r.parent]);else git(f.repo,['checkout','-q',r.branch]);
  fs.appendFileSync(join(f.repo,'knowledge/expert/decision.md'),'Wording amended in review.\n');
  git(f.repo,['add','.']);git(f.repo,[...cid,'commit','-qm','okf-review amendment']);const head=git(f.repo,['rev-parse','HEAD']);git(f.repo,['checkout','-q','main']);
  const pr=readJSON(join(f.dir,'pr.json'));pr[0].headRefOid=head;save(join(f.dir,'pr.json'),pr);
  return {f,s,run,r,head};
}
const prCreates=f=>fs.readFileSync(join(f.dir,'gh-calls.jsonl'),'utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l)).filter(a=>a[0]==='pr' && a[1]==='create').length;
test('4.1.1 complete on an open PR the maintainer amended on top of the delivered commit reports delivered, names the amended head and pushes nothing',t=>{
  const {f,s,run,r,head}=amendedOpen(t);
  for(const attempt of ['first','rerun']) {
    const done=complete(s,run.id);const receipt=done.receipts.project;
    assert.equal(receipt.status,'delivered',attempt);assert.equal(receipt.commit,r.commit,`${attempt}: the delivered commit stays on the receipt`);
    assert.equal(receipt.pr.headRefOid,head,`${attempt}: the receipt's PR names the amended head`);assert.equal(receipt.pr.state,'OPEN');
    assert.equal(done.next,`PR ${receipt.pr.url} is open at ${head}, which contains the delivered commit ${r.commit}; it settles when it merges`,attempt);
    assert.equal(git(f.repo,['rev-parse',`refs/heads/${r.branch}`]),head,`${attempt}: nothing was pushed`);assert.equal(prCreates(f),1,`${attempt}: no other PR`);
    assert.equal(readRun(s,run.id).status,'processed',attempt);
  }
  const cli=f.cli('complete',['--source',s.file,'--run',run.id]);assert.equal(cli.status,0,cli.stdout+cli.stderr);
  assert.equal(cli.out.result.receipts.project.pr.headRefOid,head);assert.match(cli.out.result.next,new RegExp(`open at ${head}, which contains the delivered commit ${r.commit}`));
});
test('4.1.1 complete on a rewritten publication branch (its tip lacks the delivered commit) is still refused with E_PR',t=>{
  const {f,s,run,r,head}=amendedOpen(t,{rewrite:true});
  assert.throws(()=>complete(s,run.id),e=>e.code==='E_PR' && /unexpected commit; never force push/.test(e.message));
  assert.equal(git(f.repo,['rev-parse',`refs/heads/${r.branch}`]),head,'never force-pushed');assert.equal(prCreates(f),1);
});
test('4.1.1 an amended open PR is still reconciled after the accepted branch changed inside the root, never E_BASELINE',t=>{
  const {f,s,run,r,head}=amendedOpen(t);
  fs.appendFileSync(join(f.repo,'knowledge/peer/index.md'),'* Peer change accepted meanwhile.\n');
  git(f.repo,['add','.']);git(f.repo,['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','peer change']);
  const receipt=complete(s,run.id).receipts.project;
  assert.equal(receipt.status,'delivered');assert.equal(receipt.pr.headRefOid,head);assert.equal(git(f.repo,['rev-parse',`refs/heads/${r.branch}`]),head);
});
test('4.1.1 a graft in the worker\'s checkout cannot make a rewritten publication branch pass as amended',t=>{
  const {f,s,run,r,head}=amendedOpen(t,{rewrite:true});
  const checkout=readRun(s,run.id).stages.project.checkout;
  git(checkout,['fetch','-q','origin',`refs/heads/${r.branch}`]);put(join(checkout,'.git/info/grafts'),`${head} ${r.commit}\n`);
  assert.equal(spawnSync('git',['-C',checkout,'merge-base','--is-ancestor',r.commit,head]).status,0,'the graft does fool plain Git');
  assert.throws(()=>complete(s,run.id),e=>e.code==='E_PR' && /unexpected commit; never force push/.test(e.message));
  assert.equal(git(f.repo,['rev-parse',`refs/heads/${r.branch}`]),head,'never force-pushed');
});
/** Rewrite `child`'s first parent to `parent` in the checkout's commit-graph
 *  file (with a valid checksum), leaving every object as it is. */
function forgeCommitGraph(checkout,child,parent) {
  execFileSync('git',['-C',checkout,'commit-graph','write','--stdin-commits'],{input:`${child}\n${parent}\n`});
  const file=join(checkout,'.git/objects/info/commit-graph');fs.chmodSync(file,0o600);const d=fs.readFileSync(file);
  const chunk=id=>{for(let i=0;i<d[6];i++) if(d.toString('latin1',8+12*i,12+12*i)===id) return Number(d.readBigUInt64BE(12+12*i));};
  const oidl=chunk('OIDL'),cdat=chunk('CDAT'),n=d.readUInt32BE(chunk('OIDF')+255*4);
  const oids=Array.from({length:n},(_,i)=>d.toString('hex',oidl+20*i,oidl+20*i+20));
  d.writeUInt32BE(oids.indexOf(parent),cdat+36*oids.indexOf(child)+20);
  createHash('sha1').update(d.subarray(0,d.length-20)).digest().copy(d,d.length-20);fs.writeFileSync(file,d);
}
test('4.1.1 a forged commit-graph in the worker\'s checkout cannot make a rewritten publication branch pass as amended',t=>{
  const {f,s,run,r,head}=amendedOpen(t,{rewrite:true});
  const checkout=readRun(s,run.id).stages.project.checkout;
  git(checkout,['fetch','-q','origin',`refs/heads/${r.branch}`]);forgeCommitGraph(checkout,head,r.commit);
  assert.equal(spawnSync('git',['-C',checkout,'merge-base','--is-ancestor',r.commit,head]).status,0,'the graph does fool plain Git');
  assert.throws(()=>complete(s,run.id),e=>e.code==='E_PR' && /unexpected commit; never force push/.test(e.message));
  assert.equal(git(f.repo,['rev-parse',`refs/heads/${r.branch}`]),head,'never force-pushed');
});

// ---------------------------------------------------------------------------
// okf 4.2.0: checkpoint harvest (#49). No scheduler job; the working agent runs
// `oats okf harvest` at its checkpoints and retirement takes the final one.
// Every assertion counts real CLI calls, durable ids and receipts.
const {checkpointHarvest,retireDrain,continueDrain,outstanding,harvesterInstance}=await mod('worker');
const cp=(await import('node:child_process')).default;
const {hostname}=await import('node:os');
const callsIn=f=>fs.existsSync(f.calls)?callsOf(f):[];
const spawnsOf=f=>callsIn(f).filter(c=>c.a[0]==='spawn' && !c.a.includes('--preview'));
const capturesOf=f=>callsIn(f).filter(c=>c.a[0]==='capture');
/** The CLI as an operator runs it from the deployment (no instance home). */
function deploymentCli(f,cmd,args=[],env={}) {
  const base=Object.fromEntries(Object.entries(process.env).filter(([k])=>!['OATS_INSTANCE_HOME','OATS_HOME','OATS_INSTANCE','OATS_AGENT'].includes(k)));
  const r=spawnSync(process.execPath,[CLI,cmd,...args,'--json'],{cwd:f.context,env:{...base,...env},encoding:'utf8',timeout:60000});
  let out;try{out=JSON.parse(r.stdout);}catch{}return {...r,out};
}
const bigNote=(f,i)=>note(f,`big-${i}.md`,`Observation ${i}: `+'durable detail '.repeat(6700));
/** A second (or later) registered seat of the same soul in the fixture's deployment. */
function seat(f,name) {
  const home=join(f.context,name);fs.mkdirSync(join(home,'work'),{recursive:true});
  save(join(home,'instance.json'),{instance:name,agent:'source',repo:f.context,work:'directory',launched:true});
  const prior=process.env.OATS_INSTANCE;process.env.OATS_INSTANCE=name;
  try {return register(home);} finally {process.env.OATS_INSTANCE=prior;}
}

test('4.2.0 consent: own-home harvest re-reads the switch for a registered source; off, opted out or unreadable captures and launches nothing',t=>{
  const f=fixture(t);const s=f.source();note(f);
  const cases=[[()=>{},offSettings(f),/deployment does not switch harvest on/],[()=>soulOff(f),{},/soul opts out/],[()=>put(join(f.soul,'soul.yaml'),'name: source\nknowledge:\n\tharvest: on\n'),{},/could not be read/]];
  for(const [arrange,env,why] of cases) {
    arrange();const r=f.cli('harvest',[],env);assert.equal(r.status,1,r.stdout);assert.equal(r.out.error.code,'E_HARVEST_OFF');assert.match(r.out.error.message,why);
    assert.equal(fs.existsSync(f.calls),false,'no capture, recall, spawn or session');assert.deepEqual(loadStatus(s).captured.inputs,[]);assert.equal(loadStatus(s).drain,undefined);
    put(join(f.soul,'soul.yaml'),'name: source\nwork: directory\n');
  }
  const on=f.cli('harvest',['--no-launch']);assert.equal(on.status,0,on.stdout);assert.equal(on.out.result.status,'started');
});
test('4.2.0 instructions: only the harvest-on spawn brief tells the agent to run the checkpoint command; no hook output names a schedule',t=>{
  const f=fixture(t);const on=f.cli('spawn');assert.equal(on.status,0,on.stdout);
  assert.match(on.out.brief,/at a checkpoint \(after opening or handing over a PR, or finishing a task\) update STATE\.md, log\.md and notes\/, then run `oats okf harvest` from your instance home/);
  assert.equal(on.out.meta.checkpoint,'oats okf harvest');assert.equal(on.out.meta.schedule,undefined);
  const g=fixture(t);const off=g.cli('spawn',[],offSettings(g));assert.equal(off.status,0,off.stdout);assert.equal(off.out.meta.harvest,'off');
  assert.doesNotMatch(off.out.brief,/(?<!do not )run `oats okf harvest`/,'no unconditional harvest instruction');assert.match(off.out.brief,/do not run `oats okf harvest`/);
  const service=f.cli('spawn',[],{OATS_KIND:'capability',OATS_HOME:join(f.dir,'svc'),OATS_INSTANCE_HOME:join(f.dir,'svc')});assert.doesNotMatch(JSON.stringify(service.out),/oats okf harvest/);
});
test('4.2.0 two concurrent checkpoint processes start at most one worker; the loser reports the run or preparation, never a second spawn',async t=>{
  const f=fixture(t);f.source();note(f);put(join(f.dir,'spawn-slow'),'1500');
  const run=()=>new Promise(done=>{const c=spawn(process.execPath,[CLI,'harvest','--no-launch','--json'],{cwd:f.home,env:process.env});let out='';c.stdout.on('data',d=>out+=d);c.on('close',code=>done({code,out:JSON.parse(out)}));});
  const answers=await Promise.all([run(),run()]);
  for(const a of answers) assert.equal(a.code,0,JSON.stringify(a.out));
  const won=answers.find(a=>a.out.result.status==='started'),lost=answers.find(a=>a.out.result.status==='already-running');
  assert.ok(won && lost,JSON.stringify(answers.map(a=>a.out.result)));
  assert.ok(lost.out.result.run===won.out.result.run || (lost.out.result.preparing===true && lost.out.result.run===null),'the loser names the run or says preparation is in progress');
  assert.equal(spawnsOf(f).length,1,'exactly one worker identity');
});
test('4.2.0 a live worker lock before any run is preparation; a dead holder\'s lock is reclaimed; a foreign host\'s is not guessed at',t=>{
  const f=fixture(t);const s=f.source();note(f);const lock=join(dirname(s.file),'worker.lock');
  put(join(lock,'owner.json'),JSON.stringify({token:'live',pid:process.pid,host:hostname()}));
  const busy=f.cli('harvest');assert.equal(busy.status,0,busy.stdout);assert.deepEqual([busy.out.result.status,busy.out.result.run,busy.out.result.preparing],['already-running',null,true]);
  assert.match(busy.out.result.reason,/no model is known to be running/);assert.equal(fs.existsSync(f.calls),false,'nothing captured or spawned');
  put(join(lock,'owner.json'),JSON.stringify({token:'other',pid:process.pid,host:'another-host'}));
  const foreign=f.cli('harvest');assert.equal(foreign.status,1);assert.equal(foreign.out.error.code,'E_LOCKED');
  const dead=spawnSync(process.execPath,['-e','process.exit(0)']).pid;put(join(lock,'owner.json'),JSON.stringify({token:'dead',pid:dead,host:hostname()}));
  const reclaimed=f.cli('harvest',['--no-launch']);assert.equal(reclaimed.status,0,reclaimed.stdout);assert.equal(reclaimed.out.result.status,'started');assert.equal(spawnsOf(f).length,1);
});
test('4.2.0 nothing new is empty: identical notes and cursors capture nothing; a changed note is new evidence; an active run is never recaptured',t=>{
  const f=fixture(t);const s=f.source();note(f);
  const first=f.cli('harvest',['--no-launch']);assert.equal(first.out.result.status,'started');
  const again=f.cli('harvest',['--no-launch']);assert.equal(again.out.result.status,'already-running');assert.equal(again.out.result.run,first.out.result.run);assert.equal(capturesOf(f).length,1,'an active run is not recaptured');
  const run=readRun(s,first.out.result.run);complete(s,run.id,judgment(f,s,run,{drop:true}));
  const empty=f.cli('harvest',['--no-launch']);assert.equal(empty.status,0,empty.stdout);assert.equal(empty.out.result.status,'empty');assert.deepEqual(empty.out.result.settled,[]);
  assert.equal(spawnsOf(f).length,1);assert.equal(loadStatus(s).captured.inputs.length,1);
  note(f,'decision.md','The rationale changed after review.');
  const changed=f.cli('harvest',['--no-launch']);assert.equal(changed.out.result.status,'started');assert.equal(changed.out.result.inputs.run,1);
  assert.equal(loadStatus(s).captured.inputs.length,2);assert.equal(spawnsOf(f).length,2);
});
test('4.2.0 finite drain: a checkpoint over more than 192 KB is drained run by run from its persisted boundary, without recapture; later notes wait',t=>{
  const f=fixture(t);const s=f.source();put(join(f.dir,'sessions-inert'),'');for(const i of [0,1,2]) bigNote(f,i);
  const c=f.cli('harvest');assert.equal(c.status,0,c.stdout);assert.equal(c.out.result.status,'started');assert.equal(c.out.result.launched,true);assert.deepEqual(c.out.result.inputs,{run:1,pending:3});
  const boundary=loadStatus(s).drain.boundary;assert.equal(boundary.length,3);
  let total=0;for(const id of boundary) total+=Buffer.byteLength(JSON.stringify(input(s,id)));assert.ok(total>192000,'more than one 192 KB batch');
  note(f,'later.md','Written while the harvester runs.');
  let run=readRun(s,c.out.result.run);const seen=[...run.inputs],workers=[run.worker.instance];
  for(let k=1;k<3;k++) {
    const r=complete(s,run.id,judgment(f,s,run,{drop:true}));assert.equal(r.drain.status,'started',JSON.stringify(r.drain));
    run=readRun(s,r.drain.run);seen.push(...run.inputs);workers.push(run.worker.instance);assert.equal(run.status,'running');
  }
  const last=complete(s,run.id,judgment(f,s,run,{drop:true}));assert.equal(last.drain.status,'drained');
  assert.deepEqual([...seen].sort(),[...boundary].sort(),'every boundary input handed on exactly once');assert.equal(new Set(workers).size,3);
  assert.equal(capturesOf(f).length,1,'the drain never recaptures the source');assert.equal(spawnsOf(f).length,3);
  assert.equal(callsOf(f).filter(c=>c.a[0]==='session').length,3);
  const st=loadStatus(s);assert.equal(st.drain,undefined);assert.equal(st.lastDrain.inputs,3);assert.equal(st.captured.inputs.length,3,'the later note awaits a later checkpoint');assert.equal(st.activeRun,null);
  const next=f.cli('harvest');assert.equal(next.out.result.status,'started');assert.deepEqual(next.out.result.inputs,{run:1,pending:1});
});
test('4.2.0 --no-launch requests no drain: its run\'s completion launches nothing later',t=>{
  const f=fixture(t);const s=f.source();put(join(f.dir,'sessions-inert'),'');for(const i of [0,1]) bigNote(f,i);
  const c=f.cli('harvest',['--no-launch']);assert.equal(c.out.result.status,'started');assert.equal(c.out.result.launched,false);assert.equal(loadStatus(s).drain,undefined);
  const run=readRun(s,c.out.result.run);const r=complete(s,run.id,judgment(f,s,run,{drop:true}));assert.equal(r.drain,undefined);
  assert.equal(spawnsOf(f).length,1);assert.equal(callsOf(f).some(c=>c.a[0]==='session'),false);assert.equal(loadStatus(s).activeRun,null);
});
test('4.2.0 the drain re-reads consent: switched off after the checkpoint, the successor is not started and the drain pauses with its resume command',t=>{
  const f=fixture(t);const s=f.source();put(join(f.dir,'sessions-inert'),'');for(const i of [0,1]) bigNote(f,i);
  const c=f.cli('harvest');const run=readRun(s,c.out.result.run);soulOff(f);
  const r=complete(s,run.id,judgment(f,s,run,{drop:true}));assert.equal(r.drain.status,'harvest-off');assert.match(r.drain.next,/run-source --source .* --manual/);
  assert.equal(spawnsOf(f).length,1);assert.match(loadStatus(s).drain.paused.reason,/soul opts out/);assert.equal(loadStatus(s).drain.boundary.length,2);
});
test('4.2.0 retire during an active run records the final tail for that run\'s completion, which hands it on after the source home is gone',t=>{
  const f=fixture(t);const s=f.source();put(join(f.dir,'sessions-inert'),'');note(f);
  const c=f.cli('harvest');const run1=readRun(s,c.out.result.run);
  note(f,'tail.md','The final decision, written just before retirement.');
  const r=f.cli('retire');assert.equal(r.status,0,r.stdout);assert.equal(r.out.meta.retired,true);
  assert.equal(r.out.meta.drain.status,'already-running');assert.equal(r.out.meta.drain.run,run1.id);assert.match(r.out.meta.drain.handoff,/hands it on when it completes/);
  const tail=loadStatus(s).captured.inputs.find(id=>!run1.inputs.includes(id));assert.ok(loadStatus(s).drain.boundary.includes(tail));
  fs.rmSync(f.home,{recursive:true});
  const done=complete(loadSource(s.file),run1.id,judgment(f,s,run1,{drop:true}));assert.equal(done.drain.status,'started');
  const run2=readRun(s,done.drain.run);assert.deepEqual(run2.inputs,[tail]);
  const spawns=spawnsOf(f);assert.ok(spawns[0].a.includes('--parent'));assert.equal(spawns[1].a.includes('--parent'),false,'no live-parent dependency after retirement');
  assert.equal(complete(s,run2.id,judgment(f,s,run2,{drop:true})).drain.status,'drained');assert.equal(loadStatus(s).processed.length,2);
});
test('4.2.0 retire: certified custody with a failed handoff is reported and resumable; never claimed drained',t=>{
  const f=fixture(t);const s=f.source();put(join(f.dir,'sessions-inert'),'');note(f);
  // A failure before any worker effect: the drain is persisted, no run exists.
  const id=()=>loadStatus(s).captured.inputs[0];capture(s);const file=join(dirname(s.file),'inputs',`${id()}.json`),bytes=fs.readFileSync(file);fs.writeFileSync(file,'{"tampered":true}\n');
  const r=f.cli('retire');assert.equal(r.status,0,r.stdout);assert.equal(r.out.meta.retired,true,'custody is certified');
  assert.equal(r.out.meta.drain.status,'failed');assert.equal(r.out.meta.drain.retained,true);assert.match(r.out.meta.drain.next,/run-source --source .* --manual/);
  assert.equal(spawnsOf(f).length,0);assert.equal(loadStatus(s).activeRun,null);assert.deepEqual(loadStatus(s).drain.boundary,[id()]);assert.equal(loadStatus(s).lastDrain,undefined);
  fs.rmSync(f.home,{recursive:true});
  const owed=deploymentCli(f,'harvest-status',['--soul','source']).out.result.sources[0].outstanding;
  assert.deepEqual(owed.map(o=>o.kind),['drain']);assert.match(owed[0].command,/^cd .* && oats okf run-source --source .* --manual --soul source --json$/);
  fs.writeFileSync(file,bytes);
  const resumed=deploymentCli(f,'run-source',['--source',s.file,'--manual']);assert.equal(resumed.status,0,resumed.stdout);
  const run=readRun(s,resumed.out.result.run);assert.equal(complete(s,run.id,judgment(f,s,run,{drop:true})).drain.status,'drained');
  // A failure after the spawn intent: the run is retained, never spawned twice.
  const g=fixture(t);const s2=g.source();note(g);put(join(g.dir,'spawn-fail'),'');
  const r2=g.cli('retire');assert.equal(r2.out.meta.retired,true);assert.equal(r2.out.meta.drain.status,'failed');
  const active=loadStatus(s2).activeRun;assert.equal(readRun(s2,active).status,'spawn-intent');assert.match(r2.out.meta.drain.next.adopt,/retry --source .* --adopt-home/);
  const again=g.cli('retire');assert.equal(again.out.meta.drain.status,'needs-recovery');assert.equal(again.out.meta.drain.run,active);assert.equal(spawnsOf(g).length,1,'an uncertain spawn is never repeated');
});
test('4.2.0 a drain interrupted between its request and its first run, or between a completion and the successor, resumes from custody',t=>{
  const f=fixture(t);const s=f.source();put(join(f.dir,'sessions-inert'),'');for(const i of [0,1]) bigNote(f,i);capture(s);
  // Killed after the durable request, before the run: only the request exists.
  const status=loadStatus(s);status.drain={version:1,boundary:[...status.captured.inputs],by:'checkpoint',requestedAt:new Date().toISOString()};saveStatus(s,status);
  const owed=deploymentCli(f,'harvest-status',['--soul','source']).out.result.sources[0].outstanding;assert.deepEqual(owed.map(o=>[o.kind,o.remaining]),[['drain',2]]);
  const c=f.cli('harvest');assert.equal(c.out.result.status,'started');
  // Killed after activeRun was cleared, during the successor's spawn: the
  // uncertain spawn is named for adoption, never repeated, and nothing is lost.
  const run=readRun(s,c.out.result.run);put(join(f.dir,'spawn-fail'),'');
  const r=complete(s,run.id,judgment(f,s,run,{drop:true}));assert.equal(r.drain.status,'failed');assert.equal(r.status,'processed','the completion itself stands');
  const stuck=loadStatus(s).activeRun;assert.equal(readRun(s,stuck).status,'spawn-intent');
  const h=f.cli('harvest');assert.equal(h.out.result.status,'needs-recovery');assert.equal(h.out.result.run,stuck);assert.match(h.out.result.commands.adopt,/--adopt-home/);
  assert.equal(spawnsOf(f).length,2);assert.equal(loadStatus(s).processed.length,1);assert.equal(loadStatus(s).drain.boundary.length,2);
});
test('4.2.0 confirmed half-staged work continues explicitly in place: no second spawn, a partial stage is redone',t=>{
  const f=fixture(t);const s=f.source();note(f);capture(s);let n=0;
  assert.throws(()=>renameFailure((from,to)=>to.includes('/work/bases/project/') && ++n===2,()=>runSource(s,{manual:true,noLaunch:true})),/injected/);
  const run=readRun(s,loadStatus(s).activeRun);assert.equal(run.status,'scaffolded');assert.ok(run.worker.home);assert.equal(run.stages.project,undefined);
  assert.ok(fs.existsSync(join(run.worker.home,'work/bases/project')),'a partial stage was left behind');
  const h=f.cli('harvest',['--no-launch']);assert.equal(h.out.result.status,'needs-recovery');assert.match(h.out.result.commands.continue,/retry --source/);
  const r=deploymentCli(f,'retry',['--source',s.file]);assert.equal(r.status,0,r.stdout);assert.equal(r.out.result.status,'ready');
  const ready=readRun(s,run.id);assert.equal(ready.stages.project.root,join(run.worker.home,'work/bases/project'));assert.equal(spawnsOf(f).length,1);
  assert.equal(complete(s,run.id,judgment(f,s,ready,{drop:true})).status,'processed');
});
test('4.2.0 capture contention defers a checkpoint and never certifies a final capture; one budget bounds capture and the handoff',t=>{
  const f=fixture(t);const s=f.source();note(f);const lock=join(dirname(s.file),'capture.lock');
  put(join(lock,'owner.json'),JSON.stringify({token:'live',pid:process.pid,host:hostname()}));
  const h=f.cli('harvest');assert.equal(h.status,0,h.stdout);assert.equal(h.out.result.status,'already-running');assert.equal(h.out.result.preparing,true);assert.equal(spawnsOf(f).length,0);
  const r=f.cli('retire');assert.equal(r.status,1);assert.equal(r.out.meta.retired,false);assert.match(r.out.warning,/E_LOCKED/);assert.equal(loadStatus(s).retired,false);
  fs.rmSync(lock,{recursive:true});
  // A spent budget fails capture before any native call advances a cursor.
  save(join(f.dir,'turns.json'),[{id:'t1',thread:'th',kind:'session',ts:'2026-10-06',source:'pi',text:[{role:'user',text:'hello'}]}]);save(join(f.dir,'capture.json'),{status:'complete',complete:true,sessions:[{thread:'th',lastTurnId:'t1'}]});
  assert.throws(()=>capture(s,{deadline:Date.now()-1}),/capture deadline/);assert.deepEqual(loadStatus(s).captured.threads,{});
  capture(s,{final:true});const d=retireDrain(s,{deadline:Date.now()+5000});assert.equal(d.status,'deferred');assert.match(d.next,/--manual/);assert.equal(spawnsOf(f).length,0);
  assert.equal(loadStatus(s).drain.boundary.length,2,'the request is persisted before any effect');
});
test('4.2.0 a live checkpoint settles earlier delivered PRs first: open stays, merge is recorded, a close is recorded once and never rejudged, a GitHub failure is reported apart from capture',t=>{
  const f=fixture(t,{kind:'git'});const s=f.source();
  const deliver=text=>{note(f,`n-${randomUUID()}.md`,text);const {run}=prepared(f,s);const r=complete(s,run.id,judgment(f,s,run));assert.equal(r.receipts.project.status,'delivered');return {run,receipt:r.receipts.project};};
  const one=deliver('First durable decision.');
  const open=f.cli('harvest',['--no-launch']);assert.equal(open.status,0,open.stdout);assert.equal(open.out.result.status,'empty');assert.deepEqual(open.out.result.settled.map(r=>[r.run,r.outcome]),[[one.run.id,'open']]);
  git(f.repo,['merge','--ff-only',one.receipt.branch]);let prs=readJSON(join(f.dir,'pr.json'));Object.assign(prs[0],{state:'MERGED',mergedAt:'2026-10-06T10:00:00Z',mergeCommit:{oid:one.receipt.commit}});save(join(f.dir,'pr.json'),prs);
  const merged=f.cli('harvest',['--no-launch']);assert.deepEqual(merged.out.result.settled.map(r=>[r.run,r.outcome]),[[one.run.id,'accepted']]);assert.equal(loadStatus(s).accepted[`${one.run.id}/project`].status,'accepted');
  const two=deliver('Second durable decision.');prs=readJSON(join(f.dir,'pr.json'));Object.assign(prs[1],{state:'CLOSED',closedAt:'2026-10-06T11:00:00Z'});save(join(f.dir,'pr.json'),prs);
  const closed=f.cli('harvest',['--no-launch']);assert.deepEqual(closed.out.result.settled.map(r=>[r.run,r.outcome]),[[two.run.id,'rejected']]);
  assert.equal(loadStatus(s).delivered[`${two.run.id}/project`].status,'rejected');assert.equal(loadStatus(s).activeRun,null);assert.equal(loadStatus(s).recoveries,undefined,'no automatic rejudgment');
  const ghBefore=fs.readFileSync(join(f.dir,'gh-calls.jsonl'),'utf8');
  const quiet=f.cli('harvest',['--no-launch']);assert.deepEqual(quiet.out.result.settled,[]);assert.equal(fs.readFileSync(join(f.dir,'gh-calls.jsonl'),'utf8'),ghBefore,'a recorded close is not rescanned');
  const three=deliver('Third durable decision.');put(join(f.dir,'gh-unavailable'),'');note(f,'fresh.md','Fresh evidence at this checkpoint.');
  const down=f.cli('harvest',['--no-launch']);assert.equal(down.status,0,down.stdout);assert.equal(down.out.result.status,'started','capture and the new run are independent of settlement');
  assert.deepEqual(down.out.result.settled.map(r=>[r.run,r.outcome]),[[three.run.id,'unsettled']]);assert.match(down.out.result.settled[0].next,/complete --source .* --run /);
  assert.equal(loadStatus(s).delivered[`${three.run.id}/project`].status,'delivered');
});
test('4.2.0 a retired source\'s delivered PRs are listed one by one with their exact command, which records the outcome from custody after both homes are gone',t=>{
  const f=fixture(t,{kind:'git'});const s=f.source();const runs=[];
  for(const text of ['First reviewed decision.','Second reviewed decision.']) {note(f,`n-${runs.length}.md`,text);const {run}=prepared(f,s);complete(s,run.id,judgment(f,s,run));runs.push(readRun(s,run.id));}
  const r=f.cli('retire');assert.equal(r.out.meta.retired,true);assert.equal(r.out.meta.drain.status,'empty');
  fs.rmSync(f.home,{recursive:true});for(const run of runs) fs.rmSync(run.worker.home,{recursive:true});
  const listed=deploymentCli(f,'harvest-status',['--soul','source']).out.result.sources[0];assert.equal(listed.retired,true);
  assert.deepEqual(listed.outstanding.map(o=>[o.kind,o.run]),runs.map(run=>['review',run.id]),'every delivered run, not only the latest');
  for(const [i,o] of listed.outstanding.entries()) assert.equal(o.command,`cd ${f.context} && oats okf complete --source ${s.file} --run ${runs[i].id} --soul source --json`);
  // The maintainer merges one and closes the other; the operator runs the listed commands.
  const receipt=runs[0].receipts.project;git(f.repo,['merge','--ff-only',receipt.branch]);const prs=readJSON(join(f.dir,'pr.json'));
  Object.assign(prs[0],{state:'MERGED',mergedAt:'2026-10-06T10:00:00Z',mergeCommit:{oid:receipt.commit}});Object.assign(prs[1],{state:'CLOSED',closedAt:'2026-10-06T11:00:00Z'});save(join(f.dir,'pr.json'),prs);
  const accepted=deploymentCli(f,'complete',['--source',s.file,'--run',runs[0].id]);assert.equal(accepted.status,0,accepted.stdout);assert.equal(accepted.out.result.receipts.project.status,'accepted');
  const rejected=deploymentCli(f,'complete',['--source',s.file,'--run',runs[1].id]);assert.equal(rejected.status,1);assert.equal(rejected.out.error.code,'E_PR');
  assert.equal(loadStatus(s).delivered[`${runs[1].id}/project`].status,'rejected');
  assert.deepEqual(deploymentCli(f,'harvest-status',['--soul','source']).out.result.sources[0].outstanding,[]);
  // The explicit closed-PR rejudgment stays available and unchanged.
  const rejudged=deploymentCli(f,'retry',['--source',s.file,'--run',runs[1].id,'--rejudge']);assert.equal(rejudged.status,0,rejudged.stdout);assert.equal(rejudged.out.result.recoveryOf,runs[1].id);
});
const legacyJob=(source,extra={})=>({id:`okf-${source.id}`,kind:'command',enabled:true,cron:'*/15 * * * *',tz:'UTC',cwd:source.context,argv:legacyScheduleArgv(source),...extra});
test('4.2.0 setup --remove-schedules removes only proven own jobs (enabled, disabled, custom cadence), leaves foreign and running ones, keeps evidence, and is repeat-safe',t=>{
  const f=fixture(t);const [own,custom,foreign,running,absent]=['seat-a','seat-b','seat-c','seat-d','seat-e'].map(name=>seat(f,name));
  const jobs={[`okf-${own.id}`]:legacyJob(own),[`okf-${custom.id}`]:legacyJob(custom,{enabled:false,cron:'0 3 * * 1',tz:'Europe/Madrid'}),
    [`okf-${foreign.id}`]:legacyJob(foreign,{argv:['oats','okf','run-source','--source','/elsewhere/source.json','--soul','source','--json']}),
    [`okf-${running.id}`]:legacyJob(running),'okf-not-a-source':{id:'okf-not-a-source',kind:'command',enabled:true,cron:'* * * * *',tz:'UTC',cwd:f.context,argv:['oats','okf','harvest-status']},
    'harvest-review':{id:'harvest-review',kind:'command',enabled:true,cron:'*/5 * * * *',tz:'UTC',cwd:f.context,argv:['oats','status']}};
  save(join(f.dir,'schedules.json'),jobs);put(join(f.dir,`schedule-running-okf-${running.id}`),'1');
  const first=deploymentCli(f,'setup',['--remove-schedules']);assert.equal(first.status,1);assert.equal(first.out.error.code,'E_SCHEDULE_OWNERSHIP');
  const result=first.out.error.result;assert.deepEqual(result.removed.sort(),[`okf-${own.id}`,`okf-${custom.id}`].sort());assert.ok(result.absent.includes(`okf-${absent.id}`));
  assert.deepEqual(result.leftovers.map(r=>[r.job,r.status,r.code]).sort(),[[`okf-${foreign.id}`,'foreign','E_SCHEDULE_OWNERSHIP'],[`okf-${running.id}`,'pending','E_SCHEDULE_MIGRATION_PENDING']].sort());
  assert.match(first.out.error.message,/Done: .*removed/);
  const after=readJSON(join(f.dir,'schedules.json'));assert.deepEqual(after[`okf-${foreign.id}`],jobs[`okf-${foreign.id}`],'a foreign definition is untouched');
  assert.equal(after[`okf-${running.id}`].enabled,false,'a running job stays, disabled');for(const id of ['okf-not-a-source','harvest-review']) assert.deepEqual(after[id],jobs[id],'never by prefix');
  const evidence=fs.readdirSync(join(dirname(custom.file),'schedule-migration')).map(n=>readJSON(join(dirname(custom.file),'schedule-migration',n)));assert.deepEqual(evidence.map(e=>e.definition),[jobs[`okf-${custom.id}`]]);
  assert.deepEqual(readJSON(join(dirname(own.file),'schedule-migration.json')).effects.map(e=>[e.step,e.result]),[['disable','confirmed'],['remove','confirmed']]);
  assert.deepEqual(readJSON(join(dirname(custom.file),'schedule-migration.json')).effects.map(e=>[e.step,e.result]),[['remove','confirmed']],'a disabled job is not re-disabled');
  assert.equal(loadStatus(own).schedule.removed,true);
  const scheduleCalls=callsOf(f).filter(c=>c.a[0]==='schedule');assert.equal(scheduleCalls.some(c=>c.a.includes('--force') || c.a.includes('host') || c.a[1]==='add'),false);
  assert.equal(scheduleCalls.some(c=>['okf-not-a-source','harvest-review'].includes(c.a[2])),false);
  // The operator settles the running job and deals with the foreign one; the rerun finishes, and again is a no-op.
  fs.rmSync(join(f.dir,`schedule-running-okf-${running.id}`));const settled=readJSON(join(f.dir,'schedules.json'));delete settled[`okf-${foreign.id}`];save(join(f.dir,'schedules.json'),settled);
  const second=deploymentCli(f,'setup',['--remove-schedules']);assert.equal(second.status,0,second.stdout);assert.deepEqual(second.out.result.removed,[`okf-${running.id}`]);
  const third=deploymentCli(f,'setup',['--remove-schedules']);assert.equal(third.status,0,third.stdout);assert.deepEqual(third.out.result.removed,[]);assert.equal(third.out.result.absent.length,5);
  assert.deepEqual(Object.keys(readJSON(join(f.dir,'schedules.json'))).sort(),['harvest-review','okf-not-a-source']);
});
test('4.2.0 setup --remove-schedules: an unconfirmed removal is reported pending and the rerun confirms it; a scheduler outage reports both sides',t=>{
  const f=fixture(t);const [a,b]=['seat-a','seat-b'].map(name=>seat(f,name));
  save(join(f.dir,'schedules.json'),{[`okf-${a.id}`]:legacyJob(a),[`okf-${b.id}`]:legacyJob(b)});put(join(f.dir,'schedule-remove-flaky'),'');
  const first=deploymentCli(f,'setup',['--remove-schedules']);assert.equal(first.status,1);assert.equal(first.out.error.code,'E_SCHEDULE_MIGRATION_PENDING');
  assert.deepEqual(first.out.error.result.leftovers.map(r=>r.status),['failed','failed']);assert.equal(loadStatus(a).schedule,undefined,'an unconfirmed removal is not recorded as removed');
  assert.deepEqual(readJSON(join(dirname(a.file),'schedule-migration.json')).effects.map(e=>[e.step,e.result]),[['disable','confirmed'],['remove','unknown']]);
  fs.rmSync(join(f.dir,'schedule-remove-flaky'));const second=deploymentCli(f,'setup',['--remove-schedules']);assert.equal(second.status,0,second.stdout);assert.equal(second.out.result.absent.length,2);
  const g=fixture(t);const c=seat(g,'seat-c');save(join(g.dir,'schedules.json'),{[`okf-${c.id}`]:legacyJob(c)});put(join(g.dir,'schedule-fail'),'');
  const down=deploymentCli(g,'setup',['--remove-schedules']);assert.equal(down.out.error.code,'E_SCHEDULE_MIGRATION_PENDING');assert.match(down.out.error.message,/Done: none/);
  assert.equal(readJSON(join(g.dir,'schedules.json'))[`okf-${c.id}`].enabled,true);
});
test('4.2.0 live cron/tz bindings are refused with the migration remedy; a frozen pre-4.2 descriptor stays readable, inert and unmodified through checkpoint, complete and retire',t=>{
  const f=fixture(t);const s=f.source();note(f);capture(s);
  // A source descriptor as okf 4.1 froze it: bindings with cron/tz, a ready schedule receipt and job definition.
  const legacy=readJSON(s.file);legacy.bindings={...legacy.bindings,cron:'*/15 * * * *',tz:'UTC'};save(s.file,legacy);
  const status=loadStatus(s);status.schedule={id:`okf-${s.id}`,status:'ready',result:{schedule:legacyJob(s)}};saveStatus(s,status);save(join(dirname(s.file),'schedule.json'),legacyJob(s));
  const bytes=fs.readFileSync(s.file);const frozen=loadSource(s.file);assert.equal(frozen.bindingFingerprint,s.bindingFingerprint);
  const raw=readJSON(f.bindingFile);save(f.bindingFile,{...raw,cron:'0 * * * *'});
  const fresh=join(f.context,'fresh-seat');fs.mkdirSync(join(fresh,'work'),{recursive:true});save(join(fresh,'instance.json'),{instance:'fresh-seat',agent:'source',repo:f.context,work:'directory',launched:true});
  const refused=f.cli('spawn',[],{OATS_HOME:fresh,OATS_INSTANCE_HOME:fresh,OATS_INSTANCE:'fresh-seat'});assert.equal(refused.status,1);assert.match(refused.out.warning,/E_HARVEST_SCHEDULE_REMOVED: .*Remove cron\/tz from the bindings file; then run oats okf setup --remove-schedules --soul <source soul> from the deployment/);
  assert.equal(deploymentCli(f,'setup',['--remove-schedules']).out.error.code,'E_HARVEST_SCHEDULE_REMOVED');
  assert.match(deploymentCli(f,'harvest-status',['--soul','source']).out.result.error,/E_HARVEST_SCHEDULE_REMOVED/);
  const h=f.cli('harvest',['--no-launch']);assert.equal(h.status,0,h.stdout);assert.equal(h.out.result.status,'started','the registered seat reads its frozen descriptor, not the live file');
  const run=readRun(s,h.out.result.run);assert.equal(complete(frozen,run.id,judgment(f,s,run,{drop:true})).status,'processed');
  const r=f.cli('retire');assert.equal(r.status,0,r.stdout);assert.equal(r.out.meta.retired,true);
  assert.deepEqual(fs.readFileSync(s.file),bytes,'immutable custody is never rewritten');assert.equal(callsOf(f).some(c=>c.a[0]==='schedule'),false,'an old job is never touched implicitly');
  save(f.bindingFile,raw);const migrated=deploymentCli(f,'setup',['--remove-schedules']);assert.equal(migrated.status,0,migrated.stdout);assert.deepEqual(migrated.out.result.absent,[`okf-${s.id}`]);
});
test('4.2.0 checkpoint settlement never turns a missing or mismatched PR into acceptance',t=>{
  const f=fixture(t,{kind:'git'});const s=f.source();note(f);const {run}=prepared(f,s);complete(s,run.id,judgment(f,s,run));
  const prs=readJSON(join(f.dir,'pr.json'));
  for(const forged of [[],[{...prs[0],headRefOid:'0'.repeat(40),state:'MERGED',mergedAt:'2026-10-06T10:00:00Z'}],[{...prs[0],number:99,url:'https://github.com/fixture/knowledge/pull/99',state:'MERGED',mergedAt:'2026-10-06T10:00:00Z'}]]) {
    save(join(f.dir,'pr.json'),forged);
    const h=f.cli('harvest',['--no-launch']);assert.equal(h.status,0,h.stdout);assert.equal(h.out.result.settled[0].outcome,'unsettled',JSON.stringify(h.out.result.settled));
    assert.equal(loadStatus(s).delivered[`${run.id}/project`].status,'delivered');assert.equal(loadStatus(s).accepted[`${run.id}/project`],undefined);
  }
});

// okf 4.2.0 review R1 regressions: each asserts the corrected contract.
const ghCalls=f=>fs.existsSync(join(f.dir,'gh-calls.jsonl'))?fs.readFileSync(join(f.dir,'gh-calls.jsonl'),'utf8'):'';
const sessionsOf=f=>callsIn(f).filter(c=>c.a[0]==='session');
/** Run `fn` recording every subprocess this process starts (binary, argv,
 *  timeout, and what is left of `deadline` at that moment). `after(call)` may
 *  advance this process's clock once the call returns: a slow step, with no
 *  real wait. `fail(call)` answers a call with a failure instead of running
 *  it: a transport failure, with no real network. */
function observeCalls(fn,{deadline,after,fail}={}) {
  const original=cp.spawnSync,now=Date.now,seen=[];let skew=0;
  Date.now=()=>now()+skew;
  cp.spawnSync=function(bin,args,opts) {
    const call={bin,args,timeout:opts?.timeout,...(deadline===undefined?{}:{remaining:deadline-Date.now()})};seen.push(call);
    if(fail?.(call)) return {status:128,signal:null,pid:0,output:[null,'','fatal: transport failure'],stdout:'',stderr:'fatal: transport failure'};
    const result=original.apply(this,arguments);skew+=after?.(call) || 0;return result;
  };
  syncBuiltinESMExports();
  try {return {result:fn(),seen};} finally {Date.now=now;cp.spawnSync=original;syncBuiltinESMExports();}
}
const isSpawn=c=>c.args[0]==='spawn' && !c.args.includes('--preview');
/** A Git source whose one run delivered two destinations, each in its own repository with its own PR. */
function twoGitDestinations(t) {
  const f=fixture(t,{kind:'git'}),raw=readJSON(f.bindingFile),repo2=join(f.dir,'repo2');fs.mkdirSync(repo2);git(repo2,['init','-q','--initial-branch=main']);
  raw.bases.secondary={...raw.bases.project,id:'base-2',repository:repo2};save(f.bindingFile,raw);
  const seed=join(f.dir,'seed2');initBase(loadBindings(),'secondary',join(f.dir,'nodes.json'),seed);fs.cpSync(seed,join(repo2,'knowledge'),{recursive:true});fixtureCommit(repo2,'seed2');
  const decl=readJSON(join(f.soul,'okf.json'));decl.owns.push('secondary/expert');save(join(f.soul,'okf.json'),decl);
  note(f);const {s,run}=prepared(f);const j=judgment(f,s,run),both=readJSON(j);judgment(f,s,run,{base:'secondary'});both.outcomes[0].concepts.push(...readJSON(j).outcomes[0].concepts);save(j,both);
  const delivered=complete(s,run.id,j);for(const alias of ['project','secondary']) assert.equal(delivered.receipts[alias].status,'delivered');
  return {f,s,run:readRun(s,run.id),repo2};
}
function mergeDelivered(f,repo,receipt) {
  git(repo,['merge','--ff-only',receipt.branch]);const prs=readJSON(join(f.dir,'pr.json'));
  Object.assign(prs.find(p=>p.number===receipt.pr.number),{state:'MERGED',mergedAt:'2026-10-06T10:00:00Z',mergeCommit:{oid:receipt.commit}});save(join(f.dir,'pr.json'),prs);
}
/** The maintainer amends the delivered PR, squash-merges it, and records the okf-review verdict naming the merged head. */
function amendMerged(f,repo,receipt) {
  const cid=['-c','user.name=Maintainer','-c','user.email=maintainer@example.invalid'];
  git(repo,['checkout','-q',receipt.branch]);fs.appendFileSync(join(repo,'knowledge/expert/decision.md'),'Superseded wording, amended in review.\n');
  git(repo,['add','.']);git(repo,[...cid,'commit','-qm','okf-review amendment']);const amended=git(repo,['rev-parse','HEAD']);
  git(repo,['checkout','-q','main']);git(repo,['merge','--squash','-q',receipt.branch]);git(repo,[...cid,'commit','-qm','squash merge']);const merge=git(repo,['rev-parse','HEAD']);
  const prs=readJSON(join(f.dir,'pr.json')),pr=prs.find(p=>p.number===receipt.pr.number);
  const block=JSON.stringify({verdict:'amend+merge',pr:pr.url,headSha:amended,checks:{},amendments:['expert/decision.md: wording'],reason:'fixable'});
  Object.assign(pr,{state:'MERGED',mergedAt:'2026-10-06T12:00:00Z',mergeCommit:{oid:merge},headRefOid:amended,mergedBy:{login:'maintainer'},comments:[{author:{login:'host'},authorAssociation:'OWNER',body:`\`\`\`okf-review\n${block}\n\`\`\``}]});
  save(join(f.dir,'pr.json'),prs);return {amended,merge};
}
const statuses=receipts=>Object.fromEntries(Object.entries(receipts).map(([alias,r])=>[alias,r.status]));
test('4.2.0 every path that starts a run takes an explicitly requested rejudgment first, with its lineage, and never while a PR of an earlier attempt is open again',t=>{
  // An ordinary baseline conflict: the next checkpoint rejudges exactly the abandoned run's inputs.
  {const f=fixture(t,{kind:'git'});const s=f.source();note(f);const {run}=prepared(f,s);const j=judgment(f,s,run,{drop:true});
    acceptedCommit(f,{'knowledge/peer/log.md':'* another writer\n'});assert.throws(()=>complete(s,run.id,j),e=>e.code==='E_BASELINE');
    assert.equal(retry(s,{rejudge:true}).status,'abandoned');assert.equal(loadStatus(s).pendingRejudgment,run.id);
    note(f,'later.md','Written after the conflict.');
    const h=checkpointHarvest(s,{noLaunch:true});assert.equal(h.status,'started',JSON.stringify(h));assert.equal(h.recoveryOf,run.id);
    const next=readRun(s,h.run),st=loadStatus(s);
    assert.deepEqual(next.inputs,run.inputs,'the rejudgment takes its own inputs first');assert.equal(next.recoveryOf,run.id);assert.deepEqual(next.recoveryGuards,[]);
    assert.equal(st.pendingRejudgment,undefined);assert.equal(st.recoveries[run.id],next.id);
    assert.deepEqual(readJSON(join(dirname(s.file),'runs',next.id,'previous.json')),readRun(s,run.id));assert.ok(fs.existsSync(join(next.worker.home,'work/previous.json')));
  }
  // A closed PR, explicitly rejudged, then reopened: no path starts a run (no second PR); closed again, the checkpoint rejudges.
  const closedThenRejudged=()=>{
    const f=fixture(t,{kind:'git'});const s=f.source();note(f);const {run}=prepared(f,s);put(join(f.dir,'gh-uncertain'),'');
    assert.throws(()=>complete(s,run.id,judgment(f,s,run)));fs.rmSync(join(f.dir,'gh-uncertain'));closePR(f,1);
    assert.throws(()=>complete(s,run.id),{code:'E_PR'});assert.equal(retry(s,{rejudge:true}).status,'abandoned');
    assert.equal(readRun(s,run.id).recoveryGuards.length,1);closePR(f,1,'OPEN');return {f,s,run};
  };
  const openPRs=f=>readJSON(join(f.dir,'pr.json')).filter(p=>p.state==='OPEN').length;
  {const {f,s,run}=closedThenRejudged();
    const blocked=checkpointHarvest(s,{noLaunch:true});assert.equal(blocked.status,'needs-recovery');assert.equal(blocked.phase,'pending-rejudgment');assert.equal(blocked.run,run.id);
    assert.equal(loadStatus(s).activeRun,null);assert.equal(loadStatus(s).pendingRejudgment,run.id);assert.equal(spawnsOf(f).length,1);
    assert.deepEqual(outstanding(s,loadStatus(s)).map(o=>o.kind).filter(k=>k==='rejudgment'),['rejudgment']);
    closePR(f,1);
    const h=checkpointHarvest(s,{noLaunch:true});assert.equal(h.status,'started');assert.equal(h.recoveryOf,run.id);
    const next=readRun(s,h.run);assert.deepEqual(next.recoveryGuards,readRun(s,run.id).recoveryGuards,'the guards travel with the lineage');assert.equal(loadStatus(s).pendingRejudgment,undefined);
    const done=complete(s,next.id,judgment(f,s,next));assert.equal(done.receipts.project.status,'delivered');
    assert.equal(openPRs(f),1,'never two open PRs for the same evidence');assert.equal(readJSON(join(f.dir,'pr.json')).length,2);
  }
  // The retire handoff and the operator's run-source select the same way.
  {const {f,s,run}=closedThenRejudged();capture(s,{final:true});
    const d=retireDrain(s);assert.equal(d.status,'needs-recovery');assert.equal(d.phase,'pending-rejudgment');assert.equal(spawnsOf(f).length,1);assert.equal(loadStatus(s).drain.boundary.length,1);
    const manual=deploymentCli(f,'run-source',['--source',s.file,'--manual','--no-launch']);assert.equal(manual.out.error.code,'E_RECOVERY');
    closePR(f,1);
    const resumed=deploymentCli(f,'run-source',['--source',s.file,'--manual','--no-launch']);assert.equal(resumed.status,0,resumed.stdout);
    assert.equal(readRun(s,resumed.out.result.run).recoveryOf,run.id);assert.equal(openPRs(f),0);
  }
});
test('4.2.0 nothing is dispatched past the invocation deadline: a prepared worker stays ready, is reported deferred with its exact launch command, is never launched by a repeat, and launches on an explicit retry --launch',t=>{
  const f=fixture(t);const s=f.source();put(join(f.dir,'sessions-inert'),'');note(f);capture(s,{final:true});
  const deadline=Date.now()+110000;
  // The spawn returns with about 5 s of the budget left.
  const {result:d,seen}=observeCalls(()=>retireDrain(s,{deadline}),{deadline,after:c=>isSpawn(c)?105000:0});
  assert.equal(d.status,'deferred',JSON.stringify(d));assert.equal(d.phase,'ready');assert.equal(d.launched,false);assert.equal(d.home,readRun(s,d.run).worker.home);
  assert.equal(d.next,`cd ${f.context} && oats okf retry --source ${s.file} --launch --soul source --json`);
  assert.equal(seen.some(c=>c.args[0]==='session'),false,'no session start once too little is left');assert.equal(readRun(s,d.run).status,'ready');
  for(const again of [retireDrain(s,{deadline:Date.now()+110000}),checkpointHarvest(s,{deadline:Date.now()+110000}),f.cli('retire').out.meta.drain]) {
    assert.equal(again.status,'deferred');assert.equal(again.run,d.run);assert.equal(again.launched,false);
  }
  assert.equal(spawnsOf(f).length,1);assert.equal(sessionsOf(f).length,0);
  assert.deepEqual(outstanding(s,loadStatus(s)).map(o=>o.kind),['deferred','drain']);
  const go=deploymentCli(f,'retry',['--source',s.file,'--launch']);assert.equal(go.status,0,go.stdout);
  assert.equal(readRun(s,d.run).status,'running');assert.equal(readRun(s,d.run).launchDeferred,undefined);assert.equal(sessionsOf(f).length,1);assert.equal(spawnsOf(f).length,1);
  // Staging cut short by the deadline: the confirmed worker is not launched, and continues in place on retry --launch.
  const g=fixture(t,{kind:'git'});const s2=g.source();put(join(g.dir,'sessions-inert'),'');note(g);capture(s2,{final:true});
  const end=Date.now()+110000;
  const {result:e,seen:calls}=observeCalls(()=>retireDrain(s2,{deadline:end}),{deadline:end,after:c=>c.bin==='git' && c.args.includes('clone')?200000:0});
  assert.equal(e.status,'deferred',JSON.stringify(e));assert.equal(e.phase,'scaffolded');assert.equal(e.launched,false);assert.match(e.next,/retry --source .* --launch/);
  assert.equal(calls.some(c=>c.args[0]==='session'),false);
  for(const c of calls) assert.ok(c.remaining>0 && c.timeout<=c.remaining,`${c.bin} ${c.args.slice(0,3).join(' ')} started with timeout ${c.timeout} and ${c.remaining} ms left`);
  const go2=deploymentCli(g,'retry',['--source',s2.file,'--launch']);assert.equal(go2.status,0,go2.stdout);
  assert.equal(readRun(s2,e.run).status,'running');assert.equal(spawnsOf(g).length,1,'no second spawn');assert.equal(sessionsOf(g).length,1);
});
test('4.2.0 one deadline bounds every blocking call of a checkpoint (settlement, capture, staging, launch); a call without one keeps its own timeout',t=>{
  const f=fixture(t,{kind:'git'});const s=f.source();put(join(f.dir,'sessions-inert'),'');note(f);const {run}=prepared(f,s);complete(s,run.id,judgment(f,s,run));
  note(f,'fresh.md','Fresh evidence at this checkpoint.');
  const deadline=Date.now()+110000;
  const {result:h,seen}=observeCalls(()=>checkpointHarvest(s,{deadline}),{deadline});
  assert.equal(h.status,'started',JSON.stringify(h));assert.equal(h.launched,true);assert.deepEqual(h.settled.map(r=>r.outcome),['open']);
  for(const kind of ['gh','clone','fetch','capture','spawn','session']) assert.ok(seen.some(c=>c.bin===kind || c.args.includes(kind)),`${kind} ran`);
  for(const c of seen) assert.ok(c.timeout<=c.remaining,`${c.bin} ${c.args.slice(0,3).join(' ')}: timeout ${c.timeout} > ${c.remaining} ms left`);
  // An operator's complete has no invocation deadline: Git keeps its configured timeout.
  const next=readRun(s,h.run);const {seen:plain}=observeCalls(()=>complete(s,next.id,judgment(f,s,next,{drop:true})));
  assert.ok(plain.some(c=>c.bin==='git' && c.args.includes('fetch') && c.timeout===600000));
  // A shorter budget bounds them as tightly.
  const late=Date.now()+20000;const {seen:none}=observeCalls(()=>checkpointHarvest(s,{deadline:late}),{deadline:late});
  assert.ok(none.length && none.every(c=>c.timeout<=c.remaining));
});
test('4.2.0 a --no-launch checkpoint over an earlier drain request launches nothing at completion: the drain is held visibly until an explicit retry --launch',t=>{
  const f=fixture(t);const s=f.source();put(join(f.dir,'sessions-inert'),'');for(const i of [0,1,2]) bigNote(f,i);
  const deferred=checkpointHarvest(s,{deadline:Date.now()+5000});assert.equal(deferred.status,'deferred');assert.equal(loadStatus(s).drain.boundary.length,3);
  const diagnostic=f.cli('harvest',['--no-launch']);assert.equal(diagnostic.out.result.launched,false);
  const run=readRun(s,diagnostic.out.result.run);assert.equal(run.noLaunch,true);
  const r=complete(s,run.id,judgment(f,s,run,{drop:true}));assert.equal(r.drain.status,'held',JSON.stringify(r.drain));assert.match(r.drain.next,/retry --source .* --launch/);
  assert.equal(sessionsOf(f).length,0);assert.equal(spawnsOf(f).length,1);
  const st=loadStatus(s);assert.equal(st.activeRun,null);assert.equal(st.drain.boundary.length,3,'the earlier request is kept');assert.equal(st.drain.paused.kind,'no-launch');
  const owed=outstanding(s,st);assert.deepEqual(owed.map(o=>[o.kind,o.remaining]),[['drain',2]]);
  assert.equal(owed[0].command,`cd ${f.context} && oats okf retry --source ${s.file} --launch --soul source --json`);
  complete(s,run.id);assert.equal(sessionsOf(f).length,0,'a repeated completion launches nothing either');assert.equal(spawnsOf(f).length,1);
  const go=deploymentCli(f,'retry',['--source',s.file,'--launch']);assert.equal(go.status,0,go.stdout);
  const next=readRun(s,go.out.result.run);assert.equal(next.status,'running');assert.equal(sessionsOf(f).length,1);assert.equal(loadStatus(s).drain.paused,undefined);
  const r2=complete(s,next.id,judgment(f,s,next,{drop:true}));assert.equal(r2.drain.status,'started','an explicitly launched run hands the drain on');assert.equal(sessionsOf(f).length,2);
});
test('4.2.0 scope: a source-only harvest override admits the checkpoint, but continuation in deployment scope with the deployment off pauses visibly, names its prerequisite and keeps custody',t=>{
  const f=fixture(t);const s=f.source();put(join(f.dir,'sessions-inert'),'');for(const i of [0,1,2]) bigNote(f,i);
  const on=process.env.OATS_SETTINGS,off=JSON.stringify({...JSON.parse(on),harvest:'off'});
  const c=f.cli('harvest');assert.equal(c.out.result.status,'started');assert.match(c.out.result.drain.prerequisite,/deployment switches harvest on/);
  const run=readRun(s,c.out.result.run);
  const retired=f.cli('retire');assert.equal(retired.out.meta.retired,true);assert.equal(retired.out.meta.drain.status,'already-running');assert.match(retired.out.meta.drain.prerequisite,/source-only spawn override/);
  fs.rmSync(f.home,{recursive:true});
  process.env.OATS_SETTINGS=off; // the completion runs in the deployment's scope, which is off
  const done=complete(loadSource(s.file),run.id,judgment(f,s,run,{drop:true}));
  assert.equal(done.drain.status,'harvest-off');assert.equal(done.drain.remaining,2);assert.match(done.drain.next,/^once the deployment switches harvest on .*run-source --source .* --manual/);
  assert.equal(spawnsOf(f).length,1);const st=loadStatus(s);assert.equal(st.activeRun,null);assert.equal(st.drain.paused.kind,'harvest-off');assert.equal(st.drain.boundary.length,3);
  const owed=deploymentCli(f,'harvest-status',['--soul','source']).out.result.sources[0].outstanding;assert.deepEqual(owed.map(o=>[o.kind,o.remaining]),[['drain',2]]);assert.match(owed[0].prerequisite,/source-only spawn override/);
  for(const [cmd,args] of [['run-source',['--source',s.file,'--manual']],['retry',['--source',s.file,'--launch']]]) {const r=deploymentCli(f,cmd,args);assert.equal(r.out.result.status,'harvest-off',r.stdout);}
  assert.equal(spawnsOf(f).length,1,'nothing starts while the deployment is off');
  const resumed=deploymentCli(f,'run-source',['--source',s.file,'--manual'],{OATS_SETTINGS:on});assert.equal(resumed.out.result.status,'running',resumed.stdout);
});
test('4.2.0 the state between a processed completion and its successor is named by harvest-status and continued by the next checkpoint, never by complete again',t=>{
  const f=fixture(t);const s=f.source();put(join(f.dir,'sessions-inert'),'');for(const i of [0,1]) bigNote(f,i);
  const run=readRun(s,checkpointHarvest(s).run);
  complete(s,run.id,judgment(f,s,run,{drop:true}),{continueDrain:false}); // the durable state of a kill right after processing
  assert.equal(complete(s,run.id).drain,undefined);assert.equal(spawnsOf(f).length,1);
  const owed=outstanding(s,loadStatus(s));assert.deepEqual(owed.map(o=>[o.kind,o.remaining]),[['drain',1]]);assert.match(owed[0].command,/run-source --source .* --manual/);
  const h=checkpointHarvest(s);assert.equal(h.status,'started');assert.equal(readRun(s,h.run).inputs.length,1);assert.equal(spawnsOf(f).length,2);
});
test('4.2.0 each destination of a run settles on its own: a close never holds back another\'s merge, outage or reviewed amended merge, and repeats or the post-retire command record each outcome once',t=>{
  {const {f,s,run,repo2}=twoGitDestinations(t);closePR(f,run.receipts.project.pr.number);mergeDelivered(f,repo2,run.receipts.secondary);
    const first=checkpointHarvest(s,{noLaunch:true});assert.deepEqual(first.settled.map(r=>[r.run,r.outcome]),[[run.id,'rejected']]);
    assert.deepEqual(statuses(first.settled[0].receipts),{project:'rejected',secondary:'accepted'});
    assert.equal(loadStatus(s).accepted[`${run.id}/secondary`].status,'accepted');assert.equal(loadStatus(s).recoveries,undefined,'no automatic rejudgment');
    const before=ghCalls(f);assert.deepEqual(checkpointHarvest(s,{noLaunch:true}).settled,[]);assert.equal(ghCalls(f),before,'recorded outcomes are not read again');
    assert.deepEqual(outstanding(s,loadStatus(s)),[]);
  }
  {const {f,s,run}=twoGitDestinations(t);closePR(f,run.receipts.project.pr.number);put(join(f.dir,`gh-view-fail-${run.receipts.secondary.pr.number}`),'');
    const row=checkpointHarvest(s,{noLaunch:true}).settled[0];
    assert.equal(row.outcome,'unsettled','one rejection never hides a destination still owed');assert.equal(row.receipts.project.status,'rejected');
    assert.equal(row.receipts.secondary.status,'delivered');assert.match(row.receipts.secondary.error.message,/unreachable/);assert.match(row.next,/okf complete --source .* --run /);
    const owed=outstanding(s,loadStatus(s));assert.deepEqual(owed.map(o=>[o.kind,o.run]),[['review',run.id]]);assert.deepEqual(statuses(owed[0].destinations),{project:'rejected',secondary:'delivered'});
    fs.rmSync(join(f.dir,`gh-view-fail-${run.receipts.secondary.pr.number}`));
    const again=checkpointHarvest(s,{noLaunch:true}).settled[0];assert.equal(again.outcome,'open');assert.deepEqual(statuses(again.receipts),{project:'rejected',secondary:'delivered'});
  }
  {const {f,s,run,repo2}=twoGitDestinations(t);closePR(f,run.receipts.project.pr.number);const {amended,merge}=amendMerged(f,repo2,run.receipts.secondary);
    const row=checkpointHarvest(s,{noLaunch:true}).settled[0];assert.deepEqual(statuses(row.receipts),{project:'rejected',secondary:'accepted'});
    const receipt=readRun(s,run.id).receipts.secondary;assert.equal(receipt.mergeCommit,merge);assert.equal(receipt.mergedHead,amended);assert.equal(receipt.verdict,'amend+merge');
  }
  {const {f,s,run,repo2}=twoGitDestinations(t);
    const r=f.cli('retire');assert.equal(r.out.meta.retired,true);fs.rmSync(f.home,{recursive:true});fs.rmSync(run.worker.home,{recursive:true});
    closePR(f,run.receipts.project.pr.number);mergeDelivered(f,repo2,run.receipts.secondary);
    const owed=deploymentCli(f,'harvest-status',['--soul','source']).out.result.sources[0].outstanding;assert.deepEqual(owed.map(o=>[o.kind,o.run]),[['review',run.id]]);
    assert.equal(owed[0].command,`cd ${f.context} && oats okf complete --source ${s.file} --run ${run.id} --soul source --json`);
    const first=deploymentCli(f,'complete',['--source',s.file,'--run',run.id]);assert.equal(first.status,1);assert.equal(first.out.error.code,'E_PR');assert.match(first.out.error.message,/closed without merge/);
    assert.deepEqual(statuses(first.out.error.result.receipts),{project:'rejected',secondary:'accepted'},'the merge is recorded although the other PR was closed');
    const repeat=deploymentCli(f,'complete',['--source',s.file,'--run',run.id]);assert.equal(repeat.status,0,repeat.stdout);assert.equal(repeat.out.result.status,'rejected');
    assert.deepEqual(statuses(repeat.out.result.receipts),{project:'rejected',secondary:'accepted'});
    assert.equal(loadStatus(s).accepted[`${run.id}/secondary`].status,'accepted');assert.deepEqual(deploymentCli(f,'harvest-status',['--soul','source']).out.result.sources[0].outstanding,[]);
  }
});
test('4.2.0 a settlement that fails part way stays owed: a transient GitHub error never drops a delivered PR from checkpoints or harvest-status',t=>{
  const f=fixture(t,{kind:'git'});const s=f.source();note(f);const {run}=prepared(f,s);complete(s,run.id,judgment(f,s,run));
  const listed=()=>deploymentCli(f,'harvest-status',['--soul','source']).out.result.sources[0].outstanding;
  assert.deepEqual(listed().map(o=>[o.kind,o.run,o.destinations.project.status]),[['review',run.id,'delivered']]);
  put(join(f.dir,'gh-view-fail-at'),'2'); // the second PR read of the next settlement fails
  const first=checkpointHarvest(s,{noLaunch:true});assert.deepEqual(first.settled.map(r=>[r.run,r.outcome]),[[run.id,'unsettled']]);
  assert.equal(readRun(s,run.id).receipts.project.status,'pr-unknown');
  const during=listed();assert.deepEqual(during.map(o=>[o.kind,o.run]),[['review',run.id]]);assert.equal(during[0].destinations.project.status,'pr-unknown');
  assert.match(during[0].destinations.project.error,/transient/);assert.equal(during[0].command,`cd ${f.context} && oats okf complete --source ${s.file} --run ${run.id} --soul source --json`);
  fs.rmSync(join(f.dir,'gh-view-fail-at'));
  const second=checkpointHarvest(s,{noLaunch:true});assert.deepEqual(second.settled.map(r=>[r.run,r.outcome]),[[run.id,'open']]);assert.equal(readRun(s,run.id).receipts.project.status,'delivered');
  assert.deepEqual(listed().map(o=>[o.kind,o.destinations.project.status]),[['review','delivered']]);
  mergeDelivered(f,f.repo,readRun(s,run.id).receipts.project);
  assert.deepEqual(checkpointHarvest(s,{noLaunch:true}).settled.map(r=>r.outcome),['accepted']);assert.deepEqual(listed(),[]);
});
// The released okf 4.1.1 (BASE of 4.2.0), extracted from this repository's
// history: rollback and migration evidence runs its actual code. CI checks out
// full history (fetch-depth: 0); elsewhere a shallow clone skips with a reason.
const BASE_RELEASE='e1d604f70c5e4cdc39602095f139383e61f69323';
function baseRelease() {
  const env={...process.env,PATH:hostPath},dir=fs.mkdtempSync(join(tmpdir(),'okf-4.1.1-'));
  const archive=spawnSync('git',['-C',ROOT,'archive','--format=tar',BASE_RELEASE,'oats-package'],{env,maxBuffer:64*1024*1024});
  if(archive.status!==0) {fs.rmSync(dir,{recursive:true});return null;}
  process.on('exit',()=>fs.rmSync(dir,{recursive:true,force:true}));
  assert.equal(spawnSync('tar',['-x','-C',dir],{env,input:archive.stdout}).status,0);
  return {dir,lib:join(dir,'oats-package/capabilities/oats-okf/lib')};
}
const released=baseRelease();
test('4.2.0 compatibility with the released okf 4.1.1: what it registered loads unchanged and migrates; every outstanding 4.2 obligation, a drain or a review, is a named rollback blocker',{skip:!released && !process.env.CI && `okf 4.1.1 (${BASE_RELEASE}) is not in this clone's history`},async t=>{
  assert.ok(released,`okf 4.1.1 (${BASE_RELEASE}) must be in history: CI checks out with fetch-depth 0`);
  const old={sources:await import(join(released.lib,'sources.mjs')),worker:await import(join(released.lib,'worker.mjs'))};
  const {removeSchedules}=await mod('schedule-migration');
  // A source and job 4.1.1 itself created: loaded unchanged, the job removed by proven ownership.
  {const f=fixture(t);const s=old.sources.register(f.home),bytes=fs.readFileSync(s.file);assert.equal(s.bindings.cron,'*/15 * * * *');assert.ok(readJSON(join(f.dir,'schedules.json'))[`okf-${s.id}`]);
    assert.equal(loadSource(s.file).bindingFingerprint,s.bindingFingerprint);assert.deepEqual(removeSchedules().removed,[`okf-${s.id}`]);assert.deepEqual(fs.readFileSync(s.file),bytes);
  }
  // The rollback boundary: no outstanding row of any kind, reviews included.
  const blockers=s=>outstanding(s,loadStatus(s)).map(o=>o.kind);
  // Retirement alone is no rollback boundary: 4.1.1 completes the active run but hands its drain on to nothing.
  {const f=fixture(t);const s=f.source();put(join(f.dir,'sessions-inert'),'');for(const i of [0,1,2]) bigNote(f,i);
    const run=readRun(s,checkpointHarvest(s).run);assert.equal(f.cli('retire').out.meta.retired,true);fs.rmSync(f.home,{recursive:true});
    assert.deepEqual(blockers(s),['active','drain'],'harvest-status names the unfinished drain before any re-pin');
    const premature=old.worker.complete(old.sources.loadSource(s.file),run.id,judgment(f,s,run,{drop:true}));assert.equal(premature.processed,true);
    assert.equal(spawnsOf(f).length,1,'4.1.1 starts no successor');assert.equal(loadStatus(s).processed.length,1);assert.deepEqual(blockers(s),['drain'],'the remainder stays owed and named');
    // Finished under 4.2 by the named command, nothing blocks the re-pin.
    let r=deploymentCli(f,'run-source',['--source',s.file,'--manual']);assert.equal(r.out.result.status,'running',r.stdout);let next=readRun(s,r.out.result.run);
    r=complete(s,next.id,judgment(f,s,next,{drop:true}));assert.equal(r.drain.status,'started');next=readRun(s,r.drain.run);
    assert.equal(complete(s,next.id,judgment(f,s,next,{drop:true})).drain.status,'drained');assert.deepEqual(blockers(s),[]);
  }
  // A review still owed blocks it too: 4.1.1 stops at a recorded close and never reaches a later merge.
  {const {f,s,run,repo2}=twoGitDestinations(t);closePR(f,run.receipts.project.pr.number);
    assert.equal(checkpointHarvest(s,{noLaunch:true}).settled[0].outcome,'open');
    assert.equal(f.cli('retire').out.meta.retired,true);fs.rmSync(f.home,{recursive:true});fs.rmSync(run.worker.home,{recursive:true});
    assert.deepEqual(blockers(s),['review'],'a review is still owed: no re-pin');
    mergeDelivered(f,repo2,run.receipts.secondary);
    for(let i=0;i<2;i++) assert.throws(()=>old.worker.complete(old.sources.loadSource(s.file),run.id),{code:'E_PR'});
    assert.equal(loadStatus(s).accepted[`${run.id}/secondary`],undefined,'4.1.1 never reaches the merged destination');
    assert.deepEqual(statuses(complete(s,run.id).receipts),{project:'rejected',secondary:'accepted'},'4.2 records it');assert.deepEqual(blockers(s),[]);
    assert.equal(old.sources.loadStatus(old.sources.loadSource(s.file)).accepted[`${run.id}/secondary`].status,'accepted','settled 4.2 custody reads under 4.1.1');
  }
});
test('4.2.0 every CI job that runs npm test checks out the history the 4.1.1 compatibility test reads',()=>{
  const workflow=fs.readFileSync(join(ROOT,'.github/workflows/ci.yml'),'utf8'),jobs=workflow.split(/^jobs:$/m)[1].split(/^ {2}(?=[\w-]+:$)/m).filter(Boolean);
  const testing=jobs.filter(job=>/\bnpm test\b/.test(job));assert.ok(testing.length>=2,'both the validate and the public-consumer jobs run npm test');
  for(const job of testing) assert.match(job,/actions\/checkout@v4\n\s+with:\n(?:\s+#.*\n)*\s+fetch-depth: 0\n/,`${job.split(':')[0]}: full history`);
});

// okf 4.2.0 review R2 regressions: each asserts the corrected contract.
const harvestOff={'deployment-off':()=>({OATS_SETTINGS:JSON.stringify({...JSON.parse(process.env.OATS_SETTINGS),harvest:'off'})}),'absolute-soul-off':f=>{soulOff(f);return {};}};
/** A delivered Git run whose PR was closed and recorded: retained work an explicit rejudgment would recover. */
function closedAndRecorded(t) {
  const f=fixture(t,{kind:'git'});note(f);const {s,run}=prepared(f);put(join(f.dir,'sessions-inert'),'');complete(s,run.id,judgment(f,s,run));closePR(f,1);
  assert.throws(()=>complete(s,run.id),{code:'E_PR'});return {f,s,run};
}
test('4.2.0 retry starts no new harvest work while harvest is off (deployment off, or an absolute soul opt-out): every launch, rejudgment and new worker is refused before any effect; --launch overrides nothing',t=>{
  const routes={
    'active ready --launch':()=>{const f=fixture(t);note(f);const {s}=prepared(f);put(join(f.dir,'sessions-inert'),'');return {f,s,args:['--launch']};},
    'active ready --adopt-home --launch':()=>{const f=fixture(t);note(f);const {s,run}=prepared(f);put(join(f.dir,'sessions-inert'),'');return {f,s,args:['--adopt-home',run.worker.home,'--launch']};},
    'deferred --launch':()=>{const f=fixture(t);put(join(f.dir,'sessions-inert'),'');note(f);const s=f.source();capture(s,{final:true});
      const {result}=observeCalls(()=>retireDrain(s,{deadline:Date.now()+110000}),{after:c=>isSpawn(c)?105000:0});assert.equal(result.status,'deferred');return {f,s,args:['--launch']};},
    'active --rejudge':()=>{const f=fixture(t,{kind:'git'});note(f);const {s,run}=prepared(f);const j=judgment(f,s,run,{drop:true});
      acceptedCommit(f,{'knowledge/peer/log.md':'* another writer\n'});assert.throws(()=>complete(s,run.id,j),e=>e.code==='E_BASELINE');return {f,s,args:['--rejudge']};},
    'historical --run --rejudge':()=>{const {f,s,run}=closedAndRecorded(t);return {f,s,args:['--run',run.id,'--rejudge']};},
    'historical --run --rejudge --launch':()=>{const {f,s,run}=closedAndRecorded(t);return {f,s,args:['--run',run.id,'--rejudge','--launch']};},
    'no active run':()=>{const f=fixture(t);note(f);const s=f.source();capture(s);return {f,s,args:[]};},
    'no active run --launch':()=>{const f=fixture(t);note(f);const s=f.source();capture(s);put(join(f.dir,'sessions-inert'),'');return {f,s,args:['--launch']};},
  };
  for(const [route,make] of Object.entries(routes)) for(const [mode,off] of Object.entries(harvestOff)) {
    const {f,s,args}=make(),env=off(f),before={spawns:spawnsOf(f).length,sessions:sessionsOf(f).length,status:loadStatus(s)};
    const runs=()=>fs.existsSync(join(dirname(s.file),'runs'))?tree(join(dirname(s.file),'runs')):{};const custody=runs();
    const r=f.cli('retry',['--source',s.file,...args],env);const why=`${route} under ${mode}: ${r.stdout}`;
    assert.equal(r.status,0,why);assert.equal(r.out.result.status,'harvest-off',why);assert.ok(r.out.result.refused.length,why);
    assert.equal(spawnsOf(f).length,before.spawns,why);assert.equal(sessionsOf(f).length,before.sessions,why);
    assert.deepEqual(loadStatus(s),before.status,why);assert.deepEqual(runs(),custody,`${why}: no run changed`);
  }
  // Controls: harvest on, the same commands start what they name.
  {const f=fixture(t);note(f);const {s}=prepared(f);put(join(f.dir,'sessions-inert'),'');assert.equal(f.cli('retry',['--source',s.file,'--launch']).out.result.status,'running');assert.equal(sessionsOf(f).length,1);}
  {const {f,s,run}=closedAndRecorded(t);const r=f.cli('retry',['--source',s.file,'--run',run.id,'--rejudge','--launch']);assert.equal(r.out.result.recoveryOf,run.id,r.stdout);assert.equal(sessionsOf(f).length,1);}
});
test('4.2.0 while harvest is off, retry still recovers existing custody without new work: a persisted judgment is delivered (and hands on no successor), a confirmed worker is prepared and an already-created one adopted, never launched',t=>{
  // A persisted judgment whose delivery stopped: delivered, the drain paused, no successor.
  {const f=fixture(t,{kind:'git'});const s=f.source();put(join(f.dir,'sessions-inert'),'');for(const i of [0,1]) bigNote(f,i);
    const run=readRun(s,f.cli('harvest').out.result.run);put(join(f.dir,'gh-fail'),'');
    assert.throws(()=>complete(s,run.id,judgment(f,s,run)));fs.rmSync(join(f.dir,'gh-fail'));assert.ok(readRun(s,run.id).judgment);soulOff(f);
    const r=deploymentCli(f,'retry',['--source',s.file]);assert.equal(r.status,0,r.stdout);assert.equal(r.out.result.processed,true);assert.equal(r.out.result.receipts.project.status,'delivered');
    assert.equal(r.out.result.drain.status,'harvest-off');assert.equal(spawnsOf(f).length,1,'no successor');assert.equal(sessionsOf(f).length,1);
    assert.equal(loadStatus(s).drain.paused.kind,'harvest-off');assert.equal(loadStatus(s).drain.boundary.length,2);
  }
  // A confirmed worker whose preparation stopped is prepared in place; --launch stays refused.
  {const f=fixture(t);const s=f.source();note(f);capture(s);let n=0;
    assert.throws(()=>renameFailure((from,to)=>to.includes('/work/bases/project/') && ++n===2,()=>runSource(s,{manual:true,noLaunch:true})),/injected/);soulOff(f);
    const refused=deploymentCli(f,'retry',['--source',s.file,'--launch']);assert.equal(sessionsOf(f).length,0,'no session start was even attempted');assert.equal(refused.out.result.status,'harvest-off',refused.stdout);
    const r=deploymentCli(f,'retry',['--source',s.file]);assert.equal(r.out.result.status,'ready',r.stdout);assert.equal(sessionsOf(f).length,0);assert.equal(spawnsOf(f).length,1);
  }
  // An uncertain spawn's home is adopted; adopting with --launch is refused before the adoption.
  {const f=fixture(t);const s=f.source();note(f);capture(s);const fake=process.env.OATS_CLI_BIN,text=fs.readFileSync(fake,'utf8');
    put(fake,text.replace('out({instance,home,work:','process.exit(48);out({instance,home,work:'));assert.throws(()=>runSource(s,{manual:true,noLaunch:true}),/failed/);put(fake,text);
    const run=readRun(s,loadStatus(s).activeRun),home=join(f.dir,'workers',harvesterInstance(run.id));assert.equal(run.status,'spawn-intent');soulOff(f);
    assert.equal(deploymentCli(f,'retry',['--source',s.file,'--adopt-home',home,'--launch']).out.result.status,'harvest-off');assert.equal(readRun(s,run.id).status,'spawn-intent');
    const r=deploymentCli(f,'retry',['--source',s.file,'--adopt-home',home]);assert.equal(r.out.result.status,'ready',r.stdout);assert.equal(sessionsOf(f).length,0);assert.equal(spawnsOf(f).length,1);
  }
  // The manifest-bound one-shot keeps its own contract: the host switch does not govern it.
  {const o=onceFixture(t);const r=harvestOnce({home:o.f.home,records:o.file,noLaunch:true});put(join(o.f.dir,'sessions-inert'),'');
    assert.equal(JSON.parse(process.env.OATS_SETTINGS).harvest,'off');
    const launched=retry(loadSource(r.source),{launch:true});assert.equal(launched.status,'running');assert.equal(sessionsOf(o.f).length,1);
  }
});
test('4.2.0 a no-launch hold is durable: retirement and ordinary checkpoints grow its custody but launch nothing; only an explicit retry --launch lifts it',t=>{
  const f=fixture(t);const s=f.source();put(join(f.dir,'sessions-inert'),'');for(const i of [0,1,2]) bigNote(f,i);
  assert.equal(checkpointHarvest(s,{deadline:Date.now()+5000}).status,'deferred');
  const diagnostic=readRun(s,checkpointHarvest(s,{noLaunch:true}).run);
  assert.equal(complete(s,diagnostic.id,judgment(f,s,diagnostic,{drop:true})).drain.status,'held');
  const launch=`cd ${f.context} && oats okf retry --source ${s.file} --launch --soul source --json`;
  note(f,'later.md','Written after the diagnostic.');
  const h=f.cli('harvest');assert.equal(h.out.result.status,'held',h.stdout);assert.equal(h.out.result.next,launch);
  note(f,'tail.md','The final decision.');
  const retired=f.cli('retire');assert.equal(retired.out.meta.retired,true);assert.equal(retired.out.meta.drain.status,'held',retired.stdout);assert.equal(retired.out.meta.drain.next,launch);
  assert.equal(sessionsOf(f).length,0,'nothing launched');assert.equal(spawnsOf(f).length,1);
  const st=loadStatus(s);assert.equal(st.drain.paused.kind,'no-launch');assert.equal(st.drain.boundary.length,4,'custody grew: two held inputs, the later note and the tail');
  assert.equal(retireDrain(s).status,'held');assert.equal(continueDrain(s).status,'held');assert.equal(sessionsOf(f).length,0);
  fs.rmSync(f.home,{recursive:true});
  const owed=outstanding(s,loadStatus(s));assert.deepEqual(owed.map(o=>o.kind),['drain']);assert.equal(owed[0].command,launch);
  const go=deploymentCli(f,'retry',['--source',s.file,'--launch']);assert.equal(go.out.result.status,'running',go.stdout);assert.equal(sessionsOf(f).length,1);
  assert.equal(loadStatus(s).drain.paused,undefined,'the explicit launch lifted the hold');
  const next=readRun(s,go.out.result.run);assert.equal(complete(s,next.id,judgment(f,s,next,{drop:true})).drain.status,'started','and the drain continues');
});
test('4.2.0 an interrupted rebuild of a retired worker\'s checkout never blocks settlement: the exact complete command, after both homes are gone, rebuilds it and records the outcome',t=>{
  for(const fault of ['deadline','transport']) {
    const f=fixture(t,{kind:'git'});const s=f.source();note(f);const {run}=prepared(f,s);complete(s,run.id,judgment(f,s,run));fs.rmSync(run.worker.home,{recursive:true});
    const rebuild=join(dirname(s.file),'runs',run.id,'project-recovery');
    // Interrupted after the clone created the path, twice: by the deadline, or by a transport failure.
    for(let i=0;i<2;i++) {
      let cloned=false;
      const {result}=observeCalls(()=>checkpointHarvest(s,{noLaunch:true,deadline:Date.now()+110000}),{
        after:c=>{if(c.bin==='git' && c.args.includes('clone')) {cloned=true;return fault==='deadline'?40000:0;}return 0;},
        fail:c=>fault==='transport' && cloned && c.bin==='git' && c.args.includes('fetch')});
      assert.ok(cloned,fault);assert.equal(result.settled[0].outcome,'unsettled',`${fault}: ${JSON.stringify(result.settled)}`);assert.ok(fs.existsSync(rebuild),'the interrupted rebuild is left behind');
    }
    assert.equal(readRun(s,run.id).stages.project.checkout,run.stages.project.checkout,'the run still names the deleted worker checkout');
    assert.equal(f.cli('retire').out.meta.retired,true);fs.rmSync(f.home,{recursive:true});
    mergeDelivered(f,f.repo,readRun(s,run.id).receipts.project);
    const [owed]=outstanding(s,loadStatus(s));assert.equal(owed.command,`cd ${f.context} && oats okf complete --source ${s.file} --run ${run.id} --soul source --json`);
    const done=deploymentCli(f,'complete',['--source',s.file,'--run',run.id]);assert.equal(done.status,0,`${fault}: ${done.stdout}`);assert.equal(done.out.result.receipts.project.status,'accepted');
    assert.equal(readRun(s,run.id).stages.project.checkout,rebuild);assert.deepEqual(outstanding(s,loadStatus(s)),[]);
  }
});

// okf 4.2.0 review R3 regressions: each asserts the corrected contract.
const libURL=p=>new URL(`../oats-package/capabilities/oats-okf/lib/${p}.mjs`,import.meta.url).href;
const effectsOf=f=>({captures:capturesOf(f).length,spawns:spawnsOf(f).length,sessions:sessionsOf(f).length});
test('4.2.0 a completion that frees the active slot while a custody-only retry runs grants no new work: with harvest off, nothing is captured or spawned',t=>{
  for(const [mode,off] of Object.entries(harvestOff)) {
    const f=fixture(t),s=f.source();note(f);const run=readRun(s,checkpointHarvest(s,{noLaunch:true}).run),j=judgment(f,s,run,{drop:true});
    note(f,'tail.md','Written after the active run was captured; harvest is now off.');
    const env={...process.env,...off(f)},before=effectsOf(f),statusFile=join(dirname(s.file),'status.json'),barrier=join(f.dir,'barrier.mjs');
    // Right after retry's first read of the status (the active run), another
    // process completes that run; retry then goes on.
    put(barrier,`import fs from 'node:fs';import {spawnSync} from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';
const read=fs.readFileSync;let fired=false;
fs.readFileSync=function(path,...rest) {const value=read.call(this,path,...rest);
  if(!fired && String(path)===${JSON.stringify(statusFile)}) {fired=true;
    const r=spawnSync(process.execPath,['--input-type=module','-e',${JSON.stringify(`import {loadSource} from ${JSON.stringify(libURL('sources'))};import {complete} from ${JSON.stringify(libURL('worker'))};complete(loadSource(${JSON.stringify(s.file)}),${JSON.stringify(run.id)},${JSON.stringify(j)});`)}],{env:process.env,encoding:'utf8'});
    if(r.status!==0) throw new Error('the competing completion failed: '+r.stderr);}
  return value;};
syncBuiltinESMExports();
`);
    const r=spawnSync(process.execPath,['--import',barrier,CLI,'retry','--source',s.file,'--json'],{cwd:f.context,env,encoding:'utf8',timeout:30000});
    const why=`${mode}: ${r.stdout}${r.stderr}`;assert.equal(r.status,0,why);
    assert.equal(readRun(s,run.id).status,'processed','the competing completion ran');assert.equal(loadStatus(s).activeRun,null);
    assert.equal(JSON.parse(r.stdout).result.status,'harvest-off',why);assert.deepEqual(effectsOf(f),before,`${why}: no capture, spawn or session`);
    assert.equal(loadStatus(s).captured.inputs.length,1,'the later note is not captured');
  }
});
test('4.2.0 a no-launch hold is written with the processed commit: a completion killed right after it leaves the drain held, and the next checkpoint launches nothing',t=>{
  const f=fixture(t),s=f.source();put(join(f.dir,'sessions-inert'),'');for(const i of [0,1,2]) bigNote(f,i);
  assert.equal(checkpointHarvest(s,{deadline:Date.now()+5000}).status,'deferred');
  const run=readRun(s,checkpointHarvest(s,{noLaunch:true}).run),j=judgment(f,s,run,{drop:true}),statusFile=join(dirname(s.file),'status.json');
  // SIGKILL as the status lock is released after the write that frees the active slot, before any continuation.
  const script=`import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';import {loadSource} from ${JSON.stringify(libURL('sources'))};import {complete} from ${JSON.stringify(libURL('worker'))};
const rm=fs.rmSync;fs.rmSync=function(path,...rest) {const result=rm.apply(this,[path,...rest]);
  if(String(path)===${JSON.stringify(join(dirname(s.file),'status.lock'))} && JSON.parse(fs.readFileSync(${JSON.stringify(statusFile)},'utf8')).activeRun===null) process.kill(process.pid,'SIGKILL');
  return result;};
syncBuiltinESMExports();complete(loadSource(${JSON.stringify(s.file)}),${JSON.stringify(run.id)},${JSON.stringify(j)});`;
  const killed=spawnSync(process.execPath,['--input-type=module','-e',script],{cwd:f.context,env:process.env,encoding:'utf8',timeout:30000});
  assert.equal(killed.signal,'SIGKILL',killed.stdout+killed.stderr);
  const st=loadStatus(s);assert.equal(st.activeRun,null);assert.equal(st.processed.length,1);assert.equal(st.drain.paused.kind,'no-launch','the hold was committed with the processed status');
  const h=f.cli('harvest');assert.equal(h.out.result.status,'held',h.stdout);assert.equal(sessionsOf(f).length,0);assert.equal(spawnsOf(f).length,1);
  assert.equal(f.cli('retire').out.meta.drain.status,'held');assert.equal(sessionsOf(f).length,0);
  const go=deploymentCli(f,'retry',['--source',s.file,'--launch']);assert.equal(go.out.result.status,'running',go.stdout);assert.equal(sessionsOf(f).length,1);
});
test('4.2.0 the invocation deadline also bounds lock waits: a busy base lock during staging ends with the budget, and the confirmed worker is deferred',t=>{
  const f=fixture(t);const s=f.source();put(join(f.dir,'sessions-inert'),'');note(f);capture(s,{final:true});
  const lock=baseLock(s.bindings.bases.project);put(join(lock,'owner.json'),JSON.stringify({token:'live',pid:process.pid,host:hostname()}));
  const deadline=Date.now()+110000,started=performance.now();
  // The spawn returns with about 2 s of the budget left; the base lock is held by a live process.
  const {result:{d,end}}=observeCalls(()=>({d:retireDrain(s,{deadline}),end:Date.now()}),{after:c=>isSpawn(c)?108000:0});
  const elapsed=performance.now()-started;
  assert.equal(d.status,'deferred',JSON.stringify(d));assert.equal(d.phase,'scaffolded');assert.equal(d.launched,false);
  assert.ok(end<=deadline+1000,`ended ${end-deadline} ms past the deadline`);assert.ok(elapsed<8000,`took ${Math.round(elapsed)} ms: the lock wait outlived the budget`);
  assert.equal(sessionsOf(f).length,0);
  fs.rmSync(lock,{recursive:true});
  const go=deploymentCli(f,'retry',['--source',s.file,'--launch']);assert.equal(go.out.result.status,'running',go.stdout);assert.equal(spawnsOf(f).length,1);
});
const {withDeadline,bounded}=await mod('io');
test('4.2.0 an invocation deadline nests to the earlier one, is restored on exit and on error, and bounds lock waits only within it',()=>{
  const now=Date.now();
  withDeadline(now+10000,()=>{
    assert.ok(bounded(20000)<=10000);withDeadline(now+20000,()=>assert.ok(bounded(30000)<=10000,'the earlier deadline wins'));
    assert.throws(()=>withDeadline(now-1,()=>bounded(1)),{code:'E_DEADLINE'});assert.ok(bounded(20000)>1000,'restored after the error');
  });
  assert.equal(bounded(600000),600000,'no deadline outside one');
  const dir=fs.mkdtempSync(join(tmpdir(),'okf-lock-')),lock=join(dir,'held.lock');put(join(lock,'owner.json'),JSON.stringify({token:'live',pid:process.pid,host:hostname()}));
  try {
    let t0=performance.now();assert.throws(()=>withDeadline(Date.now()+300,()=>withLock(lock,()=>{},{waitMs:10000})),{code:'E_DEADLINE'});assert.ok(performance.now()-t0<2000,'the wait ends with the deadline');
    t0=performance.now();assert.throws(()=>withLock(lock,()=>{},{waitMs:300}),{code:'E_LOCKED'});assert.ok(performance.now()-t0>=250,'without one, the wait is its own');
    assert.ok(fs.existsSync(join(lock,'owner.json')),'a live holder\'s lock is left alone');
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
