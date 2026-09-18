// UNIT ONLY: synthetic config/record/exit-marker predicates. No framework/SDK
// import, model, backend, identity, capture, worker or real acceptance execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {validateConfig,nativeGateEnvironment,verifyTurnEvidence,waitForExit,runRealGate,within,completionObservationLimits,materializePinnedPayload,gateExitCode,outcomeInspectArgs,assessNativeOutcome} from '../scripts/real-retained-gate.mjs';
function config(){const launch={runtime:'pi',executable:'/source/framework/bin/oats-pi-sdk-host.mjs',args:['--oats-pi-host','1','--mode','print','--thinking','medium','--sdk-root','/native/pi','--sdk-version','0.85.1'],env:{},model:'native/model',yolo:false};return {schemaVersion:1,frameworkRoot:'/source/framework',frameworkCommit:'a'.repeat(40),providerRoot:'/source/provider',providerCommit:'b'.repeat(40),outputRoot:'/private/tmp/new-real-gate',primaryLaunch:launch,helperLaunch:{...launch,model:'native/helper-model'},backends:[{backend:'tmux',binary:'/native/tmux',socket:'/private/tmp/owned-tmux',session:'owned'},{backend:'herdr',binary:'/native/herdr',socket:'/private/tmp/owned-herdr',protocol:22}],turnTimeoutMs:60000,deadlineUtc:'2026-09-18T12:01:00Z'};}

