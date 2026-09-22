import test from 'node:test';
import { invocationFor, helperSubject } from './helpers/invocation-fixture.mjs';
import { inventory, noEffectsPreload } from './helpers/no-effects.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { bindingChoiceKey, storeChoiceKey } from '../oats-package/capabilities/oats-okf/lib/portable-binding.mjs';
import { CHECK_REASONS, loadInvocationKnowledgeBinding, parseBindingJson, sourceRuntimeFromKnowledgeBinding } from '../oats-package/capabilities/oats-okf/lib/binding-wire.mjs';
import { bindingFingerprint, validateBindings } from '../oats-package/capabilities/oats-okf/lib/config.mjs';
import { initBase } from '../oats-package/capabilities/oats-okf/lib/migration.mjs';
import { loadSource, register } from '../oats-package/capabilities/oats-okf/lib/sources.mjs';
import { tree } from '../oats-package/capabilities/oats-okf/lib/io.mjs';

const ROOT=fileURLToPath(new URL('../',import.meta.url));
const CLI=join(ROOT,'oats-package/capabilities/oats-okf/bin/oats-okf-binding.mjs');
const declaredReasons=new Set(JSON.parse(fs.readFileSync(join(ROOT,'oats-package/capabilities/oats-okf/oats.json'))).binding.reasons);
const contract='oats.okf.locations';
const origin=(kind,pointer)=>({kind,document:{kind:'source',source:'git:https://example.test/source.git',revision:'a'.repeat(40),path:'soul.yaml',integrity:{format:'oats.bytes.v1',value:`sha256-${'b'.repeat(64)}`}},pointer});
const locator=(id,path)=>({id,kind:'directory',path:`path:${path}`});
const canonical=value=>value===null || typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?`[${value.map(canonical).join(',')}]`:`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
const call=(phase,request,env={})=>{
  const bytes=Buffer.isBuffer(request)?request:typeof request==='string'?request:JSON.stringify(request);
  const result=spawnSync(process.execPath,[CLI,phase],{input:bytes,encoding:Buffer.isBuffer(bytes)?undefined:'utf8',maxBuffer:2*1024*1024,env:{...process.env,...env}});
  const stdout=Buffer.isBuffer(result.stdout)?result.stdout.toString('utf8'):result.stdout;
  const response=JSON.parse(stdout);
  for(const message of [response.error?.message,...(response.result?.problems??[]).map(p=>p.message)].filter(v=>v!==undefined))assert.ok(declaredReasons.has(message),'emitted fixed reason must be declared byte-exactly');
  return {...result,stdout,response};
};
const request=(phase,settings,input)=>({schemaVersion:1,phase,slot:'knowledge',capability:'oats.okf',settings,input});
function selected(value,selectedBy) {return {value,selectedBy,constraints:[],considered:[{kind:selectedBy.kind,value,origin:selectedBy,disposition:'selected'}]};}
function fixture(t) {
  const root=fs.mkdtempSync(join(fs.realpathSync(tmpdir()),'okf-binding-wire-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const descriptorFile=join(root,'host','bindings.json'),stateDir=join(root,'state'),readPath=join(root,'read'),writePath=join(root,'write');
  fs.mkdirSync(dirname(descriptorFile),{recursive:true});
  const settings={'bindings-file':descriptorFile,'state-dir':stateDir,'harvest-runtime':'pi','harvest-model':'fixture/model'};
  const soulOrigin=origin('soul-requirement','/knowledge');
  const operatorOrigin={kind:'operator',document:{kind:'operator',id:'fixture-human'},pointer:'/bindings'};
  const soul={contract,version:1,payload:{owner:'expert-owner',stores:{
    reference:{fixed:locator('reference-base',readPath)},destination:{inherit:'write.default'},
  },reads:[{store:'reference',node:'reference'}],owns:[{node:'expert',destination:'destination'}]}};
  const declarations=[
    {kind:'soul',value:{knowledge:soul},origin:soulOrigin,origins:{}},
    {kind:'workspace',value:{knowledge:{stores:[{contract,version:1,payload:{bindings:{'write.default':locator('workspace-base',join(root,'workspace'))}}}]}},origin:origin('workspace-default','/knowledge'),origins:{}},
    {kind:'adoption',value:{bindings:{'write.default':locator('adopted-base',join(root,'adopted'))}},origin:origin('import-adoption','/adoption'),origins:{}},
    {kind:'operator',value:{bindings:{'write.default':locator('private-base',writePath)}},origin:operatorOrigin,origins:{}},
  ];
  return {root,descriptorFile,stateDir,readPath,writePath,settings,declarations,soulOrigin,operatorOrigin};
}

function prepareBinding(t) {
  const f=fixture(t),normalized=call('normalize',request('normalize',f.settings,{declarations:f.declarations,context:{kind:'standalone',key:'fixture'}}));
  assert.equal(normalized.status,0,normalized.stderr?.toString());assert.equal(normalized.response.ok,true);
  const fixed=locator('reference-base',f.readPath),destination=locator('private-base',f.writePath);
  const choices={
    [storeChoiceKey('reference')]:selected(fixed,{...f.soulOrigin,kind:'soul-requirement',pointer:'/knowledge/payload/stores/reference/fixed'}),
    [bindingChoiceKey('write.default')]:selected(destination,{...f.operatorOrigin,pointer:'/bindings/write.default'}),
  };
  const bound=call('bind',request('bind',{}, {model:normalized.response.result.model,choices,context:{kind:'standalone',key:'fixture'}}));
  assert.equal(bound.status,0,bound.stderr?.toString());assert.equal(bound.response.ok,true);
  return {f,normalized:normalized.response.result,bound:bound.response.result,binding:{schemaVersion:1,capability:'oats.okf',...bound.response.result}};
}

test('normalize preserves separate authority candidates and bind emits the captured runtime payload',t=>{
  const {f,normalized,bound}=prepareBinding(t);
  assert.deepEqual(normalized.requirements.map(({key,kind})=>[key,kind]),[[storeChoiceKey('reference'),'equals'],[bindingChoiceKey('write.default'),'required']]);
  assert.ok(normalized.requirements.every(entry=>entry.origin.pointer==='/knowledge'),'fallback origins preserve a supplied witness rather than inventing a field pointer');
  assert.deepEqual(normalized.candidates.map(({key,kind})=>[key,kind]),[
    [bindingChoiceKey('write.default'),'workspace-default'],[bindingChoiceKey('write.default'),'import-adoption'],[bindingChoiceKey('write.default'),'operator'],
  ]);
  assert.equal(bound.payloadContract,contract);assert.equal(bound.payloadVersion,1);assert.deepEqual(bound.credentialRefs,{});
  assert.deepEqual(bound.payload.runtime.bindings,{version:1,stateDir:f.stateDir,bases:{
    'reference-base':{id:'reference-base',kind:'directory',path:f.readPath},
    'private-base':{id:'private-base',kind:'directory',path:f.writePath},
  }});
  assert.deepEqual(bound.payload.runtime.declaration,{version:1,owner:'expert-owner',reads:['reference-base/reference'],owns:['private-base/expert']});
  assert.deepEqual(bound.payload.execution,{runtime:'pi',model:'fixture/model'});
  const complete={schemaVersion:1,capability:'oats.okf',...bound};
  assert.deepEqual(sourceRuntimeFromKnowledgeBinding(complete),{
    owner:'expert-owner',bindings:{file:f.descriptorFile,...bound.payload.runtime.bindings},decl:bound.payload.runtime.declaration,execution:{runtime:'pi',model:'fixture/model'},
  });
  const canonicalOrder=structuredClone(complete);canonicalOrder.payload.runtime={bindings:canonicalOrder.payload.runtime.bindings,declaration:canonicalOrder.payload.runtime.declaration,descriptorFile:canonicalOrder.payload.runtime.descriptorFile};canonicalOrder.payload.execution={model:'fixture/model',runtime:'pi'};
  assert.doesNotThrow(()=>sourceRuntimeFromKnowledgeBinding(canonicalOrder),'canonical transport key order does not change binding identity');
  const canonicalCheck=call('check',canonical(request('check',{}, {binding:complete,context:{kind:'standalone',key:'fixture'},action:{kind:'spawn'}})));
  assert.equal(canonicalCheck.response.ok,true,'real canonical-order wire must not change structural payload equality');
  const scaffold=call('check',request('check',{}, {binding:complete,context:{kind:'standalone',key:'fixture'},action:{kind:'hook',capability:'oats.okf',name:'soul-scaffold'}}));
  assert.deepEqual(scaffold.response.result,{status:'ready',problems:[]});assert.equal(fs.existsSync(f.stateDir),false,'stateless qualification does not bootstrap missing bases or state');
});

test('check validates real directory and private-staged Git acceptance read-only',t=>{
  const {f,binding}=prepareBinding(t),bindings=validateBindings(binding.payload.runtime.bindings,f.descriptorFile);
  for(const [alias,nodes] of [['reference-base',{reference:{path:'reference',owner:'reference-owner'}}],['private-base',{expert:{path:'expert',owner:'expert-owner'}}]]) {
    const file=join(f.root,`${alias}-nodes.json`);fs.writeFileSync(file,JSON.stringify(nodes));initBase(bindings,alias,file,undefined,{confirm:true});
  }
  const before={read:tree(f.readPath),write:tree(f.writePath)};
  for(const name of ['setup','init','migrate','unlock']) {
    const administrative=call('check',request('check',{}, {binding,context:{kind:'standalone',key:'fixture'},action:{kind:'command',namespace:'okf',name}}));
    assert.deepEqual(administrative.response.result,{status:'needs-configuration',problems:[{code:'provider-not-qualified',message:'check action is not an admitted knowledge operation'}]},name);
  }
  assert.deepEqual({read:tree(f.readPath),write:tree(f.writePath)},before,'administrative readiness checks mutate no accepted base');
  const checked=call('check',request('check',{}, {binding,context:{kind:'standalone',key:'fixture'},action:{kind:'spawn'}}));
  assert.equal(checked.status,0);assert.deepEqual(checked.response.result,{status:'ready',problems:[]});
  assert.deepEqual({read:tree(f.readPath),write:tree(f.writePath)},before,'check changes no accepted bytes');assert.equal(fs.existsSync(f.stateDir),false);

  const git=(args,cwd=f.readPath)=>{const result=spawnSync('git',['-C',cwd,...args],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);return result.stdout.trim();};
  git(['init','-q','--initial-branch=main']);git(['add','.']);git(['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','accepted']);
  const gitHome=join(f.root,'git-home'),scratch=join(f.root,'scratch'),bin=join(f.root,'bin');fs.mkdirSync(gitHome);fs.mkdirSync(scratch);fs.mkdirSync(bin);
  const ssh=join(bin,'ssh');fs.writeFileSync(ssh,`#!/usr/bin/env node\nconst {spawnSync}=require('node:child_process');\nconst result=spawnSync('git',['upload-pack',process.env.FIXTURE_GIT_REPO],{stdio:'inherit'});\nprocess.exit(result.status ?? 1);\n`);fs.chmodSync(ssh,0o755);
  const repository='git@example.test:knowledge.git';
  const gitBinding=structuredClone(binding);gitBinding.payload.stores['reference-base']={id:'reference-base',kind:'git',repository,root:'.',acceptedBranch:'main',pr:{repository:'example/knowledge'}};
  gitBinding.payload.runtime.bindings.bases['reference-base']=gitBinding.payload.stores['reference-base'];
  const remoteBefore=git(['rev-parse','HEAD']);
  const transport={HOME:gitHome,TMPDIR:scratch,PATH:`${bin}:${process.env.PATH}`,FIXTURE_GIT_REPO:f.readPath};
  const gitChecked=call('check',request('check',{}, {binding:gitBinding,context:{},action:{kind:'spawn'}}),transport);
  assert.equal(gitChecked.status,0,gitChecked.stderr);assert.deepEqual(gitChecked.response.result,{status:'ready',problems:[]});
  assert.equal(git(['rev-parse','HEAD']),remoteBefore);assert.deepEqual(fs.readdirSync(scratch),[],'private Git staging is removed after check');
  const wrongOwner=structuredClone(gitBinding);wrongOwner.payload.owns.push({store:'reference-base',node:'reference',steward:'expert-owner'});wrongOwner.payload.runtime.declaration.owns.push('reference-base/reference');
  const refused=call('check',request('check',{}, {binding:wrongOwner,context:{},action:{kind:'spawn'}}),transport);
  assert.deepEqual(refused.response.result,{status:'needs-configuration',problems:[{code:'provider-not-qualified',message:'knowledge base owner or remote custody requirement not met'}]});
  assert.equal(git(['rev-parse','HEAD']),remoteBefore);assert.deepEqual(fs.readdirSync(scratch),[],'failed Git qualification also removes private staging');

  const rewriteHome=join(f.root,'rewrite-home');fs.mkdirSync(rewriteHome);fs.writeFileSync(join(rewriteHome,'.gitconfig'),`[url "file://${f.readPath}"]\n\tinsteadOf = https://example.test/knowledge.git\n`);
  const rewritten=structuredClone(binding);rewritten.payload.stores['reference-base']={...gitBinding.payload.stores['reference-base'],repository:'https://example.test/knowledge.git'};rewritten.payload.runtime.bindings.bases['reference-base']=rewritten.payload.stores['reference-base'];
  const redirected=call('check',request('check',{}, {binding:rewritten,context:{},action:{kind:'spawn'}}),{HOME:rewriteHome,TMPDIR:scratch});
  assert.deepEqual(redirected.response.result,{status:'needs-configuration',problems:[{code:'provider-not-qualified',message:'knowledge base owner or remote custody requirement not met'}]},'rewritten effective Git origins do not qualify');
  assert.deepEqual(fs.readdirSync(scratch),[]);
});

