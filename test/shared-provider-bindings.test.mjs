// Explicit-source pure wire/solver coupling, NOT kernel admission, package
// acquisition, remote readiness or a real operator/private-team fixture.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {inventory,noEffectsPreload} from './helpers/no-effects.mjs';
const ownCap=fileURLToPath(new URL('../oats-package/capabilities/oats-okf/',import.meta.url));
test('actual OKF and aweb codecs consume one shared map through the sole kernel resolver',async t=>{
  const framework=process.env.OATS_OKF_FRAMEWORK_ROOT,aweb=process.env.OATS_OKF_AWEB_CAPABILITY_ROOT;
  if(!framework||!aweb){t.skip('requires explicitly pinned framework and aweb capability sources');return;}
  const {resolveChoices}=await import(pathToFileURL(join(framework,'lib/portable-choices.mjs')));
  const {decodeBindingResponse,bindingField}=await import(pathToFileURL(join(framework,'lib/provider-binding-wire.mjs')));
  const {bindingDeclaration,operatorBindingDeclaration}=await import(pathToFileURL(join(framework,'lib/prepared-bindings.mjs')));
  const {parsePortableSoul}=await import(pathToFileURL(join(framework,'lib/portable-soul.mjs')));
  const {bytesIntegrity}=await import(pathToFileURL(join(framework,'lib/portable-digest.mjs')));
  const root=fs.realpathSync(fs.mkdtempSync(join(tmpdir(),'okf-aweb-shared-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const preload=noEffectsPreload(root),before=inventory(root),env={HOME:root,PATH:'',TMPDIR:root,NODE_OPTIONS:`--import=${JSON.stringify(preload)}`};
  const bytes=Buffer.from(JSON.stringify({schemaVersion:1,name:'expert',teams:[],knowledge:{contract:'oats.okf.locations',version:1,payload:{owner:'fixture-owner',stores:{oats:{inherit:'stores.oats'}},reads:[],owns:[{node:'expert',destination:'oats'}]}}}));
  const soul=parsePortableSoul(bytes,{origin:{kind:'source',source:'git:https://example.invalid/source.git',revision:'a'.repeat(40),path:'souls/expert/soul.yaml',integrity:bytesIntegrity(bytes)}});
  const store={id:'fixture-kb',kind:'git',repository:'https://example.invalid/knowledge.git',root:'.',acceptedBranch:'main',pr:{repository:'example/knowledge'}};
  const operator={policy:{},document:{kind:'operator',id:'fixture-input'},bindings:{'stores.oats':store,responsibleHuman:{provider:'oats.aweb',id:'fixture-human'},privateTeam:{provider:'oats.aweb',id:'private:example.invalid'},wider:[]}};
  const context={kind:'standalone',key:'explicit-fixture'},declarations=[bindingDeclaration('soul',soul.declaration,soul.origins),operatorBindingDeclaration(operator)];
  const providers=[{slot:'knowledge',capability:'oats.okf',root:ownCap,settings:{'bindings-file':join(root,'bindings.json'),'state-dir':join(root,'state'),'harvest-runtime':'pi','harvest-model':'fixture/model'}},
    {slot:'messaging',capability:'oats.aweb',root:aweb,settings:{delivery:'session'}}];
  const run=(provider,phase,input)=>{
    const request={schemaVersion:1,phase,slot:provider.slot,capability:provider.capability,settings:provider.settings,input};
    const cli=join(provider.root,'bin',provider.slot==='knowledge'?'oats-okf-binding.mjs':'oats-aweb-binding.mjs');
    const result=spawnSync(process.execPath,[cli,phase],{env,cwd:root,input:JSON.stringify(request),encoding:'utf8',timeout:10000});
    assert.equal(result.status,0,result.stderr);assert.equal(result.stderr,'');
    const decoded=decodeBindingResponse(Buffer.from(result.stdout),request);assert.equal(decoded.ok,true,result.stdout);return decoded.result;
  };
  const normalized=providers.map(p=>run(p,'normalize',{context,declarations}));
  const solved=resolveChoices({requirements:normalized.flatMap(n=>n.requirements),candidates:normalized.flatMap(n=>n.candidates)});
  assert.equal(solved.status,'resolved');
  const bound=providers.map((p,index)=>run(p,'bind',{context,model:normalized[index].model,choices:Object.fromEntries(Object.entries(solved.choices).filter(([key])=>bindingField(key,p.slot)))}));
  assert.deepEqual(JSON.parse(JSON.stringify(bound[0].binding.payload.stores['fixture-kb'])),store);
  assert.equal(bound[1].binding.payload.privateTeam.id,'private:example.invalid');assert.equal(bound[1].binding.payload.responsibleHuman.id,'fixture-human');
  assert.equal(JSON.stringify(bound[0]).includes('fixture-human'),false);assert.equal(JSON.stringify(bound[1]).includes(store.repository),false);
  assert.deepEqual(Object.keys(solved.choices).filter(key=>key.startsWith('/bindings/knowledge/')),['/bindings/knowledge/stores/oats']);
  assert.deepEqual(inventory(root),before,'no state, scratch, transport or native process effects');
});
