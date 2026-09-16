import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  KNOWLEDGE_CONTRACT,
  bindKnowledgeDomain,
  bindingChoiceKey,
  checkKnowledgeRuntime,
  normalizeKnowledgeBindingCandidates,
  normalizeKnowledgeDeclaration,
  renderKnowledgeRuntime,
  storeChoiceKey,
  validateStoreLocator,
} from '../oats-package/capabilities/oats-okf/lib/portable-binding.mjs';
import { validateBindings } from '../oats-package/capabilities/oats-okf/lib/config.mjs';

const origin=(pointer='/knowledge/payload')=>({document:{kind:'source',source:'git:https://example.test/souls.git',revision:'a'.repeat(40),path:'agents/expert/soul.yaml',integrity:{format:'oats.bytes.v1',value:`sha256-${'b'.repeat(64)}`}},pointer});
const directory=(id,path)=>({id,kind:'directory',path:`path:${path}`});
const git=id=>({id,kind:'git',repository:'https://example.test/knowledge.git',root:'knowledge',acceptedBranch:'main',pr:{repository:'example/knowledge'}});
function declaration(payload) {return {contract:KNOWLEDGE_CONTRACT,version:1,payload};}
function choice(value) {return {value};}

test('source-owned fixed/default/inherit stores emit field inputs without choosing precedence',()=>{
  const envelope=declaration({owner:'expert-owner',stores:{
    public:{fixed:git('public-base')},
    local:{default:directory('local-base','/srv/knowledge')},
    adopted:{inherit:'write.default'},
  },reads:[{store:'public',node:'reference'},{store:'local',node:'notes'}],owns:[{node:'expert',destination:'adopted'},{node:'private'}]});
  const origins={};
  for(const pointer of ['/knowledge/payload/stores/public/fixed','/knowledge/payload/stores/local/default','/knowledge/payload/stores/adopted/inherit','/knowledge/payload/reads/0','/knowledge/payload/reads/1','/knowledge/payload/owns/0','/knowledge/payload/owns/1']) origins[pointer]=origin(pointer);
  const model=normalizeKnowledgeDeclaration(envelope,{origins});
  assert.equal(model.owner,'expert-owner');
  assert.deepEqual(model.requirements.map(({key,kind})=>[key,kind]),[
    [storeChoiceKey('public'),'equals'],[bindingChoiceKey('write.default'),'required'],[bindingChoiceKey('write.default'),'required'],
  ]);
  assert.deepEqual(model.candidates.map(({key,kind})=>[key,kind]),[[storeChoiceKey('local'),'soul-default']]);
  assert.equal(model.stores.adopted.choiceKey,bindingChoiceKey('write.default'));
  assert.deepEqual(model.reads.map(({store,node})=>[store,node]),[['public','reference'],['local','notes']]);
  assert.equal(model.requirements[0].origin.pointer,'/knowledge/payload/stores/public/fixed','provider field keeps its exact source origin');
});

test('workspace/adoption/operator bindings become candidates for the shared resolver only',()=>{
  const workspace=normalizeKnowledgeBindingCandidates({bindings:{'write.default':directory('team-base','/srv/team')},kind:'workspace-default',origin:origin('/workspace')});
  const adoption=normalizeKnowledgeBindingCandidates({bindings:{'write.default':git('project-base')},kind:'import-adoption',origin:origin('/adoption')});
  const operator=normalizeKnowledgeBindingCandidates({bindings:{'write.default':directory('private-base','/srv/private')},kind:'operator',origin:origin('/operator')});
  assert.deepEqual([workspace[0].kind,adoption[0].kind,operator[0].kind],['workspace-default','import-adoption','operator']);
  assert.ok([workspace,adoption,operator].flat().every(entry=>entry.key===bindingChoiceKey('write.default')));
  assert.equal(Object.hasOwn(workspace[0],'selected'),false,'provider emits candidates, not a hidden precedence decision');
});

test('binding renders stable store identities, multiple stores and explicit write routing',()=>{
  const model=normalizeKnowledgeDeclaration(declaration({owner:'expert-owner',stores:{
    public:{fixed:git('public-base')}, local:{default:directory('local-base','/srv/knowledge')}, adopted:{inherit:'write.default'},
  },reads:[{store:'public',node:'reference'},{store:'local',node:'shared'}],owns:[{node:'expert',destination:'adopted'},{node:'journal',destination:'local'}]}),{origin:origin()});
  const choices={
    [storeChoiceKey('public')]:choice(git('public-base')),
    [storeChoiceKey('local')]:choice(directory('local-base','/srv/knowledge')),
    [bindingChoiceKey('write.default')]:choice(directory('private-base','/srv/private')),
  };
  const result=bindKnowledgeDomain({model,choices});
  assert.deepEqual(Object.keys(result.payload.stores).sort(),['local-base','private-base','public-base']);
  assert.equal(result.payload.stores['local-base'].path,'/srv/knowledge','rendered directory stores use the existing runtime path shape');
  assert.equal(result.payload.stores['private-base'].path,'/srv/private');
  assert.deepEqual(result.payload.reads,[{store:'public-base',node:'reference'},{store:'local-base',node:'shared'}]);
  assert.deepEqual(result.payload.owns,[{store:'private-base',node:'expert',steward:'expert-owner'},{store:'local-base',node:'journal',steward:'expert-owner'}]);
  assert.deepEqual(result.credentialRefs,{});assert.ok(result.provenance.length>=4);
  assert.doesNotThrow(()=>validateBindings({version:1,stateDir:'/srv/okf-state',bases:result.payload.stores},'/srv/okf-bindings.json'),"rendered stores retain the existing provider runtime contract");
});