test('captured harvest command and knowledge operation check refuse before store effects',t=>{
  const {f,binding}=prepareBinding(t),bindings=validateBindings(binding.payload.runtime.bindings,f.descriptorFile);
  for(const [alias,nodes] of [['reference-base',{reference:{path:'reference',owner:'reference-owner'}}],['private-base',{expert:{path:'expert',owner:'expert-owner'}}]]) {
    const file=join(f.root,`${alias}-nodes.json`);fs.writeFileSync(file,JSON.stringify(nodes));initBase(bindings,alias,file,undefined,{confirm:true});
  }
  const context={kind:'standalone',key:'fixture'};
  assert.deepEqual(call('check',request('check',{}, {binding,context,action:{kind:'inspect'}})).response.result,{status:'ready',problems:[]},'valid stores would otherwise qualify');
  const gitBinding=structuredClone(binding);
  const remote={id:'reference-base',kind:'git',repository:'git@example.invalid:knowledge.git',root:'.',acceptedBranch:'main',pr:{repository:'example/knowledge'}};
  gitBinding.payload.stores['reference-base']=remote;gitBinding.payload.runtime.bindings.bases['reference-base']=remote;
  const preload=noEffectsPreload(f.root),before=inventory(f.root);
  for(const capturedBinding of [binding,gitBinding]) for(const action of [
    {kind:'command',namespace:'okf',name:'harvest'},
    {kind:'command',capability:'oats.okf',name:'harvest'},
    {kind:'operation',slot:'knowledge',name:'harvest'},
  ]) {
    for(const withInvocation of [false,true]) {
      const input={binding:capturedBinding,context,action,...(withInvocation?{invocation:invocationFor({binding:capturedBinding,context,action})}:{})};
      const result=call('check',request('check',{},input),{TMPDIR:f.root,NODE_OPTIONS:`--import=${JSON.stringify(preload)}`});
      assert.equal(result.status,0,result.stdout+result.stderr);assert.equal(result.response.ok,true);
      assert.deepEqual(result.response.result,{status:'needs-configuration',problems:[{code:'provider-not-qualified',message:'check action is not an admitted knowledge operation'}]});
      assert.equal(result.stderr,'');assert.deepEqual(inventory(f.root),before,'no scratch, native Git, registration or scheduler effects');
    }
  }
});

