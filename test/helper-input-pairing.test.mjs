import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
import {dirname,join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {inventory,noEffectsPreload} from './helpers/no-effects.mjs';

// Separate real retained producer pairing; never relabel the older257 fixture.
// Kernel imports below are TEST ONLY. The shipped capability imports no kernel.
const ROOT=fileURLToPath(new URL('../',import.meta.url));
// Accepted source is a Git TREE reconstructed from this exact base+patch,
// not original BE and not full59's unrelated native/API2 ancestry.
const PRODUCER=Object.freeze({
  tree:'0c031114e965b08ac25b29ab456f48eedcf42c91',
  base:'be2460c52bf5403d8edcc7058ffe8e0dc58d0952',
  patchSha256:'a29db161dc87a90360ec2ecde1629b6b294835368ce8363c1eac7587f81f78ac',
});
const SCHEMA_SHA='a43b48076e2ec41a2c03cd429230d2c011f74959e5dd98ff080a46f27930c77d'; // 2.1.3: pin re-approved to the reasons-bearing schema landed in e9ea54d (the pin was not updated then)
const framework=process.env.OATS_HELPER_INPUT_FRAMEWORK_ROOT;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=file=>JSON.parse(fs.readFileSync(file,'utf8'));
function put(file,value) {fs.mkdirSync(dirname(file),{recursive:true});fs.writeFileSync(file,typeof value==='string'?value:JSON.stringify(value));}

test('c77 vendored manifest schema retains accepted BE+P1 byte identity',()=>{
  assert.equal(sha(fs.readFileSync(join(ROOT,'schemas/capability-manifest.schema.json'))),SCHEMA_SHA);
});

async function producer(t) {
  if(!framework) {t.skip(`set OATS_HELPER_INPUT_FRAMEWORK_ROOT to accepted BE+P1 tree ${PRODUCER.tree}`);return;}
  assert.equal(process.env.OATS_HELPER_INPUT_FRAMEWORK_TREE,PRODUCER.tree,'pairing requires the accepted corrected tree, not a commit/version alias');
  assert.equal(process.env.OATS_HELPER_INPUT_FRAMEWORK_BASE,PRODUCER.base,'retain the exact producer base');
  assert.equal(process.env.OATS_HELPER_INPUT_FRAMEWORK_PATCH_SHA256,PRODUCER.patchSha256,'retain the accepted correction patch identity');
  assert.equal(sha(fs.readFileSync(join(framework,'docs/capability-manifest.schema.json'))),SCHEMA_SHA);
  assert.equal(sha(fs.readFileSync(join(framework,'lib/helper-injection-policy.mjs'))),'29f6ddac6b15cc340effc2fb1ef02b92a1f8095e6c86efafbfc35255068db922','execute the actual corrected policy, not relabelled BE');
  assert.equal(sha(fs.readFileSync(join(framework,'docs/portable.schema.json'))),'5083e05bfa7c37c60d953cdbd1bcc88beff89c49a6694f5dc5a2b13a96606dbb','exclude full59/native API2 schema ancestry');
  const modules=await Promise.all(['core','captured-resolutions','captured-invocation-context'].map(name=>import(pathToFileURL(join(framework,`lib/${name}.mjs`)))));
  return Object.assign({},...modules);
}

function fixture(t) {
  const root=fs.realpathSync(fs.mkdtempSync(join(tmpdir(),'okf-be-pair-'))),repo=join(root,'source'),deployment=join(root,'deployment');
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));fs.mkdirSync(deployment);
  const env={...process.env,HOME:join(root,'home'),OATS_HOME_DIR:join(root,'host-state'),TMPDIR:join(root,'tmp'),XDG_CONFIG_HOME:join(root,'config'),XDG_CACHE_HOME:join(root,'cache'),GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:join(root,'gitconfig'),GIT_CONFIG_SYSTEM:'/dev/null',GIT_TERMINAL_PROMPT:'0'};
  for(const key of Object.keys(env)) if(/^(OATS_|PI_AGENT_)/.test(key) && key!=='OATS_HOME_DIR') delete env[key];
  for(const dir of [env.HOME,env.OATS_HOME_DIR,env.TMPDIR,env.XDG_CONFIG_HOME,env.XDG_CACHE_HOME])fs.mkdirSync(dir);
  put(env.GIT_CONFIG_GLOBAL,'');
  const git=(...args)=>execFileSync('git',['-C',repo,...args],{env,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  const settings={'bindings-file':join(root,'host','bindings.json'),'state-dir':join(root,'state')};
  put(join(repo,'oats.yaml'),{schemaVersion:1,exports:{souls:[{path:'agents/expert',definition:'agents/expert/soul.yaml'}]}});
  put(join(repo,'agents/expert/soul.yaml'),{schemaVersion:1,name:'expert',work:'directory',requires:{knowledge:{capability:'oats.okf',source:'repo:packages/okf',settings}},knowledge:{contract:'oats.okf.locations',version:1,payload:{owner:'expert-owner',stores:{private:{fixed:{id:'private-kb',kind:'directory',path:`path:${join(root,'accepted')}`}}},reads:[],owns:[{node:'expert',destination:'private'}]}}});
  put(join(repo,'agents/expert/AGENTS.md'),'# Canonical source role\nRetain source facts, not composed injection text.\n');
  fs.symlinkSync('AGENTS.md',join(repo,'agents/expert/CLAUDE.md'));
  fs.cpSync(join(ROOT,'oats-package'),join(repo,'packages/okf'),{recursive:true,verbatimSymlinks:true});
  git('init','--quiet','--initial-branch=topic');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');
  git('config','uploadpack.allowFilter','true');git('config','uploadpack.allowAnySHA1InWant','true');
  const source='git:https://example.invalid/okf-be-pair.git';
  git('config','--file',env.GIT_CONFIG_GLOBAL,`url.${pathToFileURL(repo).href}.insteadOf`,source.slice(4));
  git('add','-A');git('commit','--quiet','-m','exact provider pairing payload');
  const cli=join(framework,'bin/oats.mjs');
  const call=(args,extra={})=>spawnSync(process.execPath,[cli,...args],{cwd:deployment,env:{...env,...extra},encoding:'utf8',timeout:60000,maxBuffer:16*1024*1024});
  const input={deployment,source:{source,soul:'agents/expert',revision:'topic',alias:'imported-expert'}};
  return {root,repo,deployment,env,settings,cli,call,input,options:{repositoryOptions:{environment:env,allowLocalGit:true}}};
}
function ok(call) {assert.equal(call.status,0,call.stdout+call.stderr);return JSON.parse(call.stdout).result;}

test('accepted BE+P1 tree 0c031114 actual OKF hooks and public SOURCE continuation survive source deletion',async t=>{
  const p=await producer(t);if(!p)return;
  const f=fixture(t),oldEnv={...process.env};
  // Embedding setup and real CLI children share only the private fixture scope.
  for(const key of Object.keys(process.env))delete process.env[key];Object.assign(process.env,f.env);
  t.after(()=>{for(const key of Object.keys(process.env))delete process.env[key];Object.assign(process.env,oldEnv);});
  const pending=p.prepareCapturedComposition(f.input,f.options);
  assert.equal(pending.resolution,null,JSON.stringify(pending));
  p.approveAvailableCapability(f.deployment,pending.selections[0].artifactSet,'oats.okf',{kind:'operator',document:{kind:'operator',id:'pairing-fixture'},pointer:'/approve'});
  const ready=p.prepareCapturedComposition(f.input,f.options);assert.equal(ready.status,'prepared',JSON.stringify(ready));
  const record=p.readCapturedResolution(f.deployment,ready.resolution),key='oats.okf:memory-harvest',helper=p.resolveCapturedHelper({executionBinding:ready.executionBinding,helper:key});
  const helperRecord=p.readCapturedResolution(f.deployment,helper.executionBinding.resolution);
  assert.equal(record.choices['/helpers/injections/oats.okf'],undefined);
  assert.equal(helperRecord.choices['/helpers/injections/oats.okf'].value,null);
  assert.deepEqual(JSON.parse(JSON.stringify(helperRecord.dispatch.composition.omissions)),[{source:'capability:oats.okf',reason:'helper-policy',choice:'/helpers/injections/oats.okf'}]);
  const loaded=p.loadCapturedDispatch({deployment:f.deployment,resolution:ready.resolution,action:{kind:'inspect'}}),cap=loaded.manifests.get('oats.okf')._dir;
  assert.deepEqual(fs.readFileSync(join(cap,'oats.json')),fs.readFileSync(join(ROOT,'oats-package/capabilities/oats-okf/oats.json')),'retained manifest is the actual separate provider artifact');
  const {initBase}=await import(pathToFileURL(join(cap,'lib/migration.mjs')));
  const nodes=join(f.root,'nodes.json');put(nodes,{expert:{path:'expert',owner:'expert-owner'}});
  fs.mkdirSync(dirname(f.settings['bindings-file']),{recursive:true});
  initBase(record.bindings.knowledge.payload.runtime.bindings,'private-kb',nodes,undefined,{confirm:true}); // accepted-base fixture bootstrap, not captured setup.
  fs.rmSync(f.repo,{recursive:true});put(join(f.deployment,'oats-config.yaml'),'invalid current config: never authority\n');put(join(f.deployment,'oats-lock.json'),'invalid current lock\n');
  const homes=join(f.root,'homes');fs.mkdirSync(homes);
  // Actual fresh kernel scaffold/index/admission, but deliberately incomplete
  // input transport to the provider. This must NOT create a new source.
  const emptyHome=join(homes,'imported-expert-empty-input'),hook={kind:'hook',capability:'oats.okf',name:'spawn'};
  const empty=p.scaffoldCapturedInstance({deployment:f.deployment,resolution:ready.resolution,home:emptyHome,instance:'imported-expert-empty-input'});
  const request={deployment:f.deployment,resolution:ready.resolution,home:emptyHome,action:hook,input:{fixture:'missing-selected-source-input'}};
  const admitted=p.admitCapturedAction(request);
  const indexed={deployment:f.deployment,home:emptyHome,executionBinding:ready.executionBinding,capability:'oats.okf',action:hook,intent:admitted.intent};
  p.beginCapturedIntent(indexed);
  const emptyLoaded={...loaded,capability:loaded.capabilities.get('oats.okf')};
  const emptyContext=p.buildCapturedInvocationContext({loaded:emptyLoaded,action:hook,instance:{home:emptyHome,work:join(emptyHome,'work'),name:empty.instance,agent:'imported-expert'},intent:admitted.intent});
  const inputPreload=noEffectsPreload(f.root);
  p.withCapturedInvocationContextFile(emptyContext,contextEnv=>p.withCapturedBindingFile(emptyLoaded,bindingEnv=>{
    for(const partial of [false,true]) {
      const env={...f.env,...contextEnv,...bindingEnv};if(partial)delete env.OATS_INVOCATION_CONTEXT_FILE;
      const stateInventory=()=>fs.existsSync(f.settings['state-dir'])?inventory(f.settings['state-dir']):null;
      const before=stateInventory(),homeBefore=inventory(emptyHome);
      const result=spawnSync(process.execPath,['--import',inputPreload,join(cap,'bin/oats-okf.mjs'),'spawn'],{cwd:emptyHome,env,encoding:'utf8',timeout:30000});
      assert.equal(result.status,1,result.stdout+result.stderr);assert.match(result.stdout,partial?/new captured registration requires generic admitted invocation/:/new captured registration requires SourceReceipt1 input authority/);
      assert.equal(result.stderr,'');assert.deepEqual(stateInventory(),before);assert.deepEqual(inventory(emptyHome),homeBefore);
    }
  }));
  p.settleCapturedIntent({...indexed,state:'unconfirmed',receipt:{fixture:'missing-source-input-refused'},replayable:false});
  assert.equal(fs.existsSync(join(emptyHome,'.okf-source.json')),false);
  const sourceHome=join(homes,'imported-expert-one');
  const spawned=ok(f.call(['spawn','imported-expert','--deployment',f.deployment,'--resolution',ready.resolution.id,'--home',sourceHome,'--no-launch','--json']));
  assert.equal(spawned.launchPending,true);assert.deepEqual(spawned.hookOrder,['oats.okf']);
  assert.equal(fs.readlinkSync(join(sourceHome,'CLAUDE.md')),'AGENTS.md');assert.ok(fs.statSync(join(sourceHome,'work')).isDirectory());
  const metadata=json(join(sourceHome,'instance.json')),sourceFile=metadata.capabilityMeta['oats.okf'].source,source=json(sourceFile);
  assert.equal(source.role,'# Canonical source role\nRetain source facts, not composed injection text.\n');
  assert.deepEqual(source.executionBinding,ready.executionBinding);assert.equal(source.responsibleHuman,null);
  assert.equal(metadata.capabilityMeta['oats.okf'].memory,'okf-v2');
  const sourceSnapshot=fs.readFileSync(sourceFile),owners=fs.readFileSync(join(f.settings['state-dir'],'owners.json'));
  const helperHome=join(homes,'memory-harvest-one');
  const worker=ok(f.call(['spawn',helper.helper.name,'--deployment',helper.executionBinding.deployment,'--resolution',helper.executionBinding.resolution.id,'--home',helperHome,'--no-launch','--json']));
  assert.equal(worker.launchPending,true);assert.equal(json(join(helperHome,'instance.json')).capabilityMeta['oats.okf'].memory,'none');
  assert.equal(fs.existsSync(join(helperHome,'.okf-source.json')),false);assert.deepEqual(fs.readFileSync(join(f.settings['state-dir'],'owners.json')),owners);
  // Public exported captured hook ABI, not legacy config-chain retireInstance.
  const helperRetired=p.runCapturedLifecycleHooks('retire',{deployment:f.deployment,resolution:helper.executionBinding.resolution,home:helperHome,instance:worker.instance,agentName:helper.helper.name});
  assert.equal(helperRetired.meta['oats.okf'].retired,true);assert.equal(helperRetired.meta['oats.okf'].reason,'service');
  const retired=p.runCapturedLifecycleHooks('retire',{deployment:f.deployment,resolution:ready.resolution,home:sourceHome,instance:spawned.instance,agentName:'imported-expert'});
  assert.equal(retired.meta['oats.okf'].retired,true,'real final capture for never-launched source');
  assert.deepEqual(fs.readFileSync(sourceFile),sourceSnapshot);
  const statusFile=join(dirname(sourceFile),'status.json');assert.equal(json(statusFile).retired,true);

  const io=await import(pathToFileURL(join(cap,'lib/io.mjs'))),stores=await import(pathToFileURL(join(cap,'lib/stores.mjs')));
  // Capability-owned RETAINED RUN fixture. This is not permission to launch a
  // new captured worker or a claim that the scaffold above ever executed one.
  const id=randomUUID(),runDir=join(dirname(sourceFile),'runs',id),work=join(f.root,'retained-run-work');fs.mkdirSync(work);
  const text='An explicit fixture outcome is not durable general knowledge.',payload={version:1,kind:'note',name:'decision.md',contentHash:io.hash(text),text},inputId=io.hash(payload);
  io.save(join(dirname(sourceFile),'inputs',`${inputId}.json`),payload);
  const stage=stores.stageBase(source.bindings.bases['private-kb'],join(work,'base'));
  const judgment={version:1,exclusionsReviewed:true,outcomes:[{input:inputId,verdict:'drop',reason:'Fixture-only observation.',concepts:[]}]};
  const proposal={version:1,run:id,created:'2026-09-17T00:00:00.000Z',file:join(runDir,'private-kb-proposal.json'),before:stage.files,after:stage.files,changed:[]};io.save(proposal.file,proposal);
  const run={version:1,id,source:source.id,created:proposal.created,inputs:[inputId],status:'delivering',judgment,stages:{'private-kb':{root:stage.root,baseline:stage.files,digest:stage.digest,owned:['expert']}},receipts:{'private-kb':{status:'no-change',proposal:proposal.file,proposalHash:io.hash(proposal)}}};
  io.save(join(runDir,'run.json'),run);const status=json(statusFile);status.captured.inputs.push(inputId);status.activeRun=id;io.save(statusFile,status);
  fs.rmSync(sourceHome,{recursive:true});fs.rmSync(helperHome,{recursive:true});
  const command=(name,binding=ready.executionBinding,tail=[])=>['okf',name,'--deployment',binding.deployment,'--resolution',binding.resolution.id,'--','--source',sourceFile,...tail,'--json'];
  const before=inventory(f.settings['state-dir']);
  const wrong=f.call(command('retry',helper.executionBinding));assert.equal(wrong.status,1);assert.equal(JSON.parse(wrong.stdout).error.code,'E_INVOCATION');
  assert.deepEqual(inventory(f.settings['state-dir']),before,'helper projection cannot authorize SOURCE continuation even with same provider payload');
  const missing=f.call(command('complete',ready.executionBinding,['--run',randomUUID()]));assert.equal(missing.status,1);assert.deepEqual(inventory(f.settings['state-dir']),before,'missing run refuses before worker persistence');
  const completed=ok(f.call(command('retry')));assert.equal(completed.processed,true);assert.equal(completed.run,id);
  assert.deepEqual(json(statusFile).processed,[inputId]);
  assert.equal(ok(f.call(command('complete',ready.executionBinding,['--run',id]))).processed,true,'existing receipt continuation is idempotent, not another dispatch');
  assert.equal(fs.existsSync(sourceHome),false);assert.equal(fs.existsSync(helperHome),false);

  // Accepted BE+P1 snapshot writers, controlled invalid transport -> actual provider
  // CLI. These negatives are NOT claimed as unmodified public CLI production.
  const action={kind:'command',namespace:'okf',name:'complete'},selected=p.loadCapturedDispatch({deployment:f.deployment,resolution:ready.resolution,action});
  const invocation=p.buildCapturedInvocationContext({loaded:selected,action});
  assert.equal(invocation.instance,null);assert.equal(invocation.intent,null);assert.equal(invocation.priorReceipt,null);
  // The same current-producer value is inline check input; poisoned execution
  // pointers cannot replace it or supply a missing/invalid projection.
  const check=value=>spawnSync(process.execPath,[join(cap,'bin/oats-okf-binding.mjs'),'check'],{input:JSON.stringify({schemaVersion:1,phase:'check',slot:'knowledge',capability:'oats.okf',settings:{},input:{binding:record.bindings.knowledge,context:record.context,action,invocation:value}}),cwd:f.deployment,env:{...f.env,OATS_INVOCATION_CONTEXT_FILE:'/poison-context',OATS_BINDING_FILE:'/poison-binding'},encoding:'utf8',timeout:30000});
  const checked=check(invocation);assert.equal(checked.status,0,checked.stdout+checked.stderr);assert.equal(JSON.parse(checked.stdout).result.status,'ready');
  const invalidCheck=check({...invocation,intent:{}});assert.equal(invalidCheck.status,0);assert.equal(JSON.parse(invalidCheck.stdout).error.code,'invalid-binding');
  let contextFile,bindingFile;
  const preload=noEffectsPreload(f.root);
  p.withCapturedInvocationContextFile(invocation,contextEnv=>p.withCapturedBindingFile(selected,bindingEnv=>{
    contextFile=contextEnv.OATS_INVOCATION_CONTEXT_FILE;bindingFile=bindingEnv.OATS_BINDING_FILE;
    for(const file of [contextFile,bindingFile])assert.equal(fs.statSync(file).mode&0o777,0o600);
    const good=fs.readFileSync(contextFile);
    for(const variant of ['bad-json','wrong-source','missing-binding']) {
      fs.writeFileSync(contextFile,variant==='bad-json'?'{}':variant==='wrong-source'?JSON.stringify({...invocation,executionBinding:helper.executionBinding}):good);
      const env={...f.env,...contextEnv,...bindingEnv};if(variant==='missing-binding')delete env.OATS_BINDING_FILE;
      const stable=inventory(f.settings['state-dir']),result=spawnSync(process.execPath,['--import',preload,join(cap,'bin/oats-okf.mjs'),'complete','--source',sourceFile,'--run',id,'--json'],{cwd:f.deployment,env,encoding:'utf8',timeout:30000});
      assert.equal(result.status,1,result.stdout+result.stderr);assert.equal(JSON.parse(result.stdout).error.code,'E_INVOCATION');assert.equal(result.stderr,'');
      assert.deepEqual(inventory(f.settings['state-dir']),stable);
    }
    fs.writeFileSync(contextFile,good);
  }));
  assert.equal(fs.existsSync(contextFile),false);assert.equal(fs.existsSync(bindingFile),false);
  const portable=join(f.deployment,'.agents','portable');
  assert.deepEqual(fs.readdirSync(portable).filter(name=>/^\.(binding-|invocation-context-|source-receipt-)/.test(name)),[],'all ordinary selected-owner snapshot scratch is cleaned');
  // No all-capabilities pairing claim: this fixture selects an actual binding.
  // Old descriptor+binding ingress and its cutoff remain a separate review.
});
