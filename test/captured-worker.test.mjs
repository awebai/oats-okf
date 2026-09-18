// Focused consumer UNIT tests. Injected PUBLIC responses are not kernel
// admission or real native/model/worker evidence; no live operation is run.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {invocationFor,helperSubject} from './helpers/invocation-fixture.mjs';
import {workerCallEnvironment,qualifyCapturedWorker,validateWorkerSelection,readWorkerEndpoint,assertCapturedRun,capturedScaffold,capturedStart,retainCapturedWorkerCustody,assertCapturedWorkerHome} from '../oats-package/capabilities/oats-okf/lib/captured-worker.mjs';
const clone=v=>JSON.parse(JSON.stringify(v));
function fixture(t){
 const root=fs.realpathSync(fs.mkdtempSync(join(tmpdir(),'captured-worker-unit-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const base={id:'fixture-base',kind:'directory',path:join(root,'accepted')};
 const binding={schemaVersion:1,capability:'oats.okf',payloadContract:'oats.okf.locations',payloadVersion:1,payload:{owner:'fixture-owner',stores:{'fixture-base':base},owns:[{store:'fixture-base',node:'expert',steward:'fixture-owner'}],reads:[],runtime:{descriptorFile:join(root,'bindings.json'),bindings:{version:1,stateDir:join(root,'state'),bases:{'fixture-base':base}},declaration:{version:1,owner:'fixture-owner',owns:['fixture-base/expert'],reads:[]}},execution:{runtime:'pi',model:'native/model'}},credentialRefs:{},provenance:[]};
 const context=invocationFor({binding,context:{kind:'standalone',key:'fixture'},action:{kind:'operation',slot:'knowledge',name:'harvest'}});context.intent={schemaVersion:1,executionId:'source-request',incarnationId:context.instance.incarnationId,attempt:1};
 const source={file:join(root,'source.json'),registration:{schemaVersion:1,kind:'captured'},providerBinding:binding,sourceIdentity:context.subject.soul.identity,agent:context.instance.agent,instance:context.instance.name,home:context.instance.home,work:context.instance.work,context:context.executionBinding.deployment,responsibleHuman:null,executionBinding:context.executionBinding,execution:binding.payload.execution};
 const request={schemaVersion:1,backend:{backend:'tmux',binary:'/tools/tmux',socket:'/owned/socket',session:'owned'}},file=join(root,'request.json');fs.writeFileSync(file,JSON.stringify(request));
 const subject=helperSubject('memory-harvest');subject.provider.capability='oats.okf';
 const helperBinding={...clone(source.executionBinding),resolution:{schemaVersion:1,id:'sha256-'+'c'.repeat(64)}};
 const launch={schemaVersion:1,api:{contract:'oats.captured-session',version:2,available:true,backends:['tmux','herdr']},readiness:{status:'not-checked'}};
 const inspected={resolution:helperBinding.resolution,nativeSession:launch,capabilities:[{id:'oats.okf',approval:'approved'}],helperSelection:{schemaVersion:1,sourceExecutionBinding:source.executionBinding,executionBinding:helperBinding,helper:{key:'oats.okf:memory-harvest',name:'memory-harvest',subject},context:context.context,responsibleHuman:null,workMode:'directory',launch,launchSelection:{runtime:'pi',model:'native/model'}}};
 const plan=()=>qualifyCapturedWorker(source,{context,nativeRequest:file},()=>clone(inspected));
 return {root,source,context,request,file,inspected,plan};
}
test('worker child environment removes legacy instance aliases, preserving native auth and Git context',()=>{
 const inherited={HOME:'/native/home',PI_CODING_AGENT_DIR:'/native/profile',NATIVE_AUTH_HELPER:'synthetic-helper',ANTHROPIC_API_KEY:'SYNTHETIC-NOT-A-KEY',GIT_CONFIG_GLOBAL:'/native/gitconfig',GIT_SSH_COMMAND:'synthetic-ssh-helper',SSH_AUTH_SOCK:'/native/agent.sock',OATS_HOME_DIR:'/owned/oats-data',OATS_INSTANCE_HOME:'/parent/home',OATS_BINDING_FILE:'/parent/binding',OATS_INVOCATION_CONTEXT_FILE:'/parent/invocation',OAS_CONTEXT:'/parent/old-context',PI_AGENT_HOME:'/parent/home',PI_AGENT_INSTANCE:'parent',PI_AGENT_EXTRA:'legacy-selector',PI_AGENTS_ROOT:'/parent/agents'};
 const before={...inherited},env=workerCallEnvironment(inherited);
 for(const key of ['HOME','PI_CODING_AGENT_DIR','NATIVE_AUTH_HELPER','ANTHROPIC_API_KEY','GIT_CONFIG_GLOBAL','GIT_SSH_COMMAND','SSH_AUTH_SOCK','OATS_HOME_DIR'])assert.equal(env[key],inherited[key]);
 for(const key of ['OATS_INSTANCE_HOME','OATS_BINDING_FILE','OATS_INVOCATION_CONTEXT_FILE','OAS_CONTEXT','PI_AGENT_HOME','PI_AGENT_INSTANCE','PI_AGENT_EXTRA','PI_AGENTS_ROOT'])assert.equal(Object.hasOwn(env,key),false);
 assert.deepEqual(inherited,before);assert.notEqual(env,inherited);
});
test('captured worker requires current admitted persistent operation before public inspection',t=>{
 const f=fixture(t);let calls=0;const call=()=>{calls++;return f.inspected;};
 for(const context of [null,{...f.context,intent:null},{...f.context,action:{kind:'command',namespace:'okf',name:'harvest'}}])assert.throws(()=>qualifyCapturedWorker(f.source,{context,nativeRequest:f.file},call));
 assert.equal(calls,0);const plan=f.plan();assert.equal(plan.sourceIntent.executionId,'source-request');assert.equal(plan.helper.key,'oats.okf:memory-harvest');
});
test('worker endpoint is explicit bounded backend-only input, no task/env/model or symlink fallback',t=>{
 const f=fixture(t);assert.deepEqual(readWorkerEndpoint(f.file),f.request);
 for(const extra of [{task:'replace worker instructions'},{env:{}},{model:'other'}]){fs.writeFileSync(f.file,JSON.stringify({...f.request,...extra}));assert.throws(()=>readWorkerEndpoint(f.file),{code:'E_CAPTURED_HELPER'});}
 const link=join(f.root,'link');fs.symlinkSync(f.file,link);assert.throws(()=>readWorkerEndpoint(link));assert.throws(()=>readWorkerEndpoint('relative.json'),{code:'E_CAPTURED_HELPER'});
});
test('static API2 alone cannot qualify missing/mismatched helper selection or extra profiles',t=>{
 const f=fixture(t);
 for(const change of [{launchSelection:null},{launchSelection:{runtime:'pi',model:'different'}},{workMode:'worktree'},{responsibleHuman:{provider:'other',id:'human'}}])assert.throws(()=>validateWorkerSelection(f.source,f.context,f.request,{...f.inspected,helperSelection:{...f.inspected.helperSelection,...change}}),{code:'E_CAPTURED_HELPER'});
 assert.throws(()=>validateWorkerSelection(f.source,f.context,f.request,{...f.inspected,capabilities:[...f.inspected.capabilities,{id:'requires.plugin',approval:'approved'}]}),{code:'E_CAPTURED_HELPER'});
});
test('public scaffold uses HELPER binding; start uses SOURCE plus exact edge, never legacy selectors',t=>{
 const f=fixture(t),plan=f.plan(),home=join(f.root,'worker'),inc='22222222-2222-4222-8222-222222222222',calls=[];
 const worker={home,instance:'memory-harvest-fixture',agent:'memory-harvest',work:'directory',incarnationId:inc,executionBinding:plan.helperBinding,launchPending:true,hooksPending:false,cleanupRequired:false};
 const run={capturedWorker:plan,worker};
 assert.deepEqual(capturedScaffold(f.source,run,home,(_s,a)=>{calls.push(a);return worker;}),worker);
 const native={home,incarnationId:inc,executionBinding:plan.helperBinding,sourceExecutionBinding:plan.sourceBinding,helper:plan.helper,dispatchAccepted:true,intent:{executionId:'native-request',incarnationId:inc},runtime:'pi',model:'native/model'};
 assert.deepEqual(capturedStart(f.source,run,f.file,(_s,a)=>{calls.push(a);return native;}),native);
 assert.ok(calls[0].includes(plan.helperBinding.resolution.id));assert.ok(calls[1].includes(plan.sourceBinding.resolution.id));assert.ok(calls[1].includes('--helper'));
 for(const a of calls)for(const forbidden of ['--repo','--dir','--runtime','--model','--purpose'])assert.equal(a.includes(forbidden),false);
 assert.throws(()=>capturedStart(f.source,run,f.file,()=>({...native,incarnationId:'other'})),{code:'E_CAPTURED_HELPER_UNKNOWN'});
});
test('same retained run cannot change endpoint/identity or duplicate unknown scaffold/dispatch',t=>{
 const f=fixture(t),plan=f.plan(),run={status:'ready',capturedWorker:plan};assert.doesNotThrow(()=>assertCapturedRun(f.source,run,plan));
 for(const status of ['spawn-intent','scaffold-unknown','scaffolded','launch-intent','launch-unknown'])assert.throws(()=>assertCapturedRun(f.source,{...run,status},plan),{code:'E_CAPTURED_HELPER_UNKNOWN'});
 assert.throws(()=>assertCapturedRun(f.source,run,{...plan,requestHash:'changed'}),{code:'E_CAPTURED_HELPER'});
});
test('actual returned worker incarnation and existing kernel directory proof remain bound',t=>{
 const f=fixture(t),plan=f.plan(),home=join(f.root,'worker');fs.mkdirSync(home);fs.mkdirSync(join(home,'work'));
 const pair=p=>{const s=fs.lstatSync(p);return {dev:s.dev,ino:s.ino};};
 const worker={home,instance:'worker',incarnationId:'22222222-2222-4222-8222-222222222222'};
 const meta={instance:'worker',incarnationId:worker.incarnationId,kind:'helper',agent:'memory-harvest',executionBinding:plan.helperBinding,captured:{custody:{home:pair(home),work:pair(join(home,'work'))}}};
 const run={worker,capturedWorker:plan};plan.workerDirectoryCustody=retainCapturedWorkerCustody(run,meta);
 assert.doesNotThrow(()=>assertCapturedWorkerHome(f.source,run,meta,home));
 fs.renameSync(join(home,'work'),join(home,'old-work'));fs.mkdirSync(join(home,'work'));
 assert.throws(()=>assertCapturedWorkerHome(f.source,run,meta,home),{code:'E_WORKER'});
});