test('OATS_BINDING_FILE loads one frozen provider envelope and never falls back',t=>{
  const {f,binding}=prepareBinding(t),snapshot=join(f.root,'invocation-binding.json');fs.writeFileSync(snapshot,canonical(binding),{mode:0o600});
  assert.deepEqual(loadInvocationKnowledgeBinding({}),{kind:'legacy'});
  const loaded=loadInvocationKnowledgeBinding({OATS_BINDING_FILE:snapshot});
  assert.equal(loaded.kind,'captured');assert.equal(loaded.runtime.bindings.stateDir,f.stateDir);assert.deepEqual(loaded.runtime.decl,binding.payload.runtime.declaration);

  for(const [name,value] of [
    ['relative','relative.json'],['missing',join(f.root,'missing.json')],
  ]) assert.throws(()=>loadInvocationKnowledgeBinding({OATS_BINDING_FILE:value}),error=>error.code==='E_BINDING',name);
  const wrong=structuredClone(binding);wrong.capability='other.provider';fs.writeFileSync(snapshot,canonical(wrong));
  assert.throws(()=>loadInvocationKnowledgeBinding({OATS_BINDING_FILE:snapshot}),{code:'E_BINDING'});
  fs.writeFileSync(snapshot,'{"schemaVersion":1,"schemaVersion":1}');assert.throws(()=>loadInvocationKnowledgeBinding({OATS_BINDING_FILE:snapshot}),{code:'E_BINDING'});
  fs.writeFileSync(snapshot,canonical(binding));const link=join(f.root,'binding-link.json');fs.symlinkSync(snapshot,link);
  assert.throws(()=>loadInvocationKnowledgeBinding({OATS_BINDING_FILE:link}),{code:'E_BINDING'});
  fs.chmodSync(snapshot,0o644);assert.throws(()=>loadInvocationKnowledgeBinding({OATS_BINDING_FILE:snapshot}),{code:'E_BINDING'});fs.chmodSync(snapshot,0o600);

  const oldBinding=process.env.OATS_BINDING_FILE,oldSettings=process.env.OATS_SETTINGS;
  t.after(()=>{if(oldBinding===undefined) delete process.env.OATS_BINDING_FILE;else process.env.OATS_BINDING_FILE=oldBinding;if(oldSettings===undefined) delete process.env.OATS_SETTINGS;else process.env.OATS_SETTINGS=oldSettings;});
  process.env.OATS_BINDING_FILE=snapshot;process.env.OATS_SETTINGS=JSON.stringify({'bindings-file':join(f.root,'poison-live.json'),'state-dir':join(f.root,'poison-state')});
  const home=join(f.root,'new-home');fs.mkdirSync(home);fs.writeFileSync(join(home,'instance.json'),JSON.stringify({instance:'fixture',agent:'fixture'}));
  assert.throws(()=>register(home),error=>error.code==='E_MIGRATION' && /fallback is forbidden/.test(error.message));
  assert.equal(fs.existsSync(f.stateDir),false);assert.equal(fs.existsSync(join(f.root,'poison-state')),false);

  const frozen=sourceRuntimeFromKnowledgeBinding(binding),id='00000000-0000-4000-8000-000000000001',sourceFile=join(f.stateDir,'sources',id,'source.json'),{file:bindingsFile,...bindingsDoc}=frozen.bindings;
  const checked=validateBindings(bindingsDoc,bindingsFile,{sourceHome:home,sourceWork:join(home,'work')});
  const descriptor={version:1,id,home,work:join(home,'work'),context:f.root,agent:'fixture',instance:'fixture',owner:frozen.owner,decl:frozen.decl,role:'fixture',bindings:{file:frozen.bindings.file,...checked},bindingFingerprint:bindingFingerprint(checked),execution:frozen.execution,providerBinding:binding,registration:{schemaVersion:1,kind:'captured'},sourceIdentity:{kind:'git-soul',repository:{kind:'canonical-remote',remote:'git:https://example.test/source.git'},exportPath:'agents/expert'},executionBinding:{schemaVersion:1,deployment:f.root,resolution:{schemaVersion:1,id:`sha256-${'c'.repeat(64)}`}},responsibleHuman:null};
  fs.mkdirSync(dirname(sourceFile),{recursive:true});fs.writeFileSync(sourceFile,JSON.stringify(descriptor));
  fs.rmSync(snapshot);delete process.env.OATS_BINDING_FILE;
  assert.equal(loadSource(sourceFile).owner,'expert-owner','frozen descriptor survives transient snapshot deletion');
  fs.writeFileSync(snapshot,canonical(binding),{mode:0o600});process.env.OATS_BINDING_FILE=snapshot;assert.equal(loadSource(sourceFile).id,id);
  const changed=structuredClone(binding);changed.payload.execution.model='other/model';fs.writeFileSync(snapshot,canonical(changed),{mode:0o600});
  assert.throws(()=>loadSource(sourceFile),error=>error.code==='E_SOURCE' && /differs from frozen source/.test(error.message));
});

