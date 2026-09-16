import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { bindingChoiceKey, storeChoiceKey } from '../oats-package/capabilities/oats-okf/lib/portable-binding.mjs';
import { parseBindingJson, sourceRuntimeFromKnowledgeBinding } from '../oats-package/capabilities/oats-okf/lib/binding-wire.mjs';
import { validateBindings } from '../oats-package/capabilities/oats-okf/lib/config.mjs';
import { initBase } from '../oats-package/capabilities/oats-okf/lib/migration.mjs';
import { tree } from '../oats-package/capabilities/oats-okf/lib/io.mjs';

const ROOT=fileURLToPath(new URL('../',import.meta.url));
const CLI=join(ROOT,'oats-package/capabilities/oats-okf/bin/oats-okf-binding.mjs');
const contract='oats.okf.locations';
const origin=(kind,pointer)=>({kind,document:{kind:'source',source:'git:https://example.test/source.git',revision:'a'.repeat(40),path:'soul.yaml',integrity:{format:'oats.bytes.v1',value:`sha256-${'b'.repeat(64)}`}},pointer});
const locator=(id,path)=>({id,kind:'directory',path:`path:${path}`});
const canonical=value=>value===null || typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?`[${value.map(canonical).join(',')}]`:`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
const call=(phase,request,env={})=>{
  const bytes=Buffer.isBuffer(request)?request:typeof request==='string'?request:JSON.stringify(request);
  const result=spawnSync(process.execPath,[CLI,phase],{input:bytes,encoding:Buffer.isBuffer(bytes)?undefined:'utf8',maxBuffer:2*1024*1024,env:{...process.env,...env}});
  const stdout=Buffer.isBuffer(result.stdout)?result.stdout.toString('utf8'):result.stdout;
  return {...result,stdout,response:JSON.parse(stdout)};
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
});

test('check validates real directory and private-staged Git acceptance read-only',t=>{
  const {f,binding}=prepareBinding(t),bindings=validateBindings(binding.payload.runtime.bindings,f.descriptorFile);
  for(const [alias,nodes] of [['reference-base',{reference:{path:'reference',owner:'reference-owner'}}],['private-base',{expert:{path:'expert',owner:'expert-owner'}}]]) {
    const file=join(f.root,`${alias}-nodes.json`);fs.writeFileSync(file,JSON.stringify(nodes));initBase(bindings,alias,file,undefined,{confirm:true});
  }
  const before={read:tree(f.readPath),write:tree(f.writePath)};
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
  assert.deepEqual(refused.response.result,{status:'needs-configuration',problems:[{code:'provider-not-qualified'}]});
  assert.equal(git(['rev-parse','HEAD']),remoteBefore);assert.deepEqual(fs.readdirSync(scratch),[],'failed Git qualification also removes private staging');

  const rewriteHome=join(f.root,'rewrite-home');fs.mkdirSync(rewriteHome);fs.writeFileSync(join(rewriteHome,'.gitconfig'),`[url "file://${f.readPath}"]\n\tinsteadOf = https://example.test/knowledge.git\n`);
  const rewritten=structuredClone(binding);rewritten.payload.stores['reference-base']={...gitBinding.payload.stores['reference-base'],repository:'https://example.test/knowledge.git'};rewritten.payload.runtime.bindings.bases['reference-base']=rewritten.payload.stores['reference-base'];
  const redirected=call('check',request('check',{}, {binding:rewritten,context:{},action:{kind:'spawn'}}),{HOME:rewriteHome,TMPDIR:scratch});
  assert.deepEqual(redirected.response.result,{status:'needs-configuration',problems:[{code:'provider-not-qualified'}]},'rewritten effective Git origins do not qualify');
  assert.deepEqual(fs.readdirSync(scratch),[]);
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

test('manifest owns all three binding phase commands',()=>{
  const manifest=JSON.parse(fs.readFileSync(join(ROOT,'oats-package/capabilities/oats-okf/oats.json'),'utf8'));
  assert.deepEqual(manifest.binding,{version:1,normalize:'binding-normalize',bind:'binding-bind',check:'binding-check'});
  for(const name of Object.values(manifest.binding).filter(value=>typeof value==='string')) assert.ok(Object.hasOwn(manifest.commands,name));
  assert.equal(manifest.settings['state-dir'].default,undefined);
});
