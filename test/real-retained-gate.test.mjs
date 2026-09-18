// UNIT ONLY: synthetic config/record/exit-marker predicates. No framework/SDK
// import, model, backend, identity, capture, worker or real acceptance execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {validateConfig,nativeGateEnvironment,verifyTurnEvidence,waitForExit,runRealGate,within,completionObservationLimits} from '../scripts/real-retained-gate.mjs';
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
  const inherited={HOME:'/user-home',PI_CODING_AGENT_DIR:'/user-profile',PI_AGENT_HOME:'/native-selected-profile',NATIVE_AUTH_HELPER:'synthetic-native-helper',ANTHROPIC_API_KEY:'SYNTHETIC-NOT-A-KEY',OATS_DEPLOYMENT:'/parent',OATS_BINDING_FILE:'/parent/binding',TURN_RECORD_ROOT:'/old-record'};
  const before={...inherited},env=nativeGateEnvironment(inherited,'/private/tmp/gate');
  for(const key of ['HOME','PI_CODING_AGENT_DIR','PI_AGENT_HOME','NATIVE_AUTH_HELPER','ANTHROPIC_API_KEY'])assert.equal(env[key],inherited[key]);
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
test('unit: current observations cannot qualify process success or final SDK completion',()=>{
  const limits=completionObservationLimits();assert.equal(limits.length,2);
  assert.deepEqual(limits.map(x=>x.status),['not-observed','not-established']);
  assert.match(limits[0].reason,/no exit status/);assert.match(limits[1].reason,/final stop reason/);
});
test('unit: no real opt-in refuses before source import, filesystem or native operations',async()=>{
  await assert.rejects(runRealGate(config()),{code:'E_REAL_OPT_IN'});
});