test('wire is strict, bounded, duplicate-safe and returns typed nonsecret errors',t=>{
  const f=fixture(t),base=request('normalize',f.settings,{declarations:f.declarations,context:{}});
  for(const input of [
    Buffer.from('{"schemaVersion":1,"schemaVersion":1,"phase":"normalize","slot":"knowledge","capability":"oats.okf","settings":{},"input":{}}'),
    Buffer.from('{"schemaVersion":1} trailing'),
    Buffer.from([0xff,0xfe]),
    Buffer.alloc(1024*1024+1,0x20),
  ]) {
    const result=call('normalize',input);assert.equal(result.response.ok,false);assert.deepEqual(result.response.error,{code:'invalid-binding'});assert.equal(result.response.phase,'normalize');
  }
  const unknown=call('normalize',{...base,secret:'must-not-echo'});assert.equal(unknown.response.ok,false);assert.equal(unknown.response.error.code,'invalid-binding');assert.doesNotMatch(unknown.stdout,/must-not-echo/);
  const missing=call('normalize',request('normalize',{'bindings-file':f.descriptorFile},{declarations:f.declarations,context:{}}));assert.equal(missing.response.error.code,'needs-configuration');
  assert.throws(()=>parseBindingJson(Buffer.from('[[[[0]]]]'),{bytes:100,depth:3,entries:20}),{wireCode:'invalid-binding'});
});

