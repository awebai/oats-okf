import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { bindingChoiceKey, storeChoiceKey } from '../oats-package/capabilities/oats-okf/lib/portable-binding.mjs';
import { parseBindingJson } from '../oats-package/capabilities/oats-okf/lib/binding-wire.mjs';
import { validateBindings } from '../oats-package/capabilities/oats-okf/lib/config.mjs';
import { initBase } from '../oats-package/capabilities/oats-okf/lib/migration.mjs';
import { tree } from '../oats-package/capabilities/oats-okf/lib/io.mjs';

const ROOT=fileURLToPath(new URL('../',import.meta.url));
const CLI=join(ROOT,'oats-package/capabilities/oats-okf/bin/oats-okf-binding.mjs');
const contract='oats.okf.locations';
const origin=(kind,pointer)=>({kind,document:{kind:'source',source:'git:https://example.test/source.git',revision:'a'.repeat(40),path:'soul.yaml',integrity:{format:'oats.bytes.v1',value:`sha256-${'b'.repeat(64)}`}},pointer});
const locator=(id,path)=>({id,kind:'directory',path:`path:${path}`});
const call=(phase,request)=>{
  const result=spawnSync(process.execPath,[CLI,phase],{input:Buffer.isBuffer(request)?request:JSON.stringify(request),encoding:Buffer.isBuffer(request)?undefined:'utf8',maxBuffer:2*1024*1024});
  const stdout=Buffer.isBuffer(result.stdout)?result.stdout.toString('utf8'):result.stdout;
  return {...result,stdout,response:JSON.parse(stdout)};
};
const request=(phase,settings,input)=>({schemaVersion:1,phase,slot:'knowledge',capability:'oats.okf',settings,input});
function selected(value,selectedBy) {return {value,selectedBy,constraints:[],considered:[{kind:selectedBy.kind,value,origin:selectedBy,disposition:'selected'}]};}
function fixture(t) {
  const root=fs.mkdtempSync(join(fs.realpathSync(tmpdir()),'okf-binding-wire-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const descriptorFile=join(root,'host','bindings.json'),stateDir=join(root,'state'),readPath=join(root,'read'),writePath=join(root,'write');
  fs.mkdirSync(dirname(descriptorFile),{recursive:true});
  const settings={'bindings-file':descriptorFile,'state-dir':stateDir};
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
  assert.deepEqual(normalized.candidates.map(({key,kind})=>[key,kind]),[
    [bindingChoiceKey('write.default'),'workspace-default'],[bindingChoiceKey('write.default'),'import-adoption'],[bindingChoiceKey('write.default'),'operator'],
  ]);
  assert.equal(bound.payloadContract,contract);assert.equal(bound.payloadVersion,1);assert.deepEqual(bound.credentialRefs,{});
  assert.deepEqual(bound.payload.runtime.bindings,{version:1,stateDir:f.stateDir,bases:{
    'reference-base':{id:'reference-base',kind:'directory',path:f.readPath},
    'private-base':{id:'private-base',kind:'directory',path:f.writePath},
  }});
  assert.deepEqual(bound.payload.runtime.declaration,{version:1,owner:'expert-owner',reads:['reference-base/reference'],owns:['private-base/expert']});
});

test('check validates real directory acceptance read-only and refuses unsupported Git qualification',t=>{
  const {f,binding}=prepareBinding(t),bindings=validateBindings(binding.payload.runtime.bindings,f.descriptorFile);
  for(const [alias,nodes] of [['reference-base',{reference:{path:'reference',owner:'reference-owner'}}],['private-base',{expert:{path:'expert',owner:'expert-owner'}}]]) {
    const file=join(f.root,`${alias}-nodes.json`);fs.writeFileSync(file,JSON.stringify(nodes));initBase(bindings,alias,file,undefined,{confirm:true});
  }
  const before={read:tree(f.readPath),write:tree(f.writePath)};
  const checked=call('check',request('check',{}, {binding,context:{kind:'standalone',key:'fixture'},action:{kind:'spawn'}}));
  assert.equal(checked.status,0);assert.deepEqual(checked.response.result,{status:'ready',problems:[]});
  assert.deepEqual({read:tree(f.readPath),write:tree(f.writePath)},before,'check changes no accepted bytes');assert.equal(fs.existsSync(f.stateDir),false);

  const gitBinding=structuredClone(binding);gitBinding.payload.stores['reference-base']={id:'reference-base',kind:'git',repository:'https://example.test/knowledge.git',root:'knowledge',acceptedBranch:'main',pr:{repository:'example/knowledge'}};
  gitBinding.payload.runtime.bindings.bases['reference-base']=gitBinding.payload.stores['reference-base'];
  const unavailable=call('check',request('check',{}, {binding:gitBinding,context:{},action:{kind:'spawn'}}));
  assert.equal(unavailable.response.ok,true);assert.deepEqual(unavailable.response.result,{status:'unavailable',problems:[{code:'provider-not-qualified'}]});
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
