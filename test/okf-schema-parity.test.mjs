import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateBindings, validateDeclaration, metadata, settings } from '../oats-package/capabilities/oats-okf/lib/config.mjs';
import { normalizeKnowledgeDeclaration } from '../oats-package/capabilities/oats-okf/lib/portable-binding.mjs';
import { sourceRuntimeFromKnowledgeBinding } from '../oats-package/capabilities/oats-okf/lib/binding-wire.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const capability=join(root,'oats-package',JSON.parse(fs.readFileSync(join(root,'oats-package/oats-package.json'),'utf8')).capabilities[0]);
const schemas=Object.fromEntries(['bindings','soul','base','portable-declaration','portable-payload'].map(name=>[name,JSON.parse(fs.readFileSync(join(capability,`schemas/okf-${name}.schema.json`),'utf8'))]));
// Exercise the actual shipped constraints, not copies of their property lists.
// Refuse unsupported keywords so extending a schema cannot make this checker
// silently skip validation. Filesystem/custody checks remain runtime-only.
function conforms(value,schema,rootSchema=schema) {
  const supported=['$schema','$id','$defs','$ref','title','type','required','properties','additionalProperties','propertyNames','oneOf','const','pattern','minLength','minProperties','minItems','items','uniqueItems','default','description'];
  for(const key of Object.keys(schema)) assert.ok(supported.includes(key),`unimplemented schema keyword: ${key}`);
  if(schema.$ref) {
    const parts=schema.$ref.match(/^#\/\$defs\/([^/]+)$/);assert.ok(parts,`unsupported schema ref: ${schema.$ref}`);
    return conforms(value,rootSchema.$defs[parts[1]],rootSchema);
  }
  if(Object.hasOwn(schema,'const') && value!==schema.const) return false;
  const type=Array.isArray(value)?'array':value===null?'null':typeof value;
  if(schema.type && schema.type!==type) return false;
  if(schema.oneOf && schema.oneOf.filter(s=>conforms(value,s,rootSchema)).length!==1) return false;
  if(type==='string' && ((schema.minLength!==undefined && value.length<schema.minLength) || (schema.pattern && !new RegExp(schema.pattern).test(value)))) return false;
  if(type==='array') {
    if(schema.minItems!==undefined && value.length<schema.minItems) return false;
    if(schema.uniqueItems && new Set(value.map(v=>JSON.stringify(v))).size!==value.length) return false;
    if(schema.items && !value.every(v=>conforms(v,schema.items,rootSchema))) return false;
  }
  if(type==='object') {
    if(schema.minProperties!==undefined && Object.keys(value).length<schema.minProperties) return false;
    if((schema.required || []).some(k=>!Object.hasOwn(value,k))) return false;
    for(const [key,v] of Object.entries(value)) {
      if(schema.propertyNames && !conforms(key,schema.propertyNames,rootSchema)) return false;
      if(Object.hasOwn(schema.properties || {},key)) {if(!conforms(v,schema.properties[key],rootSchema)) return false;}
      else if(schema.additionalProperties===false) return false;
      else if(typeof schema.additionalProperties==='object' && !conforms(v,schema.additionalProperties,rootSchema)) return false;
    }
  }
  return true;
}
const b64=v=>Buffer.from(v).toString('base64');
function baseFiles(doc) {
  const files={'okf-base.json':b64(JSON.stringify(doc)),'index.md':b64('# Base\n'),'log.md':b64('# History\n')};
  for(const spec of Object.values(doc.nodes || {})) {
    files[`${spec.path}/index.md`]=b64('# Node\n');files[`${spec.path}/log.md`]=b64('# History\n');
  }
  return files;
}
const directory={id:'base-1',kind:'directory',path:'accepted'};
const git={id:'base-1',kind:'git',repository:'https://github.com/example/knowledge.git',root:'.',acceptedBranch:'main',pr:{repository:'example/knowledge'}};
const bindings=base=>({version:1,stateDir:'state',bases:{project:base},cron:'*/15 * * * *',tz:'UTC'});
const soul={version:1,owner:'owner-1',owns:['project/expert'],reads:['project/expert']};
const base={version:1,id:'base-1',nodes:{expert:{path:'expert',owner:'owner-1'}}};

test('R1 OKF root and exported schema bytes are identical',()=>{
  for(const name of Object.keys(schemas)) assert.equal(fs.readFileSync(join(root,`schemas/okf-${name}.schema.json`),'utf8'),fs.readFileSync(join(capability,`schemas/okf-${name}.schema.json`),'utf8'));
});
test('R1 configuration runtime and shipped schemas agree on accepted keys and malformed shapes',t=>{
  const dir=fs.realpathSync(fs.mkdtempSync(join(tmpdir(),'okf-schema-')));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const run={bindings:v=>validateBindings(v,join(dir,'bindings.json')),soul:validateDeclaration,base:v=>metadata(baseFiles(v),{id:'base-1'})};
  const cases=[['bindings',bindings(directory)],['bindings',bindings(git)],['soul',soul],['base',base]];
  const expect=(kind,doc,valid,label)=>{
    assert.equal(conforms(doc,schemas[kind]),valid,`${kind} schema: ${label}`);
    if(valid) assert.doesNotThrow(()=>run[kind](doc),`${kind} runtime: ${label}`);
    else assert.throws(()=>run[kind](doc),`${kind} runtime: ${label}`);
  };
  for(const [kind,doc] of cases) {
    expect(kind,doc,true,'valid');
    expect(kind,{...doc,typo:'ignored?'},false,'unknown root key');
    for(const key of schemas[kind].required) {const bad=structuredClone(doc);delete bad[key];expect(kind,bad,false,`missing ${key}`);}
  }
  for(const base of [directory,git]) {
    expect('bindings',bindings({...base,acceptedbranch:'typo'}),false,'unknown base key');
    expect('bindings',bindings({...base,id:'constructor'}),false,'reserved base id');
    expect('bindings',{...bindings(base),bases:{constructor:base}},false,'reserved alias');
  }
  expect('bindings',bindings({...git,pr:{...git.pr,branch:'typo'}}),false,'unknown PR key');
  expect('bindings',bindings({...directory,path:''}),false,'empty directory path');
  expect('bindings',{...bindings(directory),stateDir:''},false,'empty stateDir');
  for(const key of ['cron','tz']) for(const value of [null,0,false,[],{},'','  ']) expect('bindings',{...bindings(directory),[key]:value},false,`invalid ${key}`);
  expect('base',{...base,nodes:{expert:{...base.nodes.expert,readiness:'typo'}}},false,'unknown node key');
  for(const kind of ['soul','base']) expect(kind,{...(kind==='soul'?soul:base),[kind==='soul'?'owner':'id']:'valueOf'},false,'reserved identity');
  for(const ref of ['project/constructor','constructor/expert',`${'a'.repeat(97)}/expert`,`project/${'n'.repeat(97)}`]) expect('soul',{...soul,owns:[ref]},false,'invalid node reference');
  expect('soul',{...soul,reads:['project/expert','project/expert']},false,'duplicate reads');
  expect('base',{...base,nodes:{}},false,'empty nodes');
});
test('portable declaration and effective payload schemas match provider codecs and examples',()=>{
  const normalize=JSON.parse(fs.readFileSync(join(root,'examples/portable-binding/normalize-request.json'),'utf8'));
  const declaration=normalize.input.declarations.find(entry=>entry.kind==='soul').value.knowledge;
  const binding=JSON.parse(fs.readFileSync(join(root,'examples/portable-binding/provider-binding.json'),'utf8'));
  assert.equal(conforms(declaration,schemas['portable-declaration']),true);assert.doesNotThrow(()=>normalizeKnowledgeDeclaration(declaration,{origin:normalize.input.declarations[0].origin}));
  assert.equal(conforms(binding.payload,schemas['portable-payload']),true);assert.doesNotThrow(()=>sourceRuntimeFromKnowledgeBinding(binding));

  const unknown=structuredClone(declaration);unknown.payload.typo=true;assert.equal(conforms(unknown,schemas['portable-declaration']),false);assert.throws(()=>normalizeKnowledgeDeclaration(unknown,{origin:normalize.input.declarations[0].origin}));
  const duplicate=structuredClone(declaration);duplicate.payload.reads.push(structuredClone(duplicate.payload.reads[0]));assert.equal(conforms(duplicate,schemas['portable-declaration']),false);assert.throws(()=>normalizeKnowledgeDeclaration(duplicate,{origin:normalize.input.declarations[0].origin}));
  const changed=structuredClone(binding);changed.payload.runtime.declaration.owner='another-owner';assert.equal(conforms(changed.payload,schemas['portable-payload']),true,'schema covers shape; cross-field identity remains runtime custody');assert.throws(()=>sourceRuntimeFromKnowledgeBinding(changed));
  changed.payload.typo=true;assert.equal(conforms(changed.payload,schemas['portable-payload']),false);assert.throws(()=>sourceRuntimeFromKnowledgeBinding(changed));
});

test('portable Git schemas reject credential userinfo, query and fragment fields',()=>{
  for(const schema of [schemas['portable-declaration'],schemas['portable-payload']]) {
    for(const repository of ['https://user:SECRET@example.invalid/kb.git','ssh://git:SECRET@example.invalid/kb.git','https://example.invalid/kb.git?token=SECRET','ssh://git@example.invalid/kb.git#SECRET','git@example.invalid:kb.git?token=SECRET']) assert.equal(conforms({...git,repository},schema.$defs.git,schema),false);
    assert.equal(conforms({...git,repository:'ssh://deploy_user@example.invalid/kb.git'},schema.$defs.git,schema),true);
  }
});

test('R1 settings reject unknown properties using the exported manifest setting names',t=>{
  const prior=process.env.OATS_SETTINGS;t.after(()=>{if(prior===undefined) delete process.env.OATS_SETTINGS;else process.env.OATS_SETTINGS=prior;});
  const manifest=JSON.parse(fs.readFileSync(join(capability,'oats.json'),'utf8'));
  const valid={'bindings-file':'/fixture/bindings.json','state-dir':'/fixture/state','harvest-runtime':'pi','harvest-model':'fixture/model','git-timeout':600,'consult-max-age':300};
  assert.deepEqual(Object.keys(valid).sort(),Object.keys(manifest.settings).sort());
  process.env.OATS_SETTINGS=JSON.stringify(valid);assert.deepEqual(settings(),valid);
  for(const bad of [{...valid,'harvest-modle':'typo'},{...valid,'harvest-runtime':'unknown'},{...valid,'harvest-model':42}]) {process.env.OATS_SETTINGS=JSON.stringify(bad);assert.throws(()=>settings());}
});