test('check accepts optional full-subject invocation without changing scope checks or source receipts',t=>{
  const {binding}=prepareBinding(t),context={kind:'standalone',key:'fixture-context'},action={kind:'hook',capability:'oats.okf',name:'soul-scaffold'};
  const value=invocationFor({binding,context,action});
  for(const invocation of [value,{...value,subject:helperSubject(),instance:{...value.instance,agent:'helper'}}]) {
    const checked=call('check',request('check',{}, {binding,context,action,invocation}),{OATS_INVOCATION_CONTEXT_FILE:'/missing/must-not-read-context',OATS_SOURCE_RECEIPT_FILE:'/missing/must-not-read-source'});
    assert.equal(checked.status,0);assert.deepEqual(checked.response.result,{status:'ready',problems:[]});
  }
  assert.deepEqual(call('check',request('check',{}, {binding,context,action})).response.result,{status:'ready',problems:[]});
  for(const invocation of [null,{...value,capability:'oats.aweb'},{...value,context:{kind:'standalone',key:'wrong'}},{...value,action:{...action,name:'retire'}},{...value,subject:{kind:'helper',identity:null,alias:'helper'}},{...value,priorReceipt:'x'.repeat(128*1024)}]) {
    const checked=call('check',request('check',{}, {binding,context,action,invocation}));
    assert.equal(checked.status,0);assert.deepEqual(checked.response.error,{code:'invalid-binding'});
  }
});

