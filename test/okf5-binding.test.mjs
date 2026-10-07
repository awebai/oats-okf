import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleBindingRequest, runBindingWire, sourceRuntimeFromKnowledgeBinding, CHECK_REASONS } from '../oats-package/capabilities/oats-okf/lib/binding-wire.mjs';
import { initBase } from '../oats-package/capabilities/oats-okf/lib/migration.mjs';
import { loadBindings } from '../oats-package/capabilities/oats-okf/lib/config.mjs';
// oats.okf 5.0.0 provider binding wire: payloadVersion 2 (no `execution`),
// a payloadVersion 1 binding is E_REMOVED, and a forwarded 4.x harvest
// setting answers needs-configuration with the rendered E_REMOVED sentence.
const ROOT=fileURLToPath(new URL('../',import.meta.url));
const CAP=join(ROOT,'oats-package/capabilities/oats-okf');
const manifest=JSON.parse(fs.readFileSync(join(CAP,'oats.json'),'utf8'));
const SETTING_REASONS=[
  'setting bindings-file is required (absolute host path)',
  'setting bindings-file must be a normalized absolute host path',
  'setting state-dir is required (absolute host path)',
  'setting state-dir must be a normalized absolute host path',
];
const HOST_ORIGINS=JSON.stringify({'/harvest':{kind:'host',at:'oats-local.yaml#/settings/oats.okf'}});
const BF='/srv/oats/test/okf-bindings.json',SD='/srv/oats/test/state';
const ORIGIN={kind:'soul-requirement',pointer:'/knowledge'};
const req=(phase,settings,input)=>({schemaVersion:1,phase,slot:'knowledge',capability:'oats.okf',settings,input});
const soulDeclaration=()=>({kind:'soul',origin:ORIGIN,origins:{},value:{knowledge:{contract:'oats.okf.locations',version:1,payload:{
  owner:'owner-1',stores:{project:{fixed:{id:'base-1',kind:'directory',path:'path:/srv/oats/test/base'}}},
  reads:[{store:'project',node:'peer'}],owns:[{node:'expert',destination:'project'}]}}}});
const normalizeRequest=(settings={'bindings-file':BF,'state-dir':SD})=>req('normalize',settings,{declarations:[soulDeclaration()],context:{kind:'standalone',key:'t'}});
/** The kernel's part, reduced: every requirement's value is the choice. */
async function bound() {
  const normalized=await handleBindingRequest('normalize',normalizeRequest());
  const choices=Object.fromEntries(normalized.requirements.filter(r=>r.value).map(r=>[r.key,{value:r.value,selectedBy:r.origin,constraints:[],considered:[]}]));
  const result=await handleBindingRequest('bind',req('bind',{'bindings-file':BF,'state-dir':SD},{model:normalized.model,choices,context:{kind:'standalone',key:'t'}}));
  return {schemaVersion:1,capability:'oats.okf',...result};
}
function withEnv(t,values) {
  const saved=Object.fromEntries(Object.keys(values).map(k=>[k,process.env[k]]));
  Object.assign(process.env,values);
  t.after(()=>{for(const [k,v] of Object.entries(saved)) if(v===undefined) delete process.env[k]; else process.env[k]=v;});
}
async function wire(phase,request) {
  let text='';
  await runBindingWire(phase,[Buffer.from(JSON.stringify(request))],{write:b=>{text+=b.toString();}});
  return JSON.parse(text);
}
/** A real directory base and soul, for the check phase. Its alias (project)
 *  differs from its id (base-1), as in a usual bindings file: the declared-node
 *  check resolves by the bindings' own aliases. */
function deployment(t) {
  const dir=fs.realpathSync(fs.mkdtempSync(join(tmpdir(),'okf5-binding-')));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const bindingsFile=join(dir,'deployment','okf-bindings.json'),soul=join(dir,'soul'),nodes=join(dir,'nodes.json');
  fs.mkdirSync(dirname(bindingsFile),{recursive:true});fs.mkdirSync(soul);
  fs.writeFileSync(nodes,JSON.stringify({expert:{path:'expert',owner:'owner-1'},peer:{path:'peer',owner:'owner-2'}}));
  fs.writeFileSync(bindingsFile,JSON.stringify({version:1,stateDir:join(dir,'state'),bases:{project:{id:'base-1',kind:'directory',path:join(dir,'bases','project')}}}));
  initBase(loadBindings(bindingsFile),'project',nodes,undefined,{confirm:true});
  fs.writeFileSync(join(soul,'okf.json'),JSON.stringify({version:1,owner:'owner-1',owns:['project/expert'],reads:['project/peer']}));
  return {bindingsFile,soul};
}
const checkInput={context:{kind:'standalone',key:'t'},action:{kind:'hook',name:'spawn'}};

test('normalize then bind a soul declaration yields payloadVersion 2 without execution',async()=>{
  const binding=await bound();
  assert.equal(binding.payloadContract,'oats.okf.locations');
  assert.equal(binding.payloadVersion,2);
  assert.deepEqual(Object.keys(binding.payload).sort(),['owner','owns','reads','runtime','stores']);
  assert.equal(Object.hasOwn(binding.payload,'execution'),false);
  assert.deepEqual(binding.payload.runtime.declaration,{version:1,owner:'owner-1',reads:['base-1/peer'],owns:['base-1/expert']});
  assert.deepEqual(binding.credentialRefs,{});
});

