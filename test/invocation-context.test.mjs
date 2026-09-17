import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { invocationFor, helperSubject } from './helpers/invocation-fixture.mjs';
import { INVOCATION_CONTEXT_LIMITS, loadCapturedOkfInvocation, assertOkfInvocationAction, requireOkfAdmittedAction, assertOkfSourceReceiptContext, assertOkfSourceContext } from '../oats-package/capabilities/oats-okf/lib/invocation-context.mjs';

const CAP=fileURLToPath(new URL('../oats-package/capabilities/oats-okf/',import.meta.url));
const manifest=JSON.parse(fs.readFileSync(join(CAP,'oats.json'),'utf8'));
const plain=value=>JSON.parse(JSON.stringify(value));
function fixture(t) {
  const root=fs.realpathSync(fs.mkdtempSync(join(tmpdir(),'okf-invocation-reader-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const base={id:'fixture-base',kind:'directory',path:join(root,'accepted')};
  const binding={schemaVersion:1,capability:'oats.okf',payloadContract:'oats.okf.locations',payloadVersion:1,payload:{owner:'fixture-owner',stores:{'fixture-base':base},owns:[{store:'fixture-base',node:'expert',steward:'fixture-owner'}],reads:[],runtime:{descriptorFile:join(root,'bindings.json'),bindings:{version:1,stateDir:join(root,'state'),bases:{'fixture-base':base}},declaration:{version:1,owner:'fixture-owner',owns:['fixture-base/expert'],reads:[]}},execution:{runtime:'pi',model:null}},credentialRefs:{},provenance:[]};
  const context=invocationFor({binding,context:{kind:'standalone',key:'fixture'},action:{kind:'hook',capability:'oats.okf',name:'spawn'}});
  context.intent={schemaVersion:1,executionId:'request:fixture',incarnationId:context.instance.incarnationId,attempt:1};
  const bindingFile=join(root,'binding.json'),contextFile=join(root,'context.json');
  const write=()=>{fs.writeFileSync(bindingFile,JSON.stringify(binding),{mode:0o600});fs.writeFileSync(contextFile,JSON.stringify(context),{mode:0o600});};write();
  return {root,binding,context,bindingFile,contextFile,write,env:{OATS_BINDING_FILE:bindingFile,OATS_INVOCATION_CONTEXT_FILE:contextFile}};
}
function receiptFor(context,binding) {
  return {schemaVersion:1,kind:context.subject.kind,...Object.fromEntries(['home','work','agent'].map(key=>[key,context.instance[key]])),instance:context.instance.name,context:context.executionBinding.deployment,
    sourceIdentity:context.subject.kind==='persistent'?context.subject.soul.identity:null,role:'# Retained role\n',executionBinding:context.executionBinding,responsibleHuman:context.responsibleHuman,binding};
}

test('execution reader consumes one strict paired projection and never fills missing authority',t=>{
  const f=fixture(t);assert.deepEqual(loadCapturedOkfInvocation({}),{kind:'legacy'});
  const loaded=loadCapturedOkfInvocation({...f.env,OATS_SETTINGS:'poison',OATS_SOUL:'/poison'});
  assert.equal(loaded.kind,'captured');assert.deepEqual(plain(loaded.context),f.context);assert.deepEqual(plain(loaded.binding),f.binding);
  for(const env of [{OATS_BINDING_FILE:f.bindingFile},{OATS_INVOCATION_CONTEXT_FILE:f.contextFile},{OATS_SOURCE_RECEIPT_FILE:'/absent'}, {...f.env,OATS_BINDING_FILE:f.contextFile},{...f.env,OATS_SOURCE_RECEIPT_FILE:f.bindingFile}]) assert.throws(()=>loadCapturedOkfInvocation(env),{code:'E_INVOCATION'});
});

test('execution snapshot custody rejects nonprivate links malformed bytes and raw oversize',t=>{
  const f=fixture(t);
  for(const mode of [0o400,0o640,0o700]) {fs.chmodSync(f.contextFile,mode);assert.throws(()=>loadCapturedOkfInvocation(f.env),{code:'E_INVOCATION'});fs.chmodSync(f.contextFile,0o600);}
  const link=join(f.root,'link.json');fs.symlinkSync(f.contextFile,link);assert.throws(()=>loadCapturedOkfInvocation({...f.env,OATS_INVOCATION_CONTEXT_FILE:link}),{code:'E_INVOCATION'});fs.unlinkSync(link);
  fs.linkSync(f.contextFile,link);assert.throws(()=>loadCapturedOkfInvocation(f.env),{code:'E_INVOCATION'});fs.unlinkSync(link);
  const ancestor=join(f.root,'linked-root');fs.symlinkSync(f.root,ancestor);assert.throws(()=>loadCapturedOkfInvocation({...f.env,OATS_INVOCATION_CONTEXT_FILE:join(ancestor,'context.json')}),{code:'E_INVOCATION'});
  for(const bytes of ['{"schemaVersion":1,"schemaVersion":1}',Buffer.from([0xff]),Buffer.alloc(INVOCATION_CONTEXT_LIMITS.bytes+1,32)]) {fs.writeFileSync(f.contextFile,bytes);assert.throws(()=>loadCapturedOkfInvocation(f.env),{code:'E_INVOCATION'});}
  f.write();const old=plain(f.context);delete old.intent;fs.writeFileSync(f.contextFile,JSON.stringify(old));assert.throws(()=>loadCapturedOkfInvocation(f.env),{code:'E_INVOCATION'});
  fs.writeFileSync(f.contextFile,JSON.stringify({...f.context,capability:'other.provider'}));assert.throws(()=>loadCapturedOkfInvocation(f.env),{code:'E_INVOCATION'});
});

test('execution action uses the existing manifest command hook and operation table',t=>{
  const f=fixture(t),loaded=loadCapturedOkfInvocation(f.env);
  assert.doesNotThrow(()=>assertOkfInvocationAction(loaded.context,'spawn',manifest));assert.doesNotThrow(()=>requireOkfAdmittedAction(loaded.context));
  for(const action of [{kind:'command',namespace:'okf',name:'inspect'},{kind:'command',capability:'oats.okf',name:'inspect'},{kind:'operation',slot:'knowledge',name:'inspect'}]) assert.doesNotThrow(()=>assertOkfInvocationAction({...loaded.context,action},'inspect',manifest));
  for(const action of [{kind:'command',namespace:'other',name:'inspect'},{kind:'operation',slot:'messaging',name:'inspect'},{kind:'hook',capability:'oats.okf',name:'retire'},{kind:'inspect'}]) assert.throws(()=>assertOkfInvocationAction({...loaded.context,action},'inspect',manifest),{code:'E_INVOCATION'});
  assert.throws(()=>requireOkfAdmittedAction({...loaded.context,intent:null}),{code:'E_ADMISSION'});
  assert.throws(()=>requireOkfAdmittedAction({...loaded.context,instance:null,intent:null,action:{kind:'inspect'}}),{code:'E_ADMISSION'});
});

test('source receipt consistency preserves deployment context helper identity and companion binding',t=>{
  const f=fixture(t);
  for(const context of [f.context,invocationFor({binding:f.binding,context:f.context.context,action:f.context.action,subject:helperSubject()})]) {
    const receipt=receiptFor(context,f.binding);assert.doesNotThrow(()=>assertOkfSourceReceiptContext(receipt,context,f.binding));
    for(const change of [{home:'/other'},{work:'/other/work'},{instance:'other'},{agent:'other'},{context:'/other-deployment'},{responsibleHuman:{provider:'oats.aweb',id:'other'}},{sourceIdentity:{kind:'local-soul',source:'path:/other',exportPath:'.'}}]) assert.throws(()=>assertOkfSourceReceiptContext({...receipt,...change},context,f.binding),{code:'E_INVOCATION'});
    const changed=plain(f.binding);changed.payload.execution.model='different/model';assert.throws(()=>assertOkfSourceReceiptContext({...receipt,binding:changed},context,f.binding),{code:'E_INVOCATION'});
  }
});

test('source descriptor consistency keeps source completion separate from helper execution',t=>{
  const f=fixture(t),receipt=receiptFor(f.context,f.binding),source={...receipt,providerBinding:f.binding};delete source.binding;
  assert.doesNotThrow(()=>assertOkfSourceContext(source,f.context,f.binding));
  const scope={...f.context,instance:null,intent:null,action:{kind:'command',namespace:'okf',name:'complete'}};
  assert.doesNotThrow(()=>assertOkfSourceContext(source,scope,f.binding),'consistency only: this does not grant new mutation authority');
  for(const change of [{sourceIdentity:{kind:'local-soul',source:'path:/other',exportPath:'.'}},{executionBinding:{...source.executionBinding,resolution:{schemaVersion:1,id:`sha256-${'d'.repeat(64)}`}}},{responsibleHuman:{provider:'oats.aweb',id:'other'}},{instance:'other'}]) assert.throws(()=>assertOkfSourceContext({...source,...change},f.context,f.binding),{code:'E_INVOCATION'});
  const helper=invocationFor({binding:f.binding,context:f.context.context,action:scope.action,subject:helperSubject(),instance:null});
  assert.throws(()=>assertOkfSourceContext(source,helper,f.binding),{code:'E_INVOCATION'});
});
