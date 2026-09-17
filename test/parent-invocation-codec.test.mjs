import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { persistentSubject, helperSubject } from './helpers/invocation-fixture.mjs';
import { validateInvocationShape } from '../oats-package/capabilities/oats-okf/lib/invocation-shape.mjs';

// Exact producer257c4b96b67001fa2bcf38436e57106c44aa797b, test-only imports.
// These are controlled loaded-record fixtures, not full retained approval or
// actual helper-launch qualification. Fresh homes come from the kernel scaffold.
const ROOT=fileURLToPath(new URL('../',import.meta.url));
const framework=process.env.OATS_INVOCATION_FRAMEWORK_ROOT || resolve(ROOT,'../kernel-invocation-257c4b96');
const CAP=join(ROOT,'oats-package/capabilities/oats-okf');
const contexts=[{kind:'standalone',key:'fixture'},{kind:'workspace',identity:{repository:{kind:'canonical-remote',remote:'git:https://example.invalid/workspace.git'},path:'oats-workspace.yaml'},observation:{kind:'workspace-default',document:{kind:'operator',id:'fixture'},pointer:''}}];
const action={kind:'hook',capability:'oats.okf',name:'soul-scaffold'};
async function producer(t) {
  if(!fs.existsSync(join(framework,'lib/captured-invocation-context.mjs'))) {
    if(process.env.OATS_INVOCATION_FRAMEWORK_ROOT) assert.fail('configured producer source is missing');
    t.skip('set OATS_INVOCATION_FRAMEWORK_ROOT to the exact reviewed producer source');return null;
  }
  const modules=await Promise.all(['captured-invocation-context','captured-binding-file','captured-scaffold','captured-instance-index'].map(name=>import(pathToFileURL(join(framework,`lib/${name}.mjs`)))));
  return Object.assign({},...modules);
}
function fixture(t,p,kind,context) {
  const root=fs.realpathSync(fs.mkdtempSync(join(tmpdir(),'okf-parent-context-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const deployment=join(root,'deployment'),name=`${kind}-1`,home=join(root,name),body=join(root,'source','AGENTS.md');
  fs.mkdirSync(deployment);fs.mkdirSync(dirname(body));fs.writeFileSync(body,'# Controlled source fixture\n');
  const stateDir=join(root,'state'),base={id:'fixture-base',kind:'directory',path:join(root,'accepted')};
  const binding={schemaVersion:1,capability:'oats.okf',payloadContract:'oats.okf.locations',payloadVersion:1,payload:{owner:'fixture-owner',stores:{'fixture-base':base},owns:[{store:'fixture-base',node:'expert',steward:'fixture-owner'}],reads:[],runtime:{descriptorFile:join(root,'bindings.json'),bindings:{version:1,stateDir,bases:{'fixture-base':base}},declaration:{version:1,owner:'fixture-owner',owns:['fixture-base/expert'],reads:[]}},execution:{runtime:'pi',model:null}},credentialRefs:{},provenance:[]};
  const subject=kind==='persistent'?persistentSubject():helperSubject();
  const loaded={deployment,resolution:{schemaVersion:1,id:`sha256-${'a'.repeat(64)}`},capability:{id:'oats.okf'},record:{subject,context,messagingChoice:{schemaVersion:1,enabled:false},bindings:{knowledge:binding},dispatch:{composition:{mode:'directory',body:'fixture-body'}}},resources:new Map([['fixture-body',body]]),composition:{text:'# Controlled composition fixture\n',skills:[]},capabilities:new Map([['oats.okf',{id:'oats.okf',manifest:{version:'0.0.0'},settings:{}}]])};
  const scaffold=p.materializeCapturedDirectoryScaffold({home,instance:name,loaded});
  const instance={home,work:join(home,'work'),name,agent:scaffold.agent};
  const env={HOME:join(root,'user'),OATS_HOME_DIR:join(root,'host-state'),TMPDIR:join(root,'tmp'),PATH:''};for(const path of [env.HOME,env.OATS_HOME_DIR,env.TMPDIR])fs.mkdirSync(path);
  return {loaded,binding,instance,env,stateDir,request:{deployment,home,executionBinding:scaffold.executionBinding,capability:'oats.okf',action,input:{fixture:'stateless-guidance'}}};
}

test('exact producer incarnation and intent reach OKF check and private snapshot validation',async t=>{
  const p=await producer(t);if(!p)return;
  for(const kind of ['persistent','helper']) for(const context of contexts) {
    const f=fixture(t,p,kind,context),admitted=p.admitCapturedInstanceAction(f.request);
    const value=p.buildCapturedInvocationContext({loaded:f.loaded,action,instance:f.instance,intent:admitted.intent});
    assert.equal(value.intent.incarnationId,value.instance.incarnationId);assert.deepEqual(validateInvocationShape(value),value);
    const check=spawnCheck(f,value);assert.equal(check.status,0,check.stderr);assert.deepEqual(JSON.parse(check.stdout).result,{status:'ready',problems:[]});
    const old=structuredClone(value);delete old.intent;delete old.instance.incarnationId;
    const refused=spawnCheck(f,old);assert.equal(refused.status,0);assert.deepEqual(JSON.parse(refused.stdout).error,{code:'invalid-binding'});
    p.beginCapturedIntent({...f.request,intent:admitted.intent});
    let contextFile,bindingFile;
    p.withCapturedInvocationContextFile(value,contextEnv=>p.withCapturedBindingFile(f.loaded,bindingEnv=>{
      contextFile=contextEnv.OATS_INVOCATION_CONTEXT_FILE;bindingFile=bindingEnv.OATS_BINDING_FILE;
      assert.equal(fs.statSync(contextFile).mode&0o777,0o600);assert.equal(fs.statSync(bindingFile).mode&0o777,0o600);
      assert.deepEqual(validateInvocationShape(JSON.parse(fs.readFileSync(contextFile,'utf8'))),value);
      assert.equal(p.readCapturedIntent({...f.request,intent:admitted.intent}).state,'running');
      // The real CLI now consumes the generic file too. Stateless guidance is
      // not helper launch or admission proof; the next call poisons its action.
      const result=spawnSync(process.execPath,[join(CAP,'bin/oats-okf.mjs'),'soul-scaffold'],{cwd:f.instance.home,env:{...f.env,...contextEnv,...bindingEnv,OATS_INSTANCE_HOME:f.instance.home},encoding:'utf8'});
      assert.equal(result.status,0,result.stdout+result.stderr);assert.equal(JSON.parse(result.stdout).meta.scaffolded,false);
      fs.writeFileSync(contextFile,JSON.stringify({...value,action:{...action,name:'retire'}}));
      const refused=spawnSync(process.execPath,[join(CAP,'bin/oats-okf.mjs'),'soul-scaffold'],{cwd:f.instance.home,env:{...f.env,...contextEnv,...bindingEnv,OATS_INSTANCE_HOME:f.instance.home},encoding:'utf8'});
      assert.equal(refused.status,1);assert.match(refused.stdout,/invalid captured OKF invocation/);
      fs.writeFileSync(contextFile,JSON.stringify(value));
    }));
    assert.equal(fs.existsSync(contextFile),false);assert.equal(fs.existsSync(bindingFile),false);
    assert.equal(fs.existsSync(f.stateDir),false,'stateless guidance creates no OKF registration, run or schedule');
    p.settleCapturedIntent({...f.request,intent:admitted.intent,state:'completed',receipt:{fixture:'guidance-complete'},replayable:true});
    assert.equal(p.admitCapturedInstanceAction({...f.request,retryExecutionId:admitted.intent.executionId}).replayed,true);
  }
});

function spawnCheck(f,invocation) {
  return spawnSync(process.execPath,[join(CAP,'bin/oats-okf-binding.mjs'),'check'],{input:JSON.stringify({schemaVersion:1,phase:'check',slot:'knowledge',capability:'oats.okf',settings:{},input:{binding:f.binding,context:f.loaded.record.context,action,invocation}}),env:f.env,encoding:'utf8'});
}