test('unit: real gate requires explicit two-subject normal-auth launch and both backends',()=>{
  const c=config(),copy=validateConfig(c);assert.deepEqual(copy,c);assert.notEqual(copy,c);
  assert.equal(copy.helperLaunch.model,'native/helper-model');
  for(const bad of [{...c,backends:[c.backends[0]]},{...c,helperLaunch:undefined},{...c,deadlineUtc:'tomorrow'},{...c,turnTimeoutMs:900000},{...c,frameworkCommit:'main'}])assert.throws(()=>validateConfig(bad),{code:'E_GATE_CONFIG'});
});
test('unit: auth-file/env substitution and unsupported host grammar are not accepted',()=>{
  const c=config();for(const change of [{authFile:'/private/auth.json'},{env:{HOME:'/empty'}},{runtime:'claude'},{executable:'/fake/host'},{args:[...c.primaryLaunch.args,'--native-auth-file','/private/auth']},{args:c.primaryLaunch.args.map(x=>x==='print'?'interactive':x)}])assert.throws(()=>validateConfig({...c,primaryLaunch:{...c.primaryLaunch,...change}}),{code:'E_GATE_CONFIG'});
  assert.throws(()=>validateConfig({...c,backends:[c.backends[0],{...c.backends[1],protocol:999}]}),{code:'E_GATE_CONFIG'});
});
test('unit: native HOME/profile/helpers/auth environment inherited unchanged, never serialized',()=>{
  const inherited={HOME:'/user-home',PI_CODING_AGENT_DIR:'/user-profile',PI_AGENT_HOME:'/parent-home',PI_AGENT_INSTANCE:'parent-instance',PI_AGENTS_ROOT:'/parent-agents',NATIVE_AUTH_HELPER:'synthetic-native-helper',ANTHROPIC_API_KEY:'SYNTHETIC-NOT-A-KEY',OATS_DEPLOYMENT:'/parent',OATS_BINDING_FILE:'/parent/binding',TURN_RECORD_ROOT:'/old-record'};
  const before={...inherited},env=nativeGateEnvironment(inherited,'/private/tmp/gate');
  for(const key of ['HOME','PI_CODING_AGENT_DIR','NATIVE_AUTH_HELPER','ANTHROPIC_API_KEY'])assert.equal(env[key],inherited[key]);
  for(const key of ['PI_AGENT_HOME','PI_AGENT_INSTANCE','PI_AGENTS_ROOT'])assert.equal(env[key],undefined);
  assert.equal(env.OATS_DEPLOYMENT,undefined);assert.equal(env.OATS_BINDING_FILE,undefined);
  assert.equal(env.TURN_RECORD_ROOT,'/private/tmp/gate/record-store');assert.equal(env.OATS_HOME_DIR,'/private/tmp/gate/oats-state');assert.deepEqual(inherited,before);
});
test('unit: exit/model request alone never qualifies a real assistant turn',()=>{
  const home='/private/tmp/gate/homes/primary',root='/private/tmp/gate',nonce='controlled-nonce';
  const capture={home,complete:true,sessions:[{source:'pi',path:home+'/sessions/real.jsonl',thread:'pi:session:one'}]};
  const make=pieces=>[{thread:'pi:session:one',value:{turns:[{thread:'pi:session:one',kind:'session',source:'pi',text:pieces}]}}];
  assert.throws(()=>verifyTurnEvidence(capture,make([{role:'user',text:nonce}]),{home,root,nonce}),{code:'E_REAL_MODEL_TURN'});
  const recalled=make([{role:'user',text:nonce},{role:'assistant',text:'Observed '+nonce}]);
  assert.equal(verifyTurnEvidence(capture,recalled,{home,root,nonce}).realNativeAssistantTurn,true); // synthetic predicate unit, never native proof.
  assert.throws(()=>verifyTurnEvidence({...capture,sessions:[{...capture.sessions[0],path:'/user-profile/foreign.jsonl'}]},recalled,{home,root,nonce}),{code:'E_REAL_CAPTURE'});
  assert.equal(within('/tmp/gate','/tmp/gate-other'),false);
});
test('unit: event-driven exit observation requires exact execution ID and is bounded',async t=>{
  const home=fs.realpathSync(fs.mkdtempSync(join(tmpdir(),'exit-marker-unit-')));t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
  fs.writeFileSync(join(home,'.oats-start-exited'),'wrong-id\n');
  await assert.rejects(waitForExit(home,'expected-id',20),{code:'E_GATE_TURN_TIMEOUT'});
  const pending=waitForExit(home,'expected-id',1000);fs.writeFileSync(join(home,'.oats-start-exited'),'expected-id\n');
  assert.deepEqual(await pending,{executionId:'expected-id',exitObserved:true,exitStatusAvailable:false});
});
test('offline: pinned payload excludes dirty/untracked/ignored working bytes and preserves modes/internal alias',t=>{
  const root=fs.realpathSync(fs.mkdtempSync(join(tmpdir(),'gate-payload-unit-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const repo=join(root,'source'),payload=join(repo,'oats-package'),out=join(root,'materialized');fs.mkdirSync(payload,{recursive:true});
  const env={...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_SYSTEM:'/dev/null',GIT_CONFIG_COUNT:'0'};
  const git=(...a)=>execFileSync('git',['-C',repo,...a],{env,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  git('-c','init.templateDir=','init','--quiet');fs.writeFileSync(join(payload,'AGENTS.md'),'# committed\n');fs.symlinkSync('AGENTS.md',join(payload,'CLAUDE.md'));
  fs.writeFileSync(join(payload,'run.mjs'),'#!/usr/bin/env node\n');fs.chmodSync(join(payload,'run.mjs'),0o755);fs.writeFileSync(join(payload,'.gitignore'),'ignored.mjs\n');
  git('add','.');git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','--quiet','-m','pinned');const commit=git('rev-parse','HEAD');
  fs.writeFileSync(join(payload,'AGENTS.md'),'DIRTY replacement\n');fs.writeFileSync(join(payload,'extra.mjs'),'untracked executable bytes');fs.writeFileSync(join(payload,'ignored.mjs'),'ignored executable bytes');fs.chmodSync(join(payload,'run.mjs'),0o644);
  const receipt=materializePinnedPayload(repo,commit,out);assert.equal(receipt.tree,git('rev-parse',commit+':oats-package'));assert.equal(receipt.trackedEntries,4);assert.equal(receipt.exactMaterializedInventoryBytesTypesModes,true);
  assert.deepEqual(fs.readdirSync(out).sort(),['.gitignore','AGENTS.md','CLAUDE.md','run.mjs']);assert.equal(fs.readFileSync(join(out,'AGENTS.md'),'utf8'),'# committed\n');assert.equal(fs.readlinkSync(join(out,'CLAUDE.md')),'AGENTS.md');assert.ok(fs.statSync(join(out,'run.mjs')).mode&0o111);
  assert.throws(()=>materializePinnedPayload(repo,commit,out),{code:'E_GATE_SOURCE'});
});
test('unit: source drift/failure/unknown statuses cannot use the partial observation exit',()=>{
  assert.equal(gateExitCode('passed'),0);assert.equal(gateExitCode('partial-completion-evidence'),2);
  for(const status of ['failed','failed-source-drift','running','arbitrary',undefined])assert.equal(gateExitCode(status),1);
});
test('unit: missing observations stay partial; exactly four validated completions lift only that hold',()=>{
  const limits=completionObservationLimits();assert.equal(limits.length,2);
  assert.deepEqual(limits.map(x=>x.status),['not-observed','not-established']);
  assert.match(limits[0].reason,/no exit status/);assert.match(limits[1].reason,/final stop reason/);
  const rows=Array.from({length:4},()=>({completion:{qualified:true}}));assert.deepEqual(completionObservationLimits(rows),[]);
  assert.equal(completionObservationLimits(rows.slice(1)).length,2);rows[2].completion.qualified=false;assert.equal(completionObservationLimits(rows).length,2);
});
function outcomeFixture(helper=false,backend='tmux'){
  const root='/private/tmp/gate',home=root+(helper?'/worker':'/primary'),sourceBinding={schemaVersion:1,deployment:root+'/deployment',resolution:{schemaVersion:1,id:'sha256-'+'a'.repeat(64)}};
  const executionBinding=helper?{...sourceBinding,resolution:{schemaVersion:1,id:'sha256-'+'b'.repeat(64)}}:sourceBinding;
  const launch={...config().primaryLaunch,model:'native/'+(helper?'helper/model:literal':'model:literal')};
  const incarnationId='11111111-1111-4111-8111-111111111111',nativeRecordId='22222222-2222-4222-8222-222222222222';
  const intent={schemaVersion:1,incarnationId,executionId:'original-native-dispatch',attempt:1};
  const target=backend==='tmux'?{backend,socket:root+'/tmux.sock',session:'owned',window:'actual'}:{backend,binary:'/native/herdr',socket:root+'/herdr.sock',protocol:22,workspaceId:'observed-workspace',paneId:'observed-pane',terminalId:'observed-terminal'};
  const edge={key:'oats.okf:memory-harvest',name:'memory-harvest',subject:{kind:'helper'}};
  const dispatch={home,nativeRecordId,incarnationId,intent,executionBinding,target,...(helper?{sourceExecutionBinding:sourceBinding,helper:edge}:{})};
  const selected={runtime:'pi',provider:'native',id:launch.model.slice('native/'.length),sdkVersion:'0.85.1'},sessionDir=root+'/history';
  const authority={home,sessionDir,nativeRecordId,incarnationId,intent,executionBinding,target,inputIntegrity:{format:'oats.json.v1',value:'sha256-'+'c'.repeat(64)},selected};
  const outcome={schemaVersion:1,contract:'oats.pi-print-completion',nonAuthorizing:true,authority,status:'succeeded',qualified:true,processExitCode:0,sdkExitCode:0,finalObserved:true,evidence:{process:true,sdk:true,sessionFile:true},sdk:{sdkVersion:'0.85.1',header:{type:'session',version:3,id:'sdk-session',cwd:home,timestamp:'2026-09-18T10:00:00Z'},sessionId:'sdk-session',sessionFile:sessionDir+'/sdk-session.jsonl',model:{provider:selected.provider,id:selected.id},finalAssistant:{entryId:'actual-entry',provider:selected.provider,model:selected.id,responseModel:null,stopReason:'stop',timestamp:42}}};
  return {expected:{home,root,sourceBinding,dispatch,launch,helper},query:{outcome,executionBinding,...(helper?{sourceExecutionBinding:sourceBinding,helper:edge}:{})}};
}
test('unit: actual public outcome shape requires both exit zeros and exact opaque model tuple on either backend',()=>{
  for(const backend of ['tmux','herdr']){const f=outcomeFixture(false,backend);assert.equal(assessNativeOutcome(f.query,f.expected).qualified,true);assert.equal(assessNativeOutcome(f.query,f.expected).sessionFile,f.query.outcome.sdk.sessionFile);}
  const f=outcomeFixture();assert.throws(()=>assessNativeOutcome({ok:true},f.expected),{code:'E_REAL_OUTCOME'});
  assert.deepEqual(outcomeInspectArgs(f.expected.sourceBinding,f.expected.dispatch),['session','inspect','--deployment',f.expected.sourceBinding.deployment,'--resolution',f.expected.sourceBinding.resolution.id,'--home',f.expected.home,'--native-record',f.expected.dispatch.nativeRecordId,'--json']);
});
test('unit: helper outcome uses SOURCE plus exact edge, not the dedicated HELPER selector',()=>{
  const f=outcomeFixture(true),args=outcomeInspectArgs(f.expected.sourceBinding,f.expected.dispatch,true);
  assert.ok(args.includes(f.expected.sourceBinding.resolution.id));assert.equal(args.includes(f.expected.dispatch.executionBinding.resolution.id),false);assert.ok(args.includes('oats.okf:memory-harvest'));assert.equal(assessNativeOutcome(f.query,f.expected).qualified,true);
  assert.throws(()=>assessNativeOutcome({...f.query,sourceExecutionBinding:f.query.executionBinding},f.expected),{code:'E_REAL_OUTCOME'});
  assert.throws(()=>outcomeInspectArgs(f.expected.sourceBinding,{...f.expected.dispatch,nativeRecordId:undefined},true),{code:'E_REAL_OUTCOME'});
});
test('unit: nullable/incomplete completion never defaults to zero, while actual failure is not partial success',()=>{
  const f=outcomeFixture(),change=o=>({...f.query,outcome:{...f.query.outcome,...o}});
  assert.equal(assessNativeOutcome(change({status:'incomplete',qualified:false,processExitCode:null}),f.expected).qualified,false);
  assert.equal(assessNativeOutcome(change({status:'incomplete',qualified:false,sdkExitCode:null,sdk:null,finalObserved:false}),f.expected).qualified,false);
  for(const o of [{status:'failed',qualified:false,processExitCode:7},{qualified:false,sdkExitCode:143}])assert.throws(()=>assessNativeOutcome(change(o),f.expected),{code:'E_REAL_NATIVE_FAILURE'});
  for(const o of [{processExitCode:null},{sdkExitCode:undefined},{qualified:true,status:'incomplete'},{status:'unknown'}])assert.throws(()=>assessNativeOutcome(change(o),f.expected),{code:'E_REAL_OUTCOME'});
});
test('unit: claimed success cannot substitute original dispatch/ref/model/header/session evidence',()=>{
  const f=outcomeFixture();
  const mutations=[q=>{q.outcome.authority.home+='/other';},q=>{q.outcome.authority.nativeRecordId='33333333-3333-4333-8333-333333333333';},q=>{q.outcome.authority.incarnationId='other';},q=>{q.outcome.authority.intent.attempt=2;},q=>{q.outcome.authority.executionBinding.resolution.id='foreign';},q=>{q.outcome.authority.target.window='foreign';},q=>{q.outcome.authority.selected.id='other';},q=>{q.outcome.sdk.model.id='other';},q=>{q.outcome.sdk.header.cwd='/foreign';},q=>{q.outcome.sdk.header.version=2;},q=>{q.outcome.sdk.sessionFile='/foreign/session.jsonl';},q=>{q.outcome.sdk.finalAssistant.stopReason='length';},q=>{q.outcome.evidence.process=false;}];
  for(const mutate of mutations){const q=structuredClone(f.query);mutate(q);assert.throws(()=>assessNativeOutcome(q,f.expected),{code:'E_REAL_OUTCOME'});}
  assert.equal(assessNativeOutcome(f.query,f.expected).qualified,true,'original attempt stays exact; a later reconciliation counter is not substituted');
});
test('unit: qualified outcome must match the actual captured SDK session, not another nonce-bearing thread',()=>{
  const f=outcomeFixture(),completion=assessNativeOutcome(f.query,f.expected),nonce='unique-task';
  const session={source:'pi',path:completion.sessionFile,sessionId:completion.sessionId,cwd:f.expected.home,thread:'pi:session:sdk-session'};
  const capture={home:f.expected.home,complete:true,sessions:[session]},recalls=[{thread:session.thread,value:{turns:[{thread:session.thread,kind:'session',source:'pi',text:[{role:'user',text:nonce},{role:'assistant',text:nonce}]}]}}];
  assert.equal(verifyTurnEvidence(capture,recalls,{...f.expected,nonce,completion}).realNativeAssistantTurn,true);
  assert.throws(()=>verifyTurnEvidence(capture,recalls,{...f.expected,nonce,completion:{...completion,sessionId:'foreign'}}),{code:'E_REAL_CAPTURE'});
  const other={...session,path:f.expected.root+'/other.jsonl',sessionId:'other',thread:'pi:session:other'};capture.sessions.push(other);recalls.push({thread:other.thread,value:{turns:[{thread:other.thread,kind:'session',source:'pi',text:[{role:'user',text:nonce},{role:'assistant',text:nonce}]}]}});recalls[0].value.turns[0].text[1].text='not the expected task';
  assert.throws(()=>verifyTurnEvidence(capture,recalls,{...f.expected,nonce,completion}),{code:'E_REAL_MODEL_TURN'});
});
test('unit: no real opt-in refuses before source import, filesystem or native operations',async()=>{
  await assert.rejects(runRealGate(config()),{code:'E_REAL_OPT_IN'});
});