test('shared binding maps keep only declared OKF addresses and ignore aweb siblings without effects or leaks',t=>{
  const f=fixture(t),preload=noEffectsPreload(f.root),before=inventory(f.root),env={TMPDIR:f.root,NODE_OPTIONS:`--import=${JSON.stringify(preload)}`};
  const store={id:'private-base',kind:'git',repository:'https://example.invalid/knowledge.git',root:'.',acceptedBranch:'main',pr:{repository:'example/knowledge'}};
  for(const name of ['stores.oats','stores.team.kb','write.default','custom.location']){
    const soul={kind:'soul',value:{knowledge:{contract,version:1,payload:{owner:'expert-owner',stores:{oats:{inherit:name}},reads:[],owns:[{node:'expert',destination:'oats'}]}}},origin:f.soulOrigin,origins:{}};
    const operator={kind:'operator',value:{bindings:{[name]:store}},origin:f.operatorOrigin,origins:{}};
    const base=request('normalize',f.settings,{declarations:[soul,operator],context:{kind:'standalone',key:'fixture'}}),control=call('normalize',base,env);
    assert.equal(control.response.ok,true);const key=bindingChoiceKey(name);
    const siblings={responsibleHuman:{provider:'oats.aweb',id:'SIBLING_PRIVATE_HUMAN'},privateTeam:{provider:'oats.aweb',id:'SIBLING_PRIVATE_TEAM:example.invalid'},wider:[],
      'stores.unrequested':'SIBLING_PRIVATE_NOT_A_LOCATOR','aweb/private~field':{opaque:'SIBLING_PRIVATE_VALUE'}};
    const shared=structuredClone(operator);Object.assign(shared.value.bindings,siblings);
    for(const declarations of [[soul,shared],[shared,soul]]){
      const result=call('normalize',{...base,input:{...base.input,declarations}},env);
      assert.equal(result.status,0,result.stderr);assert.equal(result.response.ok,true,result.stdout);assert.deepEqual(result.response.result,control.response.result);
      assert.deepEqual(result.response.result.candidates.map(c=>c.key),[key]);assert.doesNotMatch(result.stdout+result.stderr,/SIBLING_PRIVATE|responsibleHuman|privateTeam|stores\.unrequested/);
      // One explicitly selected unit choice, not a provider-owned resolver.
      const candidate=result.response.result.candidates[0],choices={[key]:selected(candidate.value,candidate.origin)};
      const bound=call('bind',request('bind',{}, {model:result.response.result.model,choices,context:base.input.context}),env);
      assert.equal(bound.response.ok,true,bound.stdout);assert.deepEqual(bound.response.result.payload.stores,{'private-base':store});assert.equal(bound.response.result.payload.owns[0].store,'private-base');
      assert.doesNotMatch(bound.stdout+bound.stderr,/SIBLING_PRIVATE|responsibleHuman|privateTeam|stores\.unrequested/);assert.deepEqual(inventory(f.root),before);
    }
    const bad=structuredClone(shared);bad.value.bindings[name]={...store,repository:'https://example.invalid/knowledge.git?token=OWN_PRIVATE_VALUE'};
    const refused=call('normalize',{...base,input:{...base.input,declarations:[soul,bad]}},env);assert.deepEqual(refused.response.error,{code:'invalid-binding'});assert.doesNotMatch(refused.stdout+refused.stderr,/OWN_PRIVATE|SIBLING_PRIVATE/);
    const absent=structuredClone(shared);delete absent.value.bindings[name];
    const missing=call('normalize',{...base,input:{...base.input,declarations:[soul,absent]}},env);assert.equal(missing.response.ok,true);assert.ok(missing.response.result.requirements.some(r=>r.key===key&&r.kind==='required'));
    assert.deepEqual(call('bind',request('bind',{}, {model:missing.response.result.model,choices:{},context:base.input.context}),env).response.error,{code:'needs-configuration'});
  }
  assert.deepEqual(inventory(f.root),before);
});