test('read access never invents publication authority or a destination',()=>{
  const publicRead=git('public-base');
  const readOnly=normalizeKnowledgeDeclaration(declaration({owner:'expert-owner',stores:{public:{fixed:publicRead}},reads:[{store:'public',node:'reference'}],owns:[]}),{origin:origin()});
  const readBinding=bindKnowledgeDomain({model:readOnly,choices:{[storeChoiceKey('public')]:choice(publicRead)}});
  assert.deepEqual(readBinding.payload.owns,[]);
  const needsWrite=normalizeKnowledgeDeclaration(declaration({owner:'expert-owner',stores:{public:{fixed:publicRead}},reads:[{store:'public',node:'reference'}],owns:[{node:'private-note'}]}),{origin:origin()});
  assert.throws(()=>bindKnowledgeDomain({model:needsWrite,choices:{[storeChoiceKey('public')]:choice(publicRead)}}),/unresolved knowledge binding: \/bindings\/knowledge\/write\/default/);
  assert.ok(readBinding.payload.stores['public-base'].pr,'PR routing metadata alone does not create an owned destination');
});

test('captured domain renders and checks through the existing runtime after source/config loss and poison',t=>{
  const root=fs.mkdtempSync(join(fs.realpathSync(tmpdir()),'okf-portable-runtime-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const acceptedPath=join(root,'accepted'),stateDir=join(root,'durable-state'),descriptorFile=join(root,'host','okf-bindings.json');
  fs.mkdirSync(acceptedPath,{recursive:true});fs.mkdirSync(join(root,'source'),{recursive:true});fs.mkdirSync(join(root,'host'),{recursive:true});
  const sourceFile=join(root,'source','okf.json');fs.writeFileSync(sourceFile,'{"live":"source"}\n');
  fs.writeFileSync(descriptorFile,'{"live":"configuration"}\n');
  const domain={owner:'expert-owner',stores:{
    'private-base':{id:'private-base',kind:'directory',path:acceptedPath},
  },reads:[{store:'private-base',node:'reference'}],owns:[{store:'private-base',node:'expert',steward:'expert-owner'}]};
  const rendered=renderKnowledgeRuntime({domain,stateDir,descriptorFile});
  assert.deepEqual(rendered.bindings,{version:1,stateDir,bases:{'private-base':domain.stores['private-base']}});
  assert.deepEqual(rendered.declaration,{version:1,owner:'expert-owner',reads:['private-base/reference'],owns:['private-base/expert']});
  assert.equal(fs.existsSync(stateDir),false,'pure rendering creates no state');

  const accepted={'private-base':{id:'private-base',nodes:{reference:{path:'reference',owner:'reader-owner'},expert:{path:'expert',owner:'expert-owner'}}}};
  fs.rmSync(join(root,'source'),{recursive:true});fs.rmSync(descriptorFile);
  const absentBefore=fs.readdirSync(root).sort();
  const absent=checkKnowledgeRuntime({rendered,accepted,sourceHome:join(root,'deleted-home'),sourceWork:join(root,'deleted-work')});
  assert.deepEqual(absent.declaration,rendered.declaration);assert.equal(absent.bindings.bases['private-base'].path,acceptedPath);
  assert.deepEqual(fs.readdirSync(root).sort(),absentBefore,'read-only check creates no descriptor or state after deletion');

  fs.writeFileSync(descriptorFile,JSON.stringify({version:1,stateDir:'/poison',bases:{evil:{id:'evil',kind:'directory',path:'/poison'}}}));
  const poisonBefore=fs.readFileSync(descriptorFile,'utf8');
  const checked=checkKnowledgeRuntime({rendered,accepted});
  assert.equal(checked.bindings.stateDir,stateDir);assert.deepEqual(checked.declaration.owns,['private-base/expert']);
  assert.equal(fs.readFileSync(descriptorFile,'utf8'),poisonBefore,'captured check neither reads nor replaces current config bytes');
  assert.equal(fs.existsSync(stateDir),false);
  assert.throws(()=>checkKnowledgeRuntime({rendered,accepted:{'private-base':{nodes:{reference:{owner:'reader-owner'},expert:{owner:'other-owner'}}}}}),/owner mismatch/);
  assert.throws(()=>checkKnowledgeRuntime({rendered:{...rendered,bindings:{...rendered.bindings,stateDir:'relative'}},accepted}),/stateDir must be a normalized absolute path/);
});

test('runtime adapter requires explicit host custody and stable aliases',()=>{
  const domain={owner:'expert-owner',stores:{base:{id:'base',kind:'directory',path:'/srv/base'}},reads:[],owns:[]};
  assert.throws(()=>renderKnowledgeRuntime({domain,stateDir:'relative',descriptorFile:'/srv/bindings.json'}),/stateDir must be a normalized absolute path/);
  assert.throws(()=>renderKnowledgeRuntime({domain,stateDir:'/srv/state',descriptorFile:'relative'}),/descriptor file must be a normalized absolute path/);
  assert.throws(()=>renderKnowledgeRuntime({domain:{...domain,stores:{alias:{...domain.stores.base}}},stateDir:'/srv/state',descriptorFile:'/srv/bindings.json'}),/alias must equal stable store identity/);
  assert.throws(()=>renderKnowledgeRuntime({domain:{...domain,owns:[{store:'base',node:'expert',steward:'someone-else'}]},stateDir:'/srv/state',descriptorFile:'/srv/bindings.json'}),/steward mismatch/);
  assert.throws(()=>renderKnowledgeRuntime({domain:{...domain,owns:[{node:'expert',steward:'expert-owner'}]},stateDir:'/srv/state',descriptorFile:'/srv/bindings.json'}),/requires store/);
});

test('stable identities, destinations and nonsecret locators fail closed',()=>{
  const base={owner:'expert-owner',stores:{one:{fixed:directory('one','/srv/one')}},reads:[],owns:[]};
  for(const payload of [
    {...base,owner:'constructor'},
    {...base,reads:[{store:'missing',node:'x'}]},
    {...base,owns:[{node:'x',destination:'missing'}]},
    {...base,reads:[{store:'one',node:'x'},{store:'one',node:'x'}]},
    {...base,stores:{one:{fixed:directory('one','/srv/one'),default:directory('two','/srv/two')}}},
  ]) assert.throws(()=>normalizeKnowledgeDeclaration(declaration(payload),{origin:origin()}));
  assert.throws(()=>validateStoreLocator({id:'git-base',kind:'git',repository:'https://user:secret@example.test/repo.git',root:'.',acceptedBranch:'main',pr:{repository:'example/repo'}}),/credentials/);
  assert.doesNotThrow(()=>validateStoreLocator({id:'git-base',kind:'git',repository:'ssh://git@example.test/repo.git',root:'.',acceptedBranch:'main',pr:{repository:'example/repo'}}),'an SSH transport user is not a secret');
  assert.throws(()=>validateStoreLocator({id:'git-base',kind:'git',repository:'ssh://git:secret@example.test/repo.git',root:'.',acceptedBranch:'main',pr:{repository:'example/repo'}}),/credentials/);
  assert.throws(()=>validateStoreLocator({id:'git-base',kind:'git',repository:'https://example.test/repo.git',root:'.',acceptedBranch:'main'}),/requires pr/);
  assert.throws(()=>validateStoreLocator({id:'dir-base',kind:'directory',path:'/not-explicit'}),/path:/);

  const model=normalizeKnowledgeDeclaration(declaration({owner:'expert-owner',stores:{a:{fixed:directory('same','/srv/a')},b:{fixed:directory('same','/srv/b')}},reads:[],owns:[]}),{origin:origin()});
  assert.throws(()=>bindKnowledgeDomain({model,choices:{[storeChoiceKey('a')]:choice(directory('same','/srv/a')),[storeChoiceKey('b')]:choice(directory('same','/srv/b'))}}),/conflicting locations/);

  const sameStore=directory('same','/srv/same'),resolvedReads=normalizeKnowledgeDeclaration(declaration({owner:'expert-owner',stores:{a:{fixed:sameStore},b:{fixed:sameStore}},reads:[{store:'a',node:'shared'},{store:'b',node:'shared'}],owns:[]}),{origin:origin()});
  const sameChoices={[storeChoiceKey('a')]:choice(sameStore),[storeChoiceKey('b')]:choice(sameStore)};
  assert.throws(()=>bindKnowledgeDomain({model:resolvedReads,choices:sameChoices}),/duplicate resolved knowledge read/);
  const resolvedOwns=normalizeKnowledgeDeclaration(declaration({owner:'expert-owner',stores:{a:{fixed:sameStore},b:{fixed:sameStore}},reads:[],owns:[{node:'shared',destination:'a'},{node:'shared',destination:'b'}]}),{origin:origin()});
  assert.throws(()=>bindKnowledgeDomain({model:resolvedOwns,choices:sameChoices}),/duplicate resolved knowledge steward/);
});