test('sourceRuntimeFromKnowledgeBinding projects a bound payload',async()=>{
  const runtime=sourceRuntimeFromKnowledgeBinding(await bound());
  assert.equal(runtime.owner,'owner-1');
  assert.deepEqual(runtime.bindings,{file:BF,version:1,stateDir:SD,bases:{'base-1':{id:'base-1',kind:'directory',path:'/srv/oats/test/base'}}});
  assert.deepEqual([runtime.decl.owns,runtime.decl.reads],[['base-1/expert'],['base-1/peer']]);
});

test('a payloadVersion 1 binding is E_REMOVED',async()=>{
  const v1={...await bound(),payloadVersion:1};
  assert.throws(()=>sourceRuntimeFromKnowledgeBinding(v1),{code:'E_REMOVED'});
});

test('check with valid settings for a directory base is ready',async t=>{
  const d=deployment(t);
  withEnv(t,{OATS_SOUL:d.soul});
  const result=await handleBindingRequest('check',req('check',{'bindings-file':d.bindingsFile},checkInput));
  assert.deepEqual(result,{status:'ready',problems:[]});
});

test('check with a v1 binding as settings needs configuration (binding:v1-removed)',async()=>{
  const v1={...await bound(),payloadVersion:1};
  const result=await handleBindingRequest('check',req('check',v1,checkInput));
  assert.equal(result.status,'needs-configuration');
  assert.equal(result.problems.length,1);
  assert.equal(result.problems[0].code,'needs-configuration');
  assert.match(result.problems[0].message,/^E_REMOVED: OKF binding payloadVersion 1 \(harvest runtime\/model\) was removed in oats\.okf 5\.0/);
  assert.ok(manifest.binding.reasons.includes(result.problems[0].message));
});

test('normalize with a host harvest setting needs configuration with the E_REMOVED sentence',async t=>{
  withEnv(t,{OATS_SETTINGS_ORIGINS:HOST_ORIGINS});
  const answer=await wire('normalize',normalizeRequest({'bindings-file':BF,'state-dir':SD,harvest:'on'}));
  assert.equal(answer.ok,false);
  assert.equal(answer.error.code,'needs-configuration');
  assert.ok(answer.error.message.startsWith('E_REMOVED: settings.oats.okf.harvest from host (oats-local.yaml#/settings/oats.okf) was removed in oats.okf 5.0;'),answer.error.message);
  assert.ok(answer.error.message.includes('oats okf setup --remove-legacy-settings --soul <soul> --json'));
});

test('check with a host harvest setting needs configuration with the E_REMOVED sentence',async t=>{
  withEnv(t,{OATS_SETTINGS_ORIGINS:HOST_ORIGINS});
  const result=await handleBindingRequest('check',req('check',{'bindings-file':BF,harvest:'on'},checkInput));
  assert.equal(result.status,'needs-configuration');
  assert.equal(result.problems[0].code,'needs-configuration');
  assert.ok(result.problems[0].message.startsWith('E_REMOVED: settings.oats.okf.harvest from host'),result.problems[0].message);
});

// test/fixtures/okf4-instance-record.json: what a home spawned under 4.x replays.
const OKF4_ORIGINS=JSON.stringify(JSON.parse(fs.readFileSync(join(ROOT,'test/fixtures/okf4-instance-record.json'),'utf8')).capabilities[0].settingsOrigins);
const OKF4_DEFAULTS={harvest:'off','harvest-runtime':'pi'};

test('normalize and check ignore a 4.x home\'s manifest-default harvest off / harvest-runtime pi (never a 5.0 setting)',async t=>{
  const d=deployment(t);
  withEnv(t,{OATS_SOUL:d.soul,OATS_SETTINGS_ORIGINS:OKF4_ORIGINS});
  const normalized=await handleBindingRequest('normalize',normalizeRequest({'bindings-file':BF,'state-dir':SD,...OKF4_DEFAULTS}));
  assert.deepEqual(normalized.model.runtime,{descriptorFile:BF,stateDir:SD},'the effective runtime carries no harvest key');
  const result=await handleBindingRequest('check',req('check',{'bindings-file':d.bindingsFile,...OKF4_DEFAULTS},checkInput));
  assert.deepEqual(result,{status:'ready',problems:[]});
});

test('oats.json binding.reasons pins the setting literals and CHECK_REASONS byte-exact',()=>{
  assert.deepEqual(manifest.binding.reasons,[...SETTING_REASONS,...CHECK_REASONS]);
  assert.equal(manifest.binding.reasons.length,24);
  assert.equal(new Set(manifest.binding.reasons).size,24);
});

test('the portable payload schema requires the five keys and has no execution',()=>{
  const schema=JSON.parse(fs.readFileSync(join(CAP,'schemas','okf-portable-payload.schema.json'),'utf8'));
  assert.deepEqual([...schema.required].sort(),['owner','owns','reads','runtime','stores']);
  assert.deepEqual(Object.keys(schema.properties).sort(),['owner','owns','reads','runtime','stores']);
  assert.equal(schema.additionalProperties,false);
  assert.doesNotMatch(JSON.stringify(schema),/execution/);
});