test('owned default/fixed/implicit-write candidates retain their provenance while unused shared values are excluded',t=>{
  const f=fixture(t),preload=noEffectsPreload(f.root),before=inventory(f.root),env={TMPDIR:f.root,NODE_OPTIONS:`--import=${JSON.stringify(preload)}`};
  const declarations=structuredClone(f.declarations),soul=declarations[0].value.knowledge.payload;
  // write.default is required by omitted ownership destination, not a stores.*
  // prefix. A declared default and fixed store also own their candidate addresses.
  delete soul.stores.destination;soul.stores.notes={default:locator('notes-base',join(f.root,'notes'))};soul.owns=[{node:'expert'}];
  for(const item of declarations.slice(1)){
    const values=item.kind==='workspace'?item.value.knowledge.stores[0].payload.bindings:item.value.bindings;
    values['stores.reference']=locator('reference-base',f.readPath);values['stores.notes']=locator(`${item.kind}-notes`,join(f.root,`${item.kind}-notes`));
    values.responsibleHuman={provider:'oats.aweb',id:'SIBLING_PRIVATE'};values['stores.unrequested']='SIBLING_PRIVATE';
  }
  const normalized=call('normalize',request('normalize',f.settings,{declarations,context:{}}),env);assert.equal(normalized.response.ok,true,normalized.stdout);
  const result=normalized.response.result;
  assert.ok(result.requirements.some(r=>r.key===bindingChoiceKey('write.default')&&r.kind==='required'));
  for(const key of [bindingChoiceKey('write.default'),storeChoiceKey('reference'),storeChoiceKey('notes')]){
    assert.deepEqual(result.candidates.filter(c=>c.key===key&&c.kind!=='soul-default').map(c=>[c.kind,c.origin.pointer]),[
      ['workspace-default','/knowledge'],['import-adoption','/adoption'],['operator','/bindings']]);
  }
  assert.equal(result.candidates[0].kind,'soul-default');assert.doesNotMatch(normalized.stdout+normalized.stderr,/SIBLING_PRIVATE|stores\.unrequested/);
  const bad=structuredClone(declarations);bad[3].value.bindings['stores.notes']={kind:'git',repository:'OWN_PRIVATE_VALUE'};
  const refused=call('normalize',request('normalize',f.settings,{declarations:bad,context:{}}),env);assert.deepEqual(refused.response.error,{code:'invalid-binding'});assert.doesNotMatch(refused.stdout+refused.stderr,/OWN_PRIVATE|SIBLING_PRIVATE/);
  const missing=call('normalize',request('normalize',{'harvest-runtime':'pi'},{declarations,context:{}}),env);
  assert.deepEqual(missing.response.error,{code:'needs-configuration',message:'setting bindings-file is required (absolute host path)'});
  assert.deepEqual(inventory(f.root),before);
});

test('normalize names missing or invalid runtime settings with fixed nonsecret messages and no effects',t=>{
  const f=fixture(t),preload=noEffectsPreload(f.root),before=inventory(f.root),secret='SYNTHETIC_PRIVATE_VALUE',env={TMPDIR:f.root,NODE_OPTIONS:`--import=${JSON.stringify(preload)}`};
  const cases=[
    ['bindings-file',undefined,'setting bindings-file is required (absolute host path)'],
    ['state-dir',undefined,'setting state-dir is required (absolute host path)'],
    ['bindings-file',secret,'setting bindings-file must be a normalized absolute host path'],
    ['state-dir',`/private/${secret}/../state`,'setting state-dir must be a normalized absolute host path'],
    ['state-dir',{[secret]:secret},'setting state-dir must be a normalized absolute host path'],
    ['harvest-runtime',undefined,'setting harvest-runtime is required (pi, claude or codex)'],
    ['harvest-runtime',secret,'setting harvest-runtime must be pi, claude or codex'],
    ['harvest-model',{[secret]:secret},'setting harvest-model must be null or a non-empty string'],
    ['harvest-model',' ','setting harvest-model must be null or a non-empty string'],
  ];
  for(const [name,value,message] of cases){
    const settings={...f.settings};if(value===undefined)delete settings[name];else settings[name]=value;
    const result=call('normalize',request('normalize',settings,{declarations:f.declarations,context:{kind:'standalone',key:'fixture'}}),env);
    assert.equal(result.status,0,result.stderr);assert.equal(result.response.ok,false);assert.deepEqual(result.response.error,{code:'needs-configuration',message});
    assert.equal(result.stderr,'');assert.doesNotMatch(result.stdout,new RegExp(`${secret}|${f.root}`));assert.deepEqual(inventory(f.root),before);
  }
  // Null/omitted model remains native-default intent; do not silently add a
  // required-model guard or change selected runtime/profile policy here.
  for(const value of [null,undefined]){const settings={...f.settings};if(value===undefined)delete settings['harvest-model'];else settings['harvest-model']=value;
    const result=call('normalize',request('normalize',settings,{declarations:f.declarations,context:{}}),env);assert.equal(result.response.ok,true);assert.equal(result.response.result.model.runtime.execution.model,null);}
  const unknown=call('normalize',request('normalize',{...f.settings,[secret]:secret},{declarations:f.declarations,context:{}}),env);
  assert.deepEqual(unknown.response.error,{code:'invalid-binding'});assert.doesNotMatch(unknown.stdout+unknown.stderr,new RegExp(secret));assert.deepEqual(inventory(f.root),before);
});

