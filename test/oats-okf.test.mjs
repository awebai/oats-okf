import test from 'node:test';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { syncBuiltinESMExports } from 'node:module';
import { inventory, noEffectsPreload } from './helpers/no-effects.mjs';
const ROOT=fileURLToPath(new URL('../',import.meta.url));
const CAP=join(ROOT,'oats-package',JSON.parse(fs.readFileSync(join(ROOT,'oats-package/oats-package.json'),'utf8')).capabilities[0]);
const CLI=join(CAP,'bin/oats-okf.mjs');
const mod=p=>import(new URL(`../oats-package/capabilities/oats-okf/lib/${p}.mjs`,import.meta.url));
const {loadBindings,metadata,validateBindings,validateDeclaration}=await mod('config');
const {tree,save,readJSON,atomic,digest,withLock,baseLock:unused,quote,command,hash}=await mod('io');
const {register,registerCaptured,capture,input,loadStatus,loadSource,saveStatus,views,scheduleSource}=await mod('sources');
const {runSource,readRun,complete,retry,completionArgv,completionCommand}=await mod('worker');
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
  const r=spawnSync(process.execPath,[target.cli,...a.slice(5)],{env:{...process.env,OATS_BINDING_FILE:target.bindingFile},encoding:'utf8'});
  process.stdout.write(r.stdout);process.stderr.write(r.stderr);process.exit(r.status ?? 94);
}
else if(a[0]==='spawn') {const instance='memory-harvest-'+val('--purpose'),home=join(root,'workers',instance);fs.mkdirSync(join(home,'work'),{recursive:true});fs.writeFileSync(join(home,'instance.json'),JSON.stringify({instance,agent:'memory-harvest',work:'directory',repo:val('--repo'),kind:'capability',launched:false}));fs.copyFileSync(val('--task-file'),join(home,'TASK.md'));out({instance,home,work:'directory',launched:false});}
else if(a[0]==='session') {console.error('NO MODEL SESSIONS IN FIXTURES');process.exit(91);}
else if(a[0]==='schedule') {
  if(a.includes('install')) {console.error('NO HOST TIMERS IN FIXTURES');process.exit(92);}
  const error=(code,message)=>{console.log(JSON.stringify({schemaVersion:1,ok:false,error:{code,message}}));process.exit(1);};
  if(fs.existsSync(join(root,'schedule-fail'))) error('E_SCHEDULE_FIXTURE','scheduler unavailable');
  const p=join(root,'schedules.json'),jobs=fs.existsSync(p)?JSON.parse(fs.readFileSync(p,'utf8')):{};
  const persist=()=>fs.writeFileSync(p,JSON.stringify(jobs));
  if(a[1]==='add') {if(jobs[a[2]]) error('E_SCHEDULE_EXISTS','already exists');jobs[a[2]]=JSON.parse(fs.readFileSync(val('--file'),'utf8'));persist();out({schedule:jobs[a[2]]});}
  else if(a[1]==='show') {if(!jobs[a[2]]) error('E_SCHEDULE_UNKNOWN','missing');out({schedule:jobs[a[2]]});}
  else if(['enable','disable'].includes(a[1])) {jobs[a[2]].enabled=a[1]==='enable';persist();out({schedule:jobs[a[2]]});}
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
if(a[1]==='list') {if(fs.existsSync(join(root,'gh-unavailable'))) process.exit(45);console.log(JSON.stringify((fs.existsSync(p)?JSON.parse(fs.readFileSync(p,'utf8')):[]).filter(pr=>pr.headRefName===val('--head') && (!a.includes('--base') || pr.baseRefName===val('--base')))));}
else if(a[1]==='view') {if(fs.existsSync(join(root,'gh-unavailable'))) process.exit(45);const pr=(fs.existsSync(p)?JSON.parse(fs.readFileSync(p,'utf8')):[]).find(pr=>pr.number===Number(a[2]));if(!pr) {console.error('known PR missing');process.exit(46);}console.log(JSON.stringify(pr));}
else if(a[1]==='create') {if(fs.existsSync(join(root,'gh-fail'))) process.exit(42);const branch=val('--head'),oid=execFileSync('git',['ls-remote','origin','refs/heads/'+branch],{encoding:'utf8'}).trim().split(/\\s/)[0];const rows=fs.existsSync(p)?JSON.parse(fs.readFileSync(p,'utf8')):[],number=rows.length+1;rows.push({number,url:'https://github.com/fixture/knowledge/pull/'+number,state:'OPEN',headRefName:branch,headRefOid:oid,baseRefName:val('--base'),mergedAt:null,mergeCommit:null});fs.writeFileSync(p,JSON.stringify(rows));if(fs.existsSync(join(root,'gh-uncertain'))) process.exit(43);console.log('https://github.com/fixture/knowledge/pull/1');}
else process.exit(44);
`);fs.chmodSync(gh,0o755);
  const repo=join(dir,'accepted-repo'); const base=kind==='directory'?{id:'base-1',kind,path:'base'}:{id:'base-1',kind,repository:repo,root,acceptedBranch:'main',pr:{repository:'fixture/knowledge'}};
  if(kind==='git') {process.env.PATH+=`:${hostPath}`;fs.mkdirSync(repo);git(repo,['init','-q','--initial-branch=main']);}
  const bindingFile=join(dir,'bindings.json');save(bindingFile,{version:1,stateDir:'state',bases:{project:base}});process.env.OATS_SETTINGS=JSON.stringify({'bindings-file':bindingFile});
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
function git(repo,args) {return execFileSync('git',['-C',repo,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();}
function note(f,name='decision.md',text='The human chose explicit custody because hidden fallbacks conceal delivery failures.') {put(join(f.home,'notes',name),`---\ntype: Decision\ntitle: Explicit custody\ndescription: Why custody is explicit.\n---\n\n${text}\n`);}
function prepared(f,s=f.source()) {capture(s);const r=runSource(s,{manual:true,noLaunch:true});return {s,run:readRun(s,r.run)};}
function judgment(f,s,run,{drop=false,base='project',node='expert',secret=false}={}) {
  const stage=run.stages[base]; const file=join(run.worker.home,'work','judgment.json');
  const outcomes=run.inputs.map(id=>({input:id,verdict:drop?'drop':'promote',reason:drop?'Task residue.':'Human accepted rationale passes both tests.',concepts:drop?[]:[{base,path:`${node}/decision.md`}]}));
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
  assert.equal(fs.readlinkSync(join(CAP,'agents/memory-harvest/CLAUDE.md')),'AGENTS.md','source compatibility alias preserves one canonical instruction file');
  const m=readJSON(join(CAP,'oats.json'));assert.equal(m.version,'2.0.0');assert.equal(m.compatibility.oats,'>=0.23.0');assert.equal(m.hooks.spawn.required,true);
  for(const c of ['harvest','inspect','setup','run-source','complete','retry','migrate','read','refresh','init']) assert.ok(m.commands[c]);
  const inj=fs.readFileSync(join(CAP,m.inject),'utf8');assert.doesNotMatch(inj,/harvest/i);assert.match(inj,/after compaction/);
  const skill=fs.readFileSync(join(CAP,'skills/memory-harvest/SKILL.md'),'utf8');assert.ok(skill.indexOf('### 3.2 The accept list')<skill.indexOf('## Independent input'));assert.match(skill,/Could it NOT have found this by reading the repository/);
});
test('help is side-effect free, including malformed settings and every declared command',t=>{
  const f=fixture(t);for(const cmd of Object.keys(readJSON(join(CAP,'oats.json')).commands)) {const r=f.cli(cmd,['--help'],{OATS_SETTINGS:'!'});assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/oats okf/);}assert.equal(fs.existsSync(f.calls),false);
});
test('directory init, cross-node views, role evidence allowlist and inactive scheduler',t=>{
  const f=fixture(t);const s=f.source();assert.ok(fs.existsSync(join(f.home,'knowledge/bases/project/peer/index.md')));assert.equal(s.owner,'owner-1');assert.equal(s.launchRecipe,undefined);assert.equal(s.settings,undefined);scheduleSource(s);
  const calls=fs.readFileSync(f.calls,'utf8').trim().split('\n').map(JSON.parse);assert.equal(calls[0].a[0],'schedule');assert.equal(calls[0].identity,null);
  const spec=readJSON(join(dirname(s.file),'schedule.json'));assert.equal(spec.cwd,f.context);assert.ok(spec.argv.includes('--soul'));assert.equal(spec.argv.includes(f.home),false);
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
  const calls=fs.readFileSync(f.calls,'utf8').trim().split('\n').map(JSON.parse);const spawn=calls.find(c=>c.a[0]==='spawn');assert.equal(spawn.a.includes('--parent'),false);assert.equal(spawn.a.includes('--work-dir'),false);assert.equal(spawn.a.includes('--branch'),false);
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
test('no-change/all-drop succeeds without invented Git or PR receipt',t=>{
  const f=fixture(t);note(f);const {s,run}=prepared(f);const r=complete(s,run.id,judgment(f,s,run,{drop:true}));assert.equal(r.status,'processed');assert.equal(r.receipts.project.status,'no-change');assert.equal(r.receipts.project.pr,undefined);
});
test('directory delivery uses no git/gh tools and confirms reader-visible bytes',t=>{
  const f=fixture(t);fs.unlinkSync(join(f.dir,'bin','gh'));note(f);const {s,run}=prepared(f);const r=complete(s,run.id,judgment(f,s,run));assert.equal(r.receipts.project.status,'accepted');assert.ok(fs.existsSync(join(f.base.path,'expert/decision.md')));
  const target=join(f.dir,'fresh-reader');views(s.bindings,s.decl,target);assert.match(fs.readFileSync(join(target,'bases/project/expert/decision.md'),'utf8'),/prevents hidden delivery/);
});
test('directory baseline conflict retains pending input and permits explicit rejudgment',t=>{
  const f=fixture(t);note(f);const {s,run}=prepared(f);const j=judgment(f,s,run);fs.appendFileSync(join(f.base.path,'peer/log.md'),'other writer\n');assert.throws(()=>complete(s,run.id,j),/base changed/);assert.equal(loadStatus(s).processed.length,0);
  assert.equal(retry(s,{rejudge:true}).status,'abandoned');assert.equal(fs.existsSync(run.worker.home),true);
});
test('directory crash midway publication blocks readers, retry recovers and confirms once',t=>{
  const f=fixture(t);note(f);const {s,run}=prepared(f);const j=judgment(f,s,run);
  assert.throws(()=>complete(s,run.id,j,{afterWrite:n=>{if(n===1)throw new Error('simulated crash');}}),/simulated crash/);
  assert.equal(fs.existsSync(journalPath(f.base)),true);assert.equal(loadStatus(s).processed.length,0);
  assert.throws(()=>views(s.bindings,s.decl,join(f.dir,'blocked-reader')),/publication pending/);
  const r=retry(s);assert.equal(r.processed,true);assert.equal(fs.existsSync(journalPath(f.base)),false);assert.equal(loadStatus(s).processed.length,1);
});
test('source and base contention do not expire or steal locks',t=>{
  const f=fixture(t);const s=f.source();note(f);
  withLock(join(dirname(s.file),'capture.lock'),()=>assert.throws(()=>capture(s),/busy or abandoned/));
  withLock(baseLock(f.base),()=>assert.throws(()=>stageBase(f.base,join(f.dir,'stage')),/busy or abandoned/));
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
test('no-launch sources and service workers never trigger scheduled model launches or recursive capture',t=>{
  const f=fixture(t);const s=f.source();note(f);save(join(f.home,'instance.json'),{instance:'source-one',agent:'source',repo:f.context,work:'directory',launched:false});const before=fs.readFileSync(f.calls,'utf8');assert.equal(runSource(s).status,'skipped');assert.equal(fs.readFileSync(f.calls,'utf8'),before);
  const serviceHome=join(f.dir,'service-home');fs.mkdirSync(serviceHome);
  const service=f.cli('spawn',[],{OATS_KIND:'capability',OATS_SETTINGS:'{}',OATS_HOME:serviceHome,OATS_INSTANCE_HOME:serviceHome});assert.equal(service.out.meta.memory,'none');assert.equal(fs.readFileSync(f.calls,'utf8'),before);
  capture(s,{final:true});assert.equal(loadStatus(s).auto,false);assert.equal(runSource(s).status,'disabled');
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
test('captured registration freezes qualified identity, binding and v2 schedule without live source fallback',t=>{
  const f=fixture(t),receipt=capturedReceipt(f),snapshot=join(f.dir,'invocation-binding.json'),wrong=structuredClone(receipt.binding),priorBinding=process.env.OATS_BINDING_FILE;
  t.after(()=>{if(priorBinding===undefined) delete process.env.OATS_BINDING_FILE;else process.env.OATS_BINDING_FILE=priorBinding;});
  wrong.payload.execution.model='different/model';save(snapshot,wrong);process.env.OATS_BINDING_FILE=snapshot;
  assert.throws(()=>registerCaptured(f.home,receipt),/differs from invocation snapshot/);assert.equal(fs.existsSync(join(f.home,'.okf-source.json')),false);
  delete process.env.OATS_BINDING_FILE;save(snapshot,receipt.binding);const receiptFile=join(f.dir,'source-receipt.json');save(receiptFile,receipt);
  const lifecycle=f.cli('spawn',[],{OATS_BINDING_FILE:snapshot,OATS_SOURCE_RECEIPT_FILE:receiptFile});assert.equal(lifecycle.status,0,lifecycle.stdout);
  const s=loadSource(lifecycle.out.meta.source),schedules=readJSON(join(f.dir,'schedules.json')),spec=schedules[`okf-${s.id}`];
  const normalized={...spec,execution:{responsibleHuman:null,deployment:receipt.executionBinding.deployment,resolution:receipt.executionBinding.resolution}};delete normalized.responsibleHuman;schedules[`okf-${s.id}`]=normalized;save(join(f.dir,'schedules.json'),schedules);
  const again=registerCaptured(f.home,receipt);assert.equal(again.id,s.id,'scheduler-normalized explicit null remains idempotent');assert.equal(s.registration.kind,'captured');assert.deepEqual(s.providerBinding,receipt.binding);assert.deepEqual(s.executionBinding,receipt.executionBinding);assert.equal(s.responsibleHuman,null);
  const owner=readJSON(join(f.bindings.stateDir,'owners.json'))['owner-1'];assert.equal(owner.kind,'captured-qualified-soul');assert.deepEqual(owner.identity,receipt.sourceIdentity);
  assert.equal(spec.definitionVersion,2);assert.equal(spec.recurrencePolicy,'capture');assert.equal(spec.responsibleHuman,null);assert.equal(spec.cwd,f.context);
  assert.ok(spec.argv.includes('--deployment'));assert.ok(spec.argv.includes('--resolution'));assert.ok(spec.argv.includes('--json'));assert.equal(spec.argv.includes('--soul'),false);
  assert.equal(spec.argv[spec.argv.indexOf('--resolution')+1],receipt.executionBinding.resolution.id);
  save(snapshot,receipt.binding);const capturedEnv={OATS_BINDING_FILE:snapshot,OATS_SETTINGS:JSON.stringify({'bindings-file':join(f.dir,'poison.json'),'state-dir':join(f.dir,'poison-state')})},alias=f.base.id;
  const inspected=f.cli('inspect',[],capturedEnv);assert.equal(inspected.status,0);assert.deepEqual(inspected.out.result.authority,{schemaVersion:1,registration:'captured',capture:'recorded',migrationRequired:false,sourceIdentity:receipt.sourceIdentity,executionBinding:receipt.executionBinding,responsibleHuman:{status:'disabled'}});
  for(const [key,value] of [['source',s.file],['owns',s.decl.owns],['reads',s.decl.reads],['bases',s.bindings.bases],['acceptedView',s.acceptedView],['status',loadStatus(s)]]) assert.deepEqual(inspected.out.result[key],value,`existing inspect field ${key} is unchanged`);
  assert.equal(f.cli('read',['--base',alias],capturedEnv).status,0);assert.equal(f.cli('refresh',[],capturedEnv).status,0);
  const schedulesBefore=fs.readFileSync(join(f.dir,'schedules.json'));const unsupported=f.cli('setup',['--source',s.file],capturedEnv);assert.equal(unsupported.status,1);assert.equal(unsupported.out.error.code,'E_MIGRATION');assert.deepEqual(fs.readFileSync(join(f.dir,'schedules.json')),schedulesBefore);
  save(join(f.home,'instance.json'),{instance:'source-one',agent:'source',kind:'capability',launched:true});assert.equal(f.cli('spawn',[],capturedEnv).out.meta.memory,'okf-v2','captured marker outranks poisoned live service kind');
  note(f);const retired=f.cli('retire',[],capturedEnv);assert.equal(retired.status,0,retired.stdout);assert.equal(retired.out.meta.retired,true,'captured retire uses the exact registered source');
  fs.rmSync(f.home,{recursive:true});fs.rmSync(f.soul,{recursive:true});fs.rmSync(f.bindingFile);process.env.OATS_SETTINGS=JSON.stringify({'bindings-file':join(f.dir,'poison.json'),'state-dir':join(f.dir,'poison-state')});
  const frozen=loadSource(s.file);assert.equal(frozen.id,s.id);assert.equal(fs.existsSync(join(f.dir,'poison-state')),false);assert.deepEqual(inspectSource(frozen).authority,inspected.out.result.authority,'source deletion and poisoned config do not alter captured authority');
  const before=tree(f.bindings.stateDir),beforeCalls=fs.readFileSync(f.calls);
  assert.throws(()=>runSource(frozen,{manual:true,noLaunch:true}),{code:'E_CAPTURED_HELPER'});
  assert.deepEqual(tree(f.bindings.stateDir),before);assert.deepEqual(fs.readFileSync(f.calls),beforeCalls,'captured source cannot reach legacy worker spawn');
  schedules[`okf-${s.id}`]={...spec,argv:['oats','poison'],attempt:{executionId:'retained-attempt'}};save(join(f.dir,'schedules.json'),schedules);
  assert.throws(()=>scheduleSource(s),/definition differs/);assert.deepEqual(readJSON(join(f.dir,'schedules.json'))[`okf-${s.id}`].attempt,{executionId:'retained-attempt'});
});
test('public captured harvest refuses before registration replay or scheduling effects',t=>{
  const f=fixture(t),receipt=capturedReceipt(f),s=registerCaptured(f.home,receipt),snapshot=join(f.dir,'binding-snapshot.json');save(snapshot,receipt.binding);
  note(f);capture(s);
  const id=randomUUID(),status=loadStatus(s);
  save(join(dirname(s.file),'runs',id,'run.json'),{version:1,id,source:s.id,inputs:status.captured.inputs,status:'delivered',receipts:{'base-1':{status:'delivered',proposal:'retained-fixture'}}});
  status.activeRun=id;saveStatus(s,status);
  // These pending repairs used to run before the knowingly unsupported worker.
  fs.renameSync(join(f.home,'knowledge'),join(f.home,`.okf-view-${s.id}`));
  for(const path of ['STATE.md','log.md','notes']) fs.rmSync(join(f.home,path),{recursive:true,force:true});
  fs.rmSync(join(dirname(s.file),'schedule.json'));save(join(f.dir,'schedules.json'),{});
  const preload=noEffectsPreload(f.dir),before=inventory(f.dir);
  for(const env of [{OATS_BINDING_FILE:snapshot},{}]) for(const args of [[],['--no-launch']]) {
    const result=spawnSync(process.execPath,['--import',preload,CLI,'harvest','--home',f.home,...args,'--json'],{cwd:f.context,env:{...process.env,...env},encoding:'utf8',timeout:30000});
    assert.equal(result.status,1,result.stdout+result.stderr);assert.equal(JSON.parse(result.stdout).error.code,'E_CAPTURED_HELPER');
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
  const first=f.cli('harvest',['--no-launch']);assert.equal(first.status,0,first.stdout+first.stderr);assert.equal(first.out.result.status,'ready');
  const second=f.cli('harvest',['--no-launch']);assert.equal(second.status,0,second.stdout+second.stderr);assert.equal(second.out.result.run,first.out.result.run);
  const calls=fs.readFileSync(f.calls,'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(calls.filter(({a})=>a[0]==='spawn').length,1,'fixture scaffold only, never a real model');assert.ok(calls.some(({a})=>a[0]==='schedule'));
  assert.equal(calls.some(({a})=>a[0]==='session' || a.includes('install')),false);
});

test('captured completion command binds saved selectors and public provider completion after source deletion',t=>{
  const f=fixture(t),receipt=capturedReceipt(f),s=registerCaptured(f.home,receipt);note(f);capture(s,{final:true});
  const id=randomUUID(),home=join(f.dir,'retained-worker'),alias=f.base.id;fs.mkdirSync(join(home,'work'),{recursive:true});
  save(join(home,'instance.json'),{instance:'retained-worker',agent:'memory-harvest',work:'directory'});
  const staged=stageBase(f.base,join(home,'work','base')),run={version:1,id,source:s.id,created:'2026-09-16T00:00:00.000Z',inputs:loadStatus(s).captured.inputs,status:'ready',worker:{instance:'retained-worker',home},stages:{[alias]:{root:staged.root,baseline:staged.files,digest:staged.digest,owned:['expert']}},receipts:{}};
  save(join(dirname(s.file),'runs',id,'run.json'),run);const status=loadStatus(s);status.activeRun=id;saveStatus(s,status);
  const judgmentFile=judgment(f,s,run,{drop:true,base:alias}),snapshot=join(f.dir,'completion-binding.json');save(snapshot,receipt.binding);
  save(join(f.dir,'captured-dispatch.json'),{deployment:s.executionBinding.deployment,resolution:s.executionBinding.resolution.id,cli:CLI,bindingFile:snapshot});
  const argv=completionArgv(s,id,judgmentFile);assert.deepEqual(argv.slice(0,4),['--deployment',f.context,'--resolution',receipt.executionBinding.resolution.id]);assert.equal(argv.includes('--soul'),false);
  fs.rmSync(f.home,{recursive:true});fs.rmSync(f.soul,{recursive:true});fs.rmSync(f.bindingFile);
  fs.symlinkSync('/usr/bin/env',join(f.dir,'bin','env'));
  const env={...process.env,OATS_DEPLOYMENT:'/poison',OATS_RESOLUTION:'poison',OATS_BINDING_FILE:'/poison',OATS_SOURCE_RECEIPT_FILE:'/poison',OATS_INVOCATION_CONTEXT_FILE:'/poison'};
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
  const helperSpawn=helper.cli('spawn',[],{OATS_BINDING_FILE:bindingFile,OATS_SOURCE_RECEIPT_FILE:receiptFile});assert.equal(helperSpawn.status,0);assert.equal(helperSpawn.out.meta.memory,'none');assert.equal(fs.existsSync(join(helper.bindings.stateDir,'owners.json')),false);
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
test('baseline exports the readable okf and memory-harvest skill closure',()=>{
  const hasDoc=p=>{try{return fs.statSync(join(p,'SKILL.md')).isFile();}catch{return false;}};
  const skills=new Map();
  for(const declared of manifest.skills || []) {
    const dir=join(CAP,declared);assert.ok(fs.statSync(dir).isDirectory());
    const entries=hasDoc(dir)?[{name:dir.split('/').at(-1),dir}]:fs.readdirSync(dir,{withFileTypes:true}).filter(e=>e.isDirectory() && hasDoc(join(dir,e.name))).map(e=>({name:e.name,dir:join(dir,e.name)}));
    for(const e of entries) skills.set(e.name,fs.readFileSync(join(e.dir,'SKILL.md'),'utf8'));
  }
  for(const name of ['okf','memory-harvest']) {assert.ok(skills.has(name),`missing required baseline skill ${name}`);assert.match(skills.get(name),new RegExp(`^name: ${name}$`,'m'));}
  assert.ok(fs.statSync(join(CAP,'skills/okf/scripts/okf-validate.mjs')).isFile());
});
test('baseline harvest operation dispatches its declared command without a hook event',t=>{
  const f=fixture(t);f.source();note(f);const r=declaredRun(f,'harvest',['--no-launch'],true);assert.equal(r.schemaVersion,1);assert.equal(r.ok,true);assert.equal(r.result.status,'ready');assert.match(r.result.instance,/^memory-harvest-okf-/);
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

test('R1 registration schedules idempotently, recreates missing jobs and preserves explicit disable',t=>{
  const f=fixture(t),s=f.source();note(f);capture(s);
  const before=loadStatus(s);assert.equal(f.source().id,s.id);assert.equal(loadStatus(s).schedule.status,'ready');
  assert.equal(f.cli('setup',['--source',s.file,'--disable']).status,0);
  assert.equal(f.source().id,s.id);assert.equal(readJSON(join(f.dir,'schedules.json'))[`okf-${s.id}`].enabled,false);
  fs.rmSync(join(f.dir,'schedules.json'));f.source();assert.equal(readJSON(join(f.dir,'schedules.json'))[`okf-${s.id}`].enabled,false);
  capture(s,{final:true});assert.equal(loadStatus(s).auto,false);assert.deepEqual(loadStatus(s).captured.inputs,before.captured.inputs);assert.deepEqual(loadStatus(s).processed,before.processed);
  assert.ok(callsOf(f).every(c=>!c.a.includes('install')));
});
test('R1 failed registration scheduling is reported and retry repairs the same source without losing evidence',t=>{
  const f=fixture(t);put(join(f.dir,'schedule-fail'),'1');const result=f.cli('spawn');assert.equal(result.status,1);assert.match(result.out.warning,/scheduler unavailable/);
  const marker=readJSON(join(f.home,'.okf-source.json')),s=loadSource(marker.source);assert.equal(loadStatus(s).schedule.status,'failed');note(f);capture(s);const before=loadStatus(s);
  fs.rmSync(join(f.dir,'schedule-fail'));assert.equal(f.source().id,s.id);assert.equal(loadStatus(s).schedule.status,'ready');assert.deepEqual(loadStatus(s).captured,before.captured);
  put(join(f.dir,'schedule-fail'),'1');const failed=f.cli('harvest',['--no-launch']);assert.equal(failed.status,1);assert.match(failed.out.error.message,/scheduler unavailable/);assert.equal(loadStatus(s).activeRun,null);assert.deepEqual(loadStatus(s).captured,before.captured);
  assert.ok(!callsOf(f).some(c=>c.a[0]==='spawn'));
});
test('R1 schedule collision is not silently overwritten or treated as successful registration',t=>{
  const f=fixture(t),s=f.source(),file=join(f.dir,'schedules.json'),jobs=readJSON(file);jobs[`okf-${s.id}`].argv=['oats','unexpected'];save(file,jobs);
  assert.throws(()=>f.source(),/schedule definition differs/);assert.equal(loadStatus(s).schedule.status,'failed');assert.deepEqual(readJSON(file),jobs);
});
test('R1 harvest after legacy source migration creates one durable job that survives retirement',t=>{
  const f=fixture(t);note(f);put(join(f.home,'.okf-harvest-record.json'),'{}\n');assert.equal(f.cli('migrate',['--source-home',f.home]).status,0);
  const h=f.cli('harvest',['--no-launch']);assert.equal(h.status,0,h.stdout);assert.equal(h.out.result.status,'ready');
  const marker=readJSON(join(f.home,'.okf-source.json')),s=loadSource(marker.source);assert.equal(loadStatus(s).schedule.status,'ready');
  const r=f.cli('retire');assert.equal(r.status,0,r.stdout);fs.rmSync(f.home,{recursive:true});
  const jobs=readJSON(join(f.dir,'schedules.json'));assert.equal(Object.keys(jobs).length,1);assert.ok(jobs[`okf-${s.id}`].argv.includes(s.file));
  assert.equal(loadStatus(s).captured.inputs.length,1);assert.equal(loadStatus(s).processed.length,0);assert.ok(callsOf(f).every(c=>!c.a.includes('install')));
});

function aliasedFixture(t,alias) {
  const f=fixture(t),raw=readJSON(f.bindingFile);
  raw.bases={[alias]:raw.bases.project};save(f.bindingFile,raw);
  save(join(f.soul,'okf.json'),{version:1,owner:'owner-1',owns:[`${alias}/expert`],reads:[]});
  return f;
}
function assertView(target,alias) {
  const receipt=readJSON(join(target,'view.json')).bases[alias];
  assert.equal(receipt.path,`bases/${alias}`);
  assert.equal(fs.lstatSync(join(target,'view.json')).isFile(),true);
  assert.equal(fs.lstatSync(join(target,receipt.path)).isDirectory(),true);
  assert.equal(digest(tree(join(target,receipt.path))),receipt.digest);
  return receipt;
}
for(const alias of ['input.json','view.json','staging.json','judgment.json','bases']) test(`R1 alias ${alias} uses isolated base namespace through delivery and fresh read`,t=>{
  const f=aliasedFixture(t,alias);
  note(f);const {s,run}=prepared(f);assert.equal(run.stages[alias].root,join(run.worker.home,'work','bases',alias));
  const original=tree(join(f.home,'knowledge'));assertView(join(f.home,'knowledge'),alias);
  const spawn=f.cli('spawn');assert.equal(spawn.status,0,spawn.stdout);assert.match(spawn.out.brief,/knowledge\/bases\/<alias>/);
  assert.equal(readJSON(join(run.worker.home,'work','input.json')).source.id,s.id);assert.ok(readJSON(join(run.worker.home,'work','staging.json'))[alias]);
  const r=complete(s,run.id,judgment(f,s,run,{base:alias}));assert.equal(r.receipts[alias].status,'accepted');assert.equal(loadStatus(s).processed.length,1);
  const reader=join(f.dir,'reader');views(s.bindings,s.decl,reader);assertView(reader,alias);
  assert.match(fs.readFileSync(join(reader,'bases',alias,'expert/decision.md'),'utf8'),/Explicit custody/);
  const refresh=f.cli('refresh');assert.equal(refresh.status,0,refresh.stdout);
  assert.deepEqual(refresh.out.result.receipts[alias],assertView(refresh.out.result.path,alias));
  const read=f.cli('read',['--base',alias,'--path','expert/decision.md']);assert.equal(read.status,0,read.stdout);
  assert.equal(read.out.result.receipt.path,`bases/${alias}`);assert.match(read.out.result.text,/Explicit custody/);
  assert.ok(read.out.result.path.endsWith(`/bases/${alias}/expert/decision.md`));
  assert.deepEqual(tree(join(f.home,'knowledge')),original,'refresh/read never modify the original view');
  assert.equal(f.cli('read',['--base',alias,'--path','../../view.json']).out.error.code,'E_PATH');
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
  test(`view alias ${alias}: partial registration and refresh fail cleanly, then retry`,t=>{
    const f=aliasedFixture(t,alias),raw=readJSON(f.bindingFile);
    raw.bases.secondary={id:'base-2',kind:'directory',path:'second-base'};save(f.bindingFile,raw);
    const bindings=loadBindings();initBase(bindings,'secondary',join(f.dir,'nodes.json'),undefined,{confirm:true});
    const index=join(bindings.bases.secondary.path,'index.md'),bytes=fs.readFileSync(index);
    fs.rmSync(index); // First alias was copied before second-base validation fails.
    const failed=f.cli('spawn');assert.equal(failed.status,1);assert.match(failed.out.warning,/index.md.*required/);
    assert.equal(fs.existsSync(join(f.home,'knowledge')),false);assert.equal(fs.existsSync(join(f.home,'.okf-source.json')),false);
    assert.deepEqual(fs.readdirSync(join(bindings.stateDir,'sources')),[]);
    assert.ok(!fs.readdirSync(f.home).some(p=>p.startsWith('.okf-view-')));
    put(index,bytes);const s=f.source();assertView(join(f.home,'knowledge'),alias);
    const original=tree(join(f.home,'knowledge')),before=fs.readdirSync(f.home).sort(),target=join(f.home,'retry-view');
    fs.rmSync(index);
    assert.throws(()=>views(s.bindings,s.decl,target),/index.md.*required/);assert.equal(fs.existsSync(target),false);
    const refresh=f.cli('refresh');assert.equal(refresh.status,1);assert.match(refresh.out.error.message,/index.md.*required/);
    assert.deepEqual(fs.readdirSync(f.home).sort(),before);assert.deepEqual(tree(join(f.home,'knowledge')),original);
    put(index,bytes);views(s.bindings,s.decl,target);assertView(target,alias);
    const fresh=f.cli('refresh');assert.equal(fresh.status,0,fresh.stdout);assertView(fresh.out.result.path,alias);
    assert.equal(f.source().id,s.id);assert.equal(fs.readdirSync(join(bindings.stateDir,'sources')).length,1);
  });
  test(`view alias ${alias}: failure before source pointer does not strand registration`,t=>{
    const f=aliasedFixture(t,alias);
    renameFailure((from,to)=>to.endsWith('/source.json'),()=>assert.throws(()=>f.source(),/injected view I\/O failure/));
    assert.equal(fs.existsSync(join(f.home,'knowledge')),false);assert.equal(fs.existsSync(join(f.home,'.okf-source.json')),false);
    assert.ok(!fs.readdirSync(f.home).some(p=>p.startsWith('.okf-view-')));
    assert.deepEqual(fs.readdirSync(join(f.bindings.stateDir,'sources')),[]);
    const s=f.source();assertView(join(f.home,'knowledge'),alias);assert.equal(f.source().id,s.id);
  });
  test(`view alias ${alias}: failure after source pointer resumes the same snapshot and evidence`,t=>{
    const f=aliasedFixture(t,alias);
    renameFailure((from,to)=>to===join(f.home,'knowledge'),()=>assert.throws(()=>f.source(),/injected view I\/O failure/));
    const pointer=readJSON(join(f.home,'.okf-source.json')),s=loadSource(pointer.source),pending=join(f.home,`.okf-view-${s.id}`);
    const original=tree(pending);assertView(pending,alias);assert.equal(fs.existsSync(f.calls),false);
    note(f);capture(s);const before=loadStatus(s);
    // Retry must publish the prepared accepted snapshot, not silently restage.
    fs.appendFileSync(join(f.base.path,'expert/log.md'),'\nLater accepted event.\n');
    const result=f.cli('spawn');assert.equal(result.status,0,result.stdout);assert.equal(result.out.meta.source,s.file);
    assert.equal(fs.existsSync(pending),false);assert.deepEqual(tree(join(f.home,'knowledge')),original);
    assert.deepEqual(loadStatus(s).captured,before.captured);assert.equal(loadStatus(s).schedule.status,'ready');
    assert.equal(f.source().id,s.id);assert.equal(fs.readdirSync(join(s.bindings.stateDir,'sources')).length,1);
  });
}
test('views preserve existing destinations and roll back failed node resolution',t=>{
  const f=fixture(t),s=f.source(),target=join(f.dir,'reader');
  views(s.bindings,s.decl,target);const original=tree(target);
  assert.throws(()=>views(s.bindings,s.decl,target),/view exists/);assert.deepEqual(tree(target),original);
  const retryTarget=join(f.dir,'unresolved-view');
  assert.throws(()=>views(s.bindings,{...s.decl,reads:['project/missing']},retryTarget),/unresolved node/);
  assert.equal(fs.existsSync(retryTarget),false);views(s.bindings,s.decl,retryTarget);assertView(retryTarget,'project');
});
test('registration never deletes an unknown existing view or a symlink destination',t=>{
  const f=fixture(t),target=join(f.home,'knowledge');put(join(target,'keep.md'),'unregistered bytes');
  assert.throws(()=>f.source(),/unregistered knowledge view/);assert.equal(fs.readFileSync(join(target,'keep.md'),'utf8'),'unregistered bytes');
  fs.rmSync(target,{recursive:true});fs.symlinkSync(f.base.path,target);
  assert.throws(()=>f.source(),/symlink/);assert.ok(fs.existsSync(join(f.base.path,'index.md')));
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
test('R1 actual native scheduler registration is idempotent and never installs a host timer',{skip:!nativeCLI},t=>{
  const f=fixture(t),s=f.source();put(join(f.context,'oats-config.yaml'),'name: fixture\n');process.env.OATS_CLI_BIN=resolve(nativeCLI);
  const first=scheduleSource(s),second=scheduleSource(s);assert.equal(first.schedule.id,second.schedule.id);assert.equal(second.schedule.argv.includes(s.file),true);
  assert.equal(f.cli('setup',['--source',s.file,'--disable']).status,0);assert.equal(scheduleSource(s).schedule.enabled,false);
  const state=f.cli('inspect',['--source',s.file]);assert.equal(state.status,0,state.stdout);assert.notEqual(state.out.result.scheduler.active,true);assert.notEqual(state.out.result.scheduler.installed,true);
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
  const f=fixture(t,{kind:'git'});put(join(f.repo,'.gitignore'),'**/decision.md\n');fixtureCommit(f.repo,'ordinary ignore rule');
  note(f);const {s,run}=prepared(f),j=judgment(f,s,run);
  assert.throws(()=>complete(s,run.id,j),/publication tree omits validated proposal/);noPublication(f,s);
  const retained=readRun(s,run.id);assert.equal(retained.receipts.project.commit,undefined);
  assert.equal(fs.existsSync(join(run.stages.project.root,'expert/decision.md')),true);
  assert.throws(()=>retry(s),/publication tree omits validated proposal/);noPublication(f,s);
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
  assert.throws(()=>views(s.bindings,s.decl,join(f.dir,'blocked-reader')),/publication pending/);
  if(phase==='partial-write') {
    const unrelated=join(f.base.path,'expert/unrelated.tmp-foreign');put(unrelated,'unrelated bytes');
    assert.throws(()=>retry(s),/unexpected bytes during publication recovery/);assert.equal(fs.readFileSync(unrelated,'utf8'),'unrelated bytes');
    fs.rmSync(unrelated); // Only the fixture/operator may resolve unrelated bytes.
  }
  assert.equal(retry(s).processed,true);assert.equal(complete(s,run.id).processed,true);assert.equal(loadStatus(s).processed.length,1);
  const p=readJSON(readRun(s,run.id).receipts.project.proposal);assert.deepEqual(tree(f.base.path),p.after);
  assert.equal(fs.existsSync(journalPath(f.base)),false);views(s.bindings,s.decl,join(f.dir,'fresh-reader'));
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
  for(const cmd of ['clone','fetch','diff','read-tree','write-tree','commit-tree','cat-file','ls-tree','push']) assert.ok(recorded.some(c=>c.a.includes(cmd)),cmd);
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
  assert.throws(()=>complete(s,run.id,j),defect==='tree'?/publication tree changes files outside/:/exactly the frozen baseline as its parent/);noPublication(f,s);
  const receipt=readRun(s,run.id).receipts.project;assert.equal(receipt.status,'committed');
  // Retry re-verifies the immutable object, even with a persisted commit receipt.
  fs.rmSync(join(f.dir,'bin/git'));
  assert.throws(()=>retry(s),defect==='tree'?/publication tree changes files outside/:/exactly the frozen baseline as its parent/);noPublication(f,s);
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
  const newer=tree(f.base.path);views(s.bindings,s.decl,join(f.dir,'unblocked-reader'));
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
  assert.throws(()=>views(s.bindings,s.decl,join(f.dir,'blocked-reader')),/publication pending/);
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
test('custody R3 worker index mode-only entries are preserved but cannot contaminate publication',t=>{
  const f=fixture(t,{kind:'git'});note(f);const {s,run}=prepared(f),j=judgment(f,s,run),cwd=run.stages.project.checkout,path='knowledge/peer/log.md';
  git(cwd,['update-index','--chmod=+x','--',path]);
  const index=fs.readFileSync(join(cwd,'.git/index'));
  assert.equal(git(cwd,['ls-files','--stage','--',path]).split(' ')[0],'100755');
  const r=complete(s,run.id,j);assert.equal(r.processed,true);
  assert.equal(entryMode(f.repo,r.receipts.project.commit,path),'100644');
  assert.deepEqual(fs.readFileSync(join(cwd,'.git/index')),index,'worker index remains byte-for-byte intact');
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
for(const mode of ['live','retired','missing','reused']) test(`descriptor-selected read/refresh put views only in durable state: ${mode}`,t=>{
  const f=fixture(t),s=f.source();
  if(mode==='retired') capture(s,{final:true});
  if(mode==='missing' || mode==='reused') fs.rmSync(f.home,{recursive:true});
  if(mode==='reused') {put(join(f.home,'STATE.md'),'replacement home');save(join(f.home,'.okf-source.json'),{version:1,id:'replacement',source:'untrusted'});}
  const before=fs.readdirSync(f.context).sort(),homeFiles=fs.existsSync(f.home)?fs.readdirSync(f.home).sort():null;
  const refresh=externalView(f,'refresh',['--source',s.file]);assert.equal(dirname(refresh.path),join(dirname(s.file),'views'));assertView(refresh.path,'project');
  const read=externalView(f,'read',['--source',s.file,'--base','project','--path','expert/index.md']);
  assert.ok(read.path.startsWith(join(dirname(s.file),'views')+'/'));assert.equal(read.text,fs.readFileSync(join(f.base.path,'expert/index.md'),'utf8'));
  assert.deepEqual(fs.readdirSync(f.context).sort(),before);assert.deepEqual(fs.existsSync(f.home)?fs.readdirSync(f.home).sort():null,homeFiles);
  assert.equal(fs.readdirSync(join(dirname(s.file),'views')).length,2);
});
test('descriptor-selected reads still reject traversal and non-Markdown paths',t=>{
  const f=fixture(t),s=f.source();capture(s,{final:true});
  for(const path of ['../../../../status.json','../view.json','okf-base.json']) {const r=f.cli('read',['--source',s.file,'--base','project','--path',path]);assert.equal(r.status,1);assert.equal(r.out.error.code,'E_PATH');}
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
  const home=join(f.dir,'workers',`memory-harvest-okf-${next.id}`);assert.equal(retry(s,{adoptHome:home}).status,'ready');
  const calls=fs.readFileSync(f.calls,'utf8').trim().split('\n').map(JSON.parse);assert.equal(calls.filter(c=>c.a[0]==='spawn').length,2);
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
  assert.equal(queries.filter(q=>q[1]==='create').length,1);assert.equal(queries.at(-1)[1],'view');
});
