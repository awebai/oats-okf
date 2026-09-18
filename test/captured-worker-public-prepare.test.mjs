// Opt-in NEW consumer integration: actual kernel admission/public helper scaffold
// and provider run/staging, but NO native/model launch or learning claim.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync,spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
const ROOT=fileURLToPath(new URL('../',import.meta.url));
const framework=process.env.OATS_CAPTURED_WORKER_FRAMEWORK_ROOT;
test('public admitted captured harvest prepares one real run/helper and repeats without native dispatch',async t=>{
 if(!framework){t.skip('explicit current framework with public helper launchSelection required');return;}
 const root=fs.realpathSync(fs.mkdtempSync(join(tmpdir(),'okf-public-worker-')));t.diagnostic('retained fixture '+root);
 const repo=join(root,'source'),deployment=join(root,'deployment'),home=join(root,'source-home'),config=join(root,'gitconfig');fs.mkdirSync(deployment);
 const put=(file,value)=>{fs.mkdirSync(dirname(file),{recursive:true});fs.writeFileSync(file,typeof value==='string'?value:JSON.stringify(value));};
 const old={...process.env},env={...process.env,HOME:join(root,'home'),OATS_HOME_DIR:join(root,'oats'),TURN_RECORD_ROOT:join(root,'records'),GIT_CONFIG_GLOBAL:config,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_SYSTEM:'/dev/null',GIT_TERMINAL_PROMPT:'0'};
 for(const k of Object.keys(env))if(k.startsWith('OATS_')&&k!=='OATS_HOME_DIR')delete env[k];
 for(const path of [env.HOME,env.OATS_HOME_DIR,env.TURN_RECORD_ROOT])fs.mkdirSync(path);put(config,'');
 for(const k of Object.keys(process.env))delete process.env[k];Object.assign(process.env,env);
 t.after(()=>{for(const k of Object.keys(process.env))delete process.env[k];Object.assign(process.env,old);});
 const settings={'bindings-file':join(root,'bindings.json'),'state-dir':join(root,'state'),'harvest-runtime':'pi','harvest-model':'unit/model'};
 put(join(repo,'oats.yaml'),{schemaVersion:1,exports:{souls:[{path:'agents/expert',definition:'agents/expert/soul.yaml'}]}});
 put(join(repo,'agents/expert/soul.yaml'),{schemaVersion:1,name:'expert',work:'directory',requires:{knowledge:{capability:'oats.okf',source:'repo:packages/okf',settings}},knowledge:{contract:'oats.okf.locations',version:1,payload:{owner:'test-owner',stores:{private:{fixed:{id:'test-kb',kind:'directory',path:'path:'+join(root,'accepted')}}},reads:[],owns:[{node:'expert',destination:'private'}]}}});
 put(join(repo,'agents/expert/AGENTS.md'),'# Controlled no-launch fixture\n');fs.symlinkSync('AGENTS.md',join(repo,'agents/expert/CLAUDE.md'));
 fs.cpSync(join(ROOT,'oats-package'),join(repo,'packages/okf'),{recursive:true,verbatimSymlinks:true});
 const git=(...a)=>execFileSync('git',['-C',repo,...a],{env,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 git('init','--quiet','--initial-branch=topic');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');git('config','uploadpack.allowFilter','true');git('config','uploadpack.allowAnySHA1InWant','true');
 const source='git:https://example.invalid/public-worker.git';git('config','--file',config,'url.'+pathToFileURL(repo).href+'.insteadOf',source.slice(4));git('add','.');git('commit','--quiet','-m','controlled provider source');
 const p=await import(pathToFileURL(join(framework,'lib/core.mjs'))),r=await import(pathToFileURL(join(framework,'lib/captured-resolutions.mjs')));
 const launch={runtime:'pi',executable:process.execPath,args:[],env:{},model:'unit/model',yolo:false}; // never launched, NOT SDK/profile readiness.
 const input={deployment,source:{source,soul:'agents/expert',revision:'topic',alias:'expert'},launch,helperLaunches:{'oats.okf:memory-harvest':launch}},options={repositoryOptions:{environment:env,allowLocalGit:true}};
 const pending=p.prepareCapturedComposition(input,options);p.approveAvailableCapability(deployment,pending.selections[0].artifactSet,'oats.okf',{kind:'operator',document:{kind:'operator',id:'controlled-unit'},pointer:'/approve'});
 const ready=p.prepareCapturedComposition(input,options);assert.equal(ready.status,'prepared');
 const loaded=p.loadCapturedDispatch({deployment,resolution:ready.resolution,action:{kind:'inspect'}}),cap=loaded.manifests.get('oats.okf')._dir,record=r.readCapturedResolution(deployment,ready.resolution);
 const {initBase}=await import(pathToFileURL(join(cap,'lib/migration.mjs')));const nodes=join(root,'nodes.json');put(nodes,{expert:{path:'expert',owner:'test-owner'}});initBase(record.bindings.knowledge.payload.runtime.bindings,'test-kb',nodes,undefined,{confirm:true});
 fs.rmSync(repo,{recursive:true});put(join(deployment,'oats-config.yaml'),'poisoned');put(join(deployment,'oats-lock.json'),'poisoned');
 const call=args=>{const out=spawnSync(process.execPath,[join(framework,'bin/oats.mjs'),...args,'--json'],{cwd:deployment,env,encoding:'utf8',timeout:60000,maxBuffer:4*1024*1024});assert.equal(out.status,0,out.stdout+out.stderr);return JSON.parse(out.stdout).result;};
 const flags=['--deployment',deployment,'--resolution',ready.resolution.id];call(['spawn','expert',...flags,'--home',home,'--no-launch']);
 put(join(home,'notes/controlled.md'),'Controlled fixture evidence, NOT real model learning.\n');
 const endpoint=join(root,'endpoint.json');put(endpoint,{schemaVersion:1,backend:{backend:'tmux',binary:'/not-invoked/tmux',socket:join(root,'not-invoked.sock'),session:'not-invoked'}});
 const argv=['operation','run','knowledge:harvest',...flags,'--home',home,'--arg','native-request='+endpoint,'--arg','worker-mode=prepare'];
 const first=call(argv).result;assert.equal(first.status,'ready');assert.ok(first.run&&first.home);assert.equal(first.launch,null);
 const before=fs.readFileSync(join(first.home,'instance.json')),meta=JSON.parse(before);assert.equal(meta.kind,'helper');assert.equal(meta.launched,false);assert.equal(meta.capabilityMeta['oats.okf'].memory,'none');
 const actualInput=JSON.parse(fs.readFileSync(join(first.home,'work/input.json')));assert.ok(actualInput.inputs.length);assert.ok(fs.existsSync(join(first.home,'work/staging.json')));assert.equal(fs.existsSync(join(first.home,'.oats-start-exited')),false);
 const again=call(argv).result;assert.equal(again.run,first.run);assert.equal(again.home,first.home);assert.deepEqual(fs.readFileSync(join(first.home,'instance.json')),before);
});