test('check diagnoses bound runtime constraints without using mutable settings or leaking values',t=>{
  const {f,binding}=prepareBinding(t),preload=noEffectsPreload(f.root),before=inventory(f.root),secret='SYNTHETIC_PRIVATE_VALUE',env={TMPDIR:f.root,NODE_OPTIONS:`--import=${JSON.stringify(preload)}`};
  const cases=[
    [b=>{delete b.payload.runtime.descriptorFile;},'setting bindings-file is required (absolute host path)'],
    [b=>{delete b.payload.runtime.bindings.stateDir;},'setting state-dir is required (absolute host path)'],
    [b=>{b.payload.runtime.descriptorFile=secret;},'setting bindings-file must be a normalized absolute host path'],
    [b=>{b.payload.runtime.bindings.stateDir=`/private/${secret}/../state`;},'setting state-dir must be a normalized absolute host path'],
    [b=>{delete b.payload.execution.runtime;},'setting harvest-runtime is required (pi, claude or codex)'],
    [b=>{b.payload.execution.runtime=secret;},'setting harvest-runtime must be pi, claude or codex'],
    [b=>{b.payload.execution.model={[secret]:secret};},'setting harvest-model must be null or a non-empty string'],
  ];
  for(const [change,message] of cases){const b=structuredClone(binding);change(b);
    const result=call('check',request('check',f.settings,{binding:b,context:{},action:{kind:'inspect'}}),env);
    assert.equal(result.status,0,result.stderr);assert.deepEqual(result.response.error,{code:'needs-configuration',message});
    assert.equal(result.stderr,'');assert.doesNotMatch(result.stdout,new RegExp(`${secret}|${f.root}`));assert.deepEqual(inventory(f.root),before);
  }
  const valid=call('check',request('check',{'bindings-file':secret,'state-dir':secret,'harvest-runtime':secret},{binding,context:{},action:{kind:'hook',capability:'oats.okf',name:'soul-scaffold'}}),env);
  assert.deepEqual(valid.response.result,{status:'ready',problems:[]},'bound settings, not mutable request settings, remain authoritative');
  for(const change of [b=>{b.payload.runtime[secret]=secret;},b=>{b.payload.runtime.bindings[secret]=secret;},b=>{b.payload.execution[secret]=secret;},b=>{delete b.payload.execution.model;},b=>{b.payload.runtime=null;}]){
    const b=structuredClone(binding);change(b);const result=call('check',request('check',{}, {binding:b,context:{},action:{kind:'inspect'}}),env);
    assert.deepEqual(result.response.error,{code:'invalid-binding'});assert.doesNotMatch(result.stdout+result.stderr,new RegExp(secret));
  }
  assert.deepEqual(inventory(f.root),before);
});

test('manifest owns all three binding phase commands',()=>{
  const manifest=JSON.parse(fs.readFileSync(join(ROOT,'oats-package/capabilities/oats-okf/oats.json'),'utf8'));
  const distribution=JSON.parse(fs.readFileSync(join(ROOT,'oats-package/oats-package.json'),'utf8'));
  assert.equal(manifest.compatibility.oats,'>=0.24.4');
  assert.equal(distribution.compatibility.oats,manifest.compatibility.oats);
  const {reasons,...phases}=manifest.binding;
  assert.deepEqual(phases,{version:1,normalize:'binding-normalize',bind:'binding-bind',check:'binding-check'});
  assert.equal(reasons.length,16);assert.equal(new Set(reasons).size,16);assert.ok(reasons.every(reason=>typeof reason==='string'&&reason.length>0));
  // Every check-phase reason the wire can emit is in the manifest byte-exact —
  // the kernel may only pass literals it was told about.
  for(const reason of CHECK_REASONS) assert.ok(reasons.includes(reason),`manifest lacks check reason: ${reason}`);
  assert.ok(reasons.every(r=>!/:\/\/|^\/|\s\/|\$\{|\{\{/.test(r) && r.length<=120),'reasons carry no URLs, paths, values or templates');
  for(const name of Object.values(manifest.binding).filter(value=>typeof value==='string')) assert.ok(Object.hasOwn(manifest.commands,name));
  assert.equal(manifest.settings['state-dir'].default,undefined);
});
