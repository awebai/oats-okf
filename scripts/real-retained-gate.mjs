#!/usr/bin/env node
// Parent-run REAL acceptance, not a production launcher or a fake worker.
// Never run by developer tests. Ordinary native harness authentication is
// inherited unchanged. No SDK/auth/key import, HOME/profile substitution,
// backend provisioning, automatic retry, native cleanup or seeded OKF run.
import fs from 'node:fs';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {dirname,join,resolve,relative,isAbsolute,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {isDeepStrictEqual as same} from 'node:util';
const KEY='oats.okf:memory-harvest';
function fail(code,message){throw Object.assign(new Error(message),{code});}
function object(v){return v!==null&&typeof v==='object'&&!Array.isArray(v);}
function closed(v,names,label){if(!object(v)||Object.keys(v).some(k=>!names.includes(k))||names.some(k=>!Object.hasOwn(v,k)))fail('E_GATE_CONFIG','invalid '+label);}
function absolute(v){return typeof v==='string'&&isAbsolute(v)&&resolve(v)===v&&!/[\r\n\0]/.test(v);}
export function within(root,path){const r=relative(root,path);return r===''||(!r.startsWith('..'+sep)&&r!=='..'&&!isAbsolute(r));}
export function validateConfig(c){
  closed(c,['schemaVersion','frameworkRoot','frameworkCommit','providerRoot','providerCommit','outputRoot','primaryLaunch','helperLaunch','backends','turnTimeoutMs','deadlineUtc'],'real gate configuration');
  if(c.schemaVersion!==1)fail('E_GATE_CONFIG','unsupported gate configuration');
  for(const k of ['frameworkRoot','providerRoot','outputRoot'])if(!absolute(c[k]))fail('E_GATE_CONFIG','normalized absolute '+k+' required');
  for(const k of ['frameworkCommit','providerCommit'])if(!/^[0-9a-f]{40}$/.test(c[k]))fail('E_GATE_CONFIG','exact Git commit required');
  if(!Number.isSafeInteger(c.turnTimeoutMs)||c.turnTimeoutMs<1000||c.turnTimeoutMs>180000)fail('E_GATE_CONFIG','turn timeout must be1s-180s');
  if(typeof c.deadlineUtc!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(c.deadlineUtc)||!Number.isFinite(Date.parse(c.deadlineUtc)))fail('E_GATE_CONFIG','explicit UTC gate deadline required');
  for(const [name,v] of [['primaryLaunch',c.primaryLaunch],['helperLaunch',c.helperLaunch]]){
    closed(v,['runtime','executable','args','env','model','yolo'],name);
    if(v.runtime!=='pi'||v.executable!==join(c.frameworkRoot,'bin/oats-pi-sdk-host.mjs')||!Array.isArray(v.args)||!object(v.env)||Object.keys(v.env).length||v.yolo!==false||typeof v.model!=='string'||!v.model.trim()||v.model.includes('\0'))fail('E_GATE_CONFIG','explicit normal-auth print host selection required');
    const expected=['--oats-pi-host','1','--mode','print','--thinking','medium','--sdk-root',v.args[7],'--sdk-version','0.85.1'];
    if(!absolute(v.args[7])||JSON.stringify(v.args)!==JSON.stringify(expected))fail('E_GATE_CONFIG','unsupported host argument grammar; coordinate actual owner interface, never substitute auth/profile');
  }
  if(!Array.isArray(c.backends)||c.backends.length!==2||c.backends[0]?.backend!=='tmux'||c.backends[1]?.backend!=='herdr')fail('E_GATE_CONFIG','explicit tmux AND Herdr endpoints, in that order, required');
  for(const b of c.backends){
    closed(b,b.backend==='tmux'?['backend','binary','socket','session']:['backend','binary','socket','protocol'],'backend');
    if(!absolute(b.binary)||!absolute(b.socket))fail('E_GATE_CONFIG','exact backend executable/socket required');
    if(b.backend==='tmux'&&(typeof b.session!=='string'||!b.session||/[\r\n\0]/.test(b.session)))fail('E_GATE_CONFIG','exact owned tmux session required');
    if(b.backend==='herdr'&&![20,22].includes(b.protocol))fail('E_GATE_CONFIG','unknown Herdr protocol; no fallback');
  }
  return structuredClone(c);
}
export function readRegular(file,max=1024*1024){
  const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
  try {const s=fs.fstatSync(fd);if(!s.isFile()||s.size>max)fail('E_GATE_FILE','bounded regular evidence required');
    const b=Buffer.alloc(s.size+1);let n=0,k;while(n<b.length&&(k=fs.readSync(fd,b,n,b.length-n,null)))n+=k;
    if(n!==s.size)fail('E_GATE_FILE','evidence size changed');return b.subarray(0,n);
  }finally{fs.closeSync(fd);}
}
const json=file=>JSON.parse(readRegular(file));
function put(file,value){fs.mkdirSync(dirname(file),{recursive:true,mode:0o700});fs.writeFileSync(file,typeof value==='string'?value:JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});}
function physical(dir){if(fs.realpathSync(dir)!==dir||!fs.lstatSync(dir).isDirectory())fail('E_GATE_PATH','physical existing directory required');}
function newRoot(c){
  physical(dirname(c.outputRoot));if(fs.lstatSync(c.outputRoot,{throwIfNoEntry:false}))fail('E_GATE_PATH','output must be new; no overwrite');
  for(const root of [c.frameworkRoot,c.providerRoot,c.primaryLaunch.args[7],c.helperLaunch.args[7]]){
    physical(root);if(within(root,c.outputRoot)||within(c.outputRoot,root))fail('E_GATE_PATH','output overlaps source/SDK');
  }
  const git=spawnSync('git',['-C',dirname(c.outputRoot),'rev-parse','--is-inside-work-tree'],{encoding:'utf8',env:{...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_OPTIONAL_LOCKS:'0'}});
  if(git.status===0)fail('E_GATE_PATH','owned acceptance root must be physically outside Git');
  fs.mkdirSync(c.outputRoot,{mode:0o700});
}
function gitIdentity(root,expected){
  const raw=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',env:{...process.env,GIT_OPTIONAL_LOCKS:'0'},maxBuffer:16*1024*1024});
  const run=(...args)=>raw(...args).trim();
  if(run('rev-parse','HEAD')!==expected||run('status','--porcelain','--untracked-files=no'))fail('E_GATE_SOURCE','source must be clean at the explicit commit');
  const tree=run('rev-parse','HEAD^{tree}'),entries=raw('ls-tree','-rz',tree).split('\0').filter(Boolean);
  for(const entry of entries){
    const at=entry.indexOf('\t'),[mode,type,oid]=entry.slice(0,at).split(' '),path=join(root,entry.slice(at+1)),stat=fs.lstatSync(path);
    if(type!=='blob')fail('E_GATE_SOURCE','unqualified source tree entry');
    const bytes=mode==='120000'?Buffer.from(fs.readlinkSync(path)):readRegular(path,32*1024*1024);
    if(mode==='120000'?!stat.isSymbolicLink():!stat.isFile()||!!(stat.mode&0o111)!==(mode==='100755'))fail('E_GATE_SOURCE','source entry type/mode differs');
    if(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')!==oid)fail('E_GATE_SOURCE','working source bytes differ from explicit Git tree');
  }
  return {commit:expected,tree,trackedEntries:entries.length,allTrackedBytesTypesModesMatch:true};
}
export function materializePinnedPayload(repository,commit,destination){
  if(!/^[0-9a-f]{40}$/.test(commit)||fs.lstatSync(destination,{throwIfNoEntry:false}))fail('E_GATE_SOURCE','exact commit and new payload destination required');
  const git=(...args)=>execFileSync('git',['--no-replace-objects','-C',repository,...args],{env:{...process.env,GIT_OPTIONAL_LOCKS:'0'},maxBuffer:32*1024*1024});
  const tree=git('rev-parse',commit+':oats-package').toString('utf8').trim();
  const entries=git('ls-tree','-rz',tree).toString('utf8').split('\0').filter(Boolean).map(entry=>{
    const at=entry.indexOf('\t'),[mode,type,oid]=entry.slice(0,at).split(' '),name=entry.slice(at+1);
    if(type!=='blob'||!['100644','100755','120000'].includes(mode)||!name||isAbsolute(name)||name.split('/').some(p=>!p||p==='.'||p==='..')||!within(destination,join(destination,name)))fail('E_GATE_SOURCE','unsupported pinned payload entry');
    return {mode,oid,name};
  });
  if(!entries.length)fail('E_GATE_SOURCE','empty pinned payload');
  fs.mkdirSync(destination,{recursive:true,mode:0o700});
  const expected=new Set();
  for(const {mode,oid,name} of entries){
    expected.add(name);for(let dir=dirname(name);dir!=='.';dir=dirname(dir))expected.add(dir+'/');
    const path=join(destination,name),bytes=git('cat-file','blob',oid);fs.mkdirSync(dirname(path),{recursive:true,mode:0o700});
    if(mode==='120000')fs.symlinkSync(bytes,path);
    else {fs.writeFileSync(path,bytes,{flag:'wx',mode:0o600});fs.chmodSync(path,mode==='100755'?0o755:0o644);}
  }
  // Verify the materialized inventory, raw blob bytes, symlinks and executable
  // modes against the PINNED tree before Git add / preparation / approval.
  const actual=[];
  const walk=dir=>{for(const name of fs.readdirSync(join(destination,dir))){const key=dir?dir+'/'+name:name,path=join(destination,key),s=fs.lstatSync(path);if(s.isDirectory()){actual.push(key+'/');walk(key);}else actual.push(key);}};
  walk('');if(JSON.stringify(actual.sort())!==JSON.stringify([...expected].sort()))fail('E_GATE_SOURCE','materialized payload inventory differs');
  for(const {mode,oid,name} of entries){
    const path=join(destination,name),s=fs.lstatSync(path);
    if(mode==='120000'?!s.isSymbolicLink():!s.isFile()||!!(s.mode&0o111)!==(mode==='100755'))fail('E_GATE_SOURCE','materialized payload type/mode differs');
    const bytes=mode==='120000'?fs.readlinkSync(path,{encoding:'buffer'}):readRegular(path,32*1024*1024);
    if(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')!==oid)fail('E_GATE_SOURCE','materialized payload bytes differ');
  }
  return {commit,subtree:'oats-package',tree,trackedEntries:entries.length,exactMaterializedInventoryBytesTypesModes:true};
}
export function gateExitCode(status){return status==='passed'?0:status==='partial-completion-evidence'?2:1;}
export function nativeGateEnvironment(inherited,root){
  const env={...inherited};for(const key of Object.keys(env))if(/^(OATS_|OAS_|PI_AGENT_)/.test(key)||key==='PI_AGENTS_ROOT')delete env[key];
  return {...env,OATS_HOME_DIR:join(root,'oats-state'),TURN_RECORD_ROOT:join(root,'record-store')};
}
export function waitForExit(home,id,timeoutMs){
  // Existing native wrapper writes this exact admitted execution ID after the
  // REAL command exits. It is correlation, NOT proof of successful auth/model.
  return new Promise((accept,reject)=>{
    const path=join(home,'.oats-start-exited');let watcher,timer,settled=false;
    const finish=(error)=>{if(settled)return;settled=true;watcher?.close();clearTimeout(timer);error?reject(error):accept({executionId:id,exitObserved:true,exitStatusAvailable:false});};
    const check=()=>{try{if(readRegular(path,4096).toString('utf8').trim()===id)finish();}catch(e){if(!['ENOENT','ENOTDIR'].includes(e.code))finish(e);}};
    try{watcher=fs.watch(home,check);watcher.on('error',finish);timer=setTimeout(()=>finish(Object.assign(new Error('real native print exit was not observed before deadline; preserve home/backend'),{code:'E_GATE_TURN_TIMEOUT'})),timeoutMs);check();}catch(e){finish(e);}
  });
}
export function verifyTurnEvidence(capture,recalls,{home,root,nonce,completion}){
  if(!object(capture)||capture.home!==home||capture.complete!==true||!Array.isArray(capture.sessions)||!capture.sessions.length)fail('E_REAL_CAPTURE','complete attributed native capture required');
  const roles=[],sessions=completion?.qualified?capture.sessions.filter(s=>s.path===completion.sessionFile&&s.sessionId===completion.sessionId&&s.cwd===home):capture.sessions;
  if(completion?.qualified&&sessions.length!==1)fail('E_REAL_CAPTURE','qualified SDK session must correspond to exactly one actual captured session');
  for(const s of sessions){
    if(s.source!=='pi'||!absolute(s.path)||!within(root,s.path))fail('E_REAL_CAPTURE','native session outside owned Pi history');
    const reply=recalls.find(r=>r.thread===s.thread)?.value;
    if(!reply||!Array.isArray(reply.turns)||!reply.turns.length)fail('E_REAL_CAPTURE','captured thread has no actual recall turns');
    for(const turn of reply.turns){
      if(turn.thread!==s.thread||turn.kind!=='session'||turn.source!=='pi'||!Array.isArray(turn.text))fail('E_REAL_CAPTURE','wrong native turn correspondence');
      roles.push(...turn.text.filter(x=>typeof x.role==='string'&&typeof x.text==='string'));
    }
  }
  if(!roles.some(x=>x.role==='user'&&x.text.includes(nonce))||!roles.some(x=>x.role==='assistant'&&x.text.includes(nonce)))fail('E_REAL_MODEL_TURN','actual user AND assistant nonce-bearing native turns required; exit marker alone is not model proof');
  return {realNativeUserTurn:true,realNativeAssistantTurn:true,sessionCount:capture.sessions.length,nonce};
}

export function outcomeInspectArgs(sourceBinding,dispatch,helper=false){
  if(!absolute(dispatch?.home)||!/^([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/.test(dispatch.nativeRecordId??''))fail('E_REAL_OUTCOME','original dispatch home/native record ID required; no private lookup');
  return ['session','inspect','--deployment',sourceBinding.deployment,'--resolution',sourceBinding.resolution.id,...(helper?['--helper',KEY]:[]),'--home',dispatch.home,'--native-record',dispatch.nativeRecordId,'--json'];
}
export function assessNativeOutcome(query,{home,root,sourceBinding,dispatch,launch,helper=false}){
  const o=query?.outcome,a=o?.authority,split=launch.model.indexOf('/');
  const selected={runtime:launch.runtime,provider:launch.model.slice(0,split),id:launch.model.slice(split+1),sdkVersion:launch.args[9]}; // colon/slashes in the opaque ID stay literal
  if(o?.schemaVersion!==1||o.contract!=='oats.pi-print-completion'||o.nonAuthorizing!==true||!['succeeded','failed','incomplete'].includes(o.status)||typeof o.qualified!=='boolean'||typeof o.finalObserved!=='boolean')fail('E_REAL_OUTCOME','unsupported public completion observation');
  if(split<1||!a||home!==dispatch.home||a.home!==home||a.nativeRecordId!==dispatch.nativeRecordId||a.incarnationId!==dispatch.incarnationId||!same(a.intent,dispatch.intent)||!same(a.executionBinding,dispatch.executionBinding)||!same(query.executionBinding,dispatch.executionBinding)||!same(a.target,dispatch.target)||!same(a.selected,selected)||!absolute(a.sessionDir)||!within(root,a.sessionDir))fail('E_REAL_OUTCOME','completion does not belong to the original selected dispatch');
  if(helper?(!same(query.sourceExecutionBinding,sourceBinding)||!same(query.helper,dispatch.helper)):(!same(query.executionBinding,sourceBinding)||Object.hasOwn(query,'helper')||Object.hasOwn(query,'sourceExecutionBinding')))fail('E_REAL_OUTCOME','completion SOURCE/helper edge differs');
  for(const value of [o.processExitCode,o.sdkExitCode])if(value!==null&&(!Number.isInteger(value)||value<0||value>255))fail('E_REAL_OUTCOME','missing/invalid actual process or SDK status');
  if(o.status==='failed'||[o.processExitCode,o.sdkExitCode].some(value=>value!==null&&value!==0))fail('E_REAL_NATIVE_FAILURE','native process or SDK execution failed; not partial success');
  const s=o.sdk,f=s?.finalAssistant;
  const complete=o.status==='succeeded'&&o.qualified===true&&o.processExitCode===0&&o.sdkExitCode===0&&o.finalObserved===true
    &&o.evidence?.process===true&&o.evidence.sdk===true&&o.evidence.sessionFile===true
    &&s?.sdkVersion===selected.sdkVersion&&s.header?.type==='session'&&s.header.version===3&&s.header.cwd===home&&typeof s.sessionId==='string'&&s.sessionId.length>0&&s.header.id===s.sessionId
    &&absolute(s.sessionFile)&&dirname(s.sessionFile)===a.sessionDir&&s.sessionFile.endsWith('.jsonl')&&same(s.model,{provider:selected.provider,id:selected.id})
    &&f?.provider===selected.provider&&f.model===selected.id&&f.stopReason==='stop'&&typeof f.entryId==='string'&&f.entryId.length>0;
  if((o.qualified||o.status==='succeeded')&&!complete)fail('E_REAL_OUTCOME','claimed completion lacks corresponding actual observations');
  return {qualified:!!complete,status:o.status,nativeRecordId:a.nativeRecordId,processExitCode:o.processExitCode,sdkExitCode:o.sdkExitCode,sessionId:s?.sessionId??null,sessionFile:s?.sessionFile??null};
}
export function completionObservationLimits(subjects=[]){
  if(subjects.length===4&&subjects.every(s=>s.completion?.qualified===true))return [];
  return [
    {scope:'native host process success',status:'not-observed',reason:'not all four original dispatches have qualified public outcomes; the ID-only marker has no exit status'},
    {scope:'SDK header and successful final assistant outcome',status:'not-established',reason:'missing/incomplete public observations cannot supply a final stop reason from recalled nonce text'}
  ];
}

export async function runRealGate(config,{executeReal=false}={}){
  if(!executeReal)fail('E_REAL_OPT_IN','parent must explicitly invoke --execute-real; developers must not run live gate');
  const c=validateConfig(config),deadline=Date.parse(c.deadlineUtc),root=c.outputRoot;
  if(Date.now()>=deadline)fail('E_GATE_DEADLINE','fixed parent gate deadline has elapsed');
  const before={framework:gitIdentity(c.frameworkRoot,c.frameworkCommit),provider:gitIdentity(c.providerRoot,c.providerCommit)};
  newRoot(c);
  const result={schemaVersion:1,kind:'real-retained-primary-source-helper-acceptance',status:'running',source:before,startedAt:new Date().toISOString(),backends:[],holds:[],currentStage:'initialization'};
  const save=()=>fs.writeFileSync(join(root,'result.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600});
  const stage=name=>{result.currentStage=name;save();};
  // Authentication/profile variables are neither read semantically nor logged,
  // replaced or copied to files. Only OATS caller selectors and the separate
  // OATS/record data stores are isolated. HOME/native profile stay inherited.
  const inherited={...process.env},env=nativeGateEnvironment(inherited,root);
  fs.mkdirSync(env.OATS_HOME_DIR);fs.mkdirSync(env.TURN_RECORD_ROOT);
  const cli=join(c.frameworkRoot,'bin/oats.mjs');
  const budget=()=>{const left=deadline-Date.now();if(left<=0)fail('E_GATE_DEADLINE','fixed parent deadline elapsed; preserve evidence');return Math.min(left,c.turnTimeoutMs);};
  let serial=0;
  function call(args,{native=false}={}){
    const run=spawnSync(process.execPath,[cli,...args],{cwd:join(root,'deployment'),env,encoding:'utf8',timeout:budget(),maxBuffer:16*1024*1024});
    let value;try{value=JSON.parse(run.stdout);}catch{}
    // Never save arbitrary error/auth output or environment. Preserve bounded
    // process diagnostics and typed error, leaving native auth failure to user.
    put(join(root,'calls',String(++serial).padStart(3,'0')+'.json'),{args,status:run.status,signal:run.signal,errorCode:run.error?.code??null,stdoutBytes:Buffer.byteLength(run.stdout||''),stderrBytes:Buffer.byteLength(run.stderr||''),error:value?.error?.code??null});
    if(run.error||run.status!==0||!value||(!native&&(value.schemaVersion!==1||value.ok!==true)))fail(value?.error?.code||'E_GATE_COMMAND','public command failed at '+result.currentStage+'; preserve caller/native evidence');
    return native?value:value.result;
  }
  try {
    // Scope synchronous exported preparation/hook APIs as well as CLI children;
    // every native auth/profile variable remains byte-for-byte inherited.
    for(const key of Object.keys(process.env))delete process.env[key];Object.assign(process.env,env);
    stage('prepare-default-OKF-retained-source');
    const deployment=join(root,'deployment'),repo=join(root,'source'),homes=join(root,'homes');fs.mkdirSync(deployment);fs.mkdirSync(homes);
    const settings={'bindings-file':join(root,'bindings.json'),'state-dir':join(root,'okf-state'),'harvest-runtime':'pi','harvest-model':c.helperLaunch.model};
    put(join(repo,'oats.yaml'),{schemaVersion:1,exports:{souls:[{path:'agents/gate',definition:'agents/gate/soul.yaml'}]}});
    put(join(repo,'agents/gate/soul.yaml'),{schemaVersion:1,name:'gate',work:'directory',runtime:'pi',requires:{knowledge:{capability:'oats.okf',source:'repo:packages/okf',settings}},knowledge:{contract:'oats.okf.locations',version:1,payload:{owner:'gate-owner',stores:{private:{fixed:{id:'gate-kb',kind:'directory',path:'path:'+join(root,'accepted')}}},reads:[],owns:[{node:'gate',destination:'private'}]}}});
    put(join(repo,'agents/gate/AGENTS.md'),'# Retained real acceptance source\nPerform only the controlled acceptance task. Do not inspect credentials, auth/profile files or environment; native harness authentication is user-managed. Never write accepted knowledge directly.\n');
    fs.symlinkSync('AGENTS.md',join(repo,'agents/gate/CLAUDE.md'));
    const payload=materializePinnedPayload(c.providerRoot,c.providerCommit,join(repo,'packages/okf'));
    put(join(root,'provider-payload.json'),payload);
    const gitConfig=join(root,'gitconfig');put(gitConfig,'');
    const gitEnv=Object.fromEntries(Object.entries(env).filter(([key])=>!key.startsWith('GIT_')));
    Object.assign(gitEnv,{GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:gitConfig,GIT_CONFIG_SYSTEM:'/dev/null',GIT_TERMINAL_PROMPT:'0',GIT_ALLOW_PROTOCOL:'file'});
    const git=(...args)=>execFileSync('git',['-C',repo,...args],{env:gitEnv,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
    git('init','--quiet','--initial-branch=gate');git('config','user.name','Acceptance fixture');git('config','user.email','gate@example.invalid');
    git('config','uploadpack.allowFilter','true');git('config','uploadpack.allowAnySHA1InWant','true');
    const source='git:https://example.invalid/retained-real-gate.git';git('config','--file',gitConfig,'url.'+pathToFileURL(repo).href+'.insteadOf',source.slice(4));
    git('add','-A');git('commit','--quiet','-m','actual provider retained acceptance source');
    const p=await import(pathToFileURL(join(c.frameworkRoot,'lib/core.mjs'))),r=await import(pathToFileURL(join(c.frameworkRoot,'lib/captured-resolutions.mjs')));
    const input={deployment,source:{source,soul:'agents/gate',revision:git('rev-parse','HEAD'),alias:'gate-primary'},launch:c.primaryLaunch,helperLaunches:{[KEY]:c.helperLaunch}};
    const options={repositoryOptions:{environment:gitEnv,allowLocalGit:true}};
    const pending=p.prepareCapturedComposition(input,options);
    if(pending.selections?.length!==1)fail('E_GATE_PROFILE','unexpected selected artifact set; no automatic extra approval');
    p.approveAvailableCapability(deployment,pending.selections[0].artifactSet,'oats.okf',{kind:'operator',document:{kind:'operator',id:'parent-real-acceptance'},pointer:'/approval'});
    const prepared=p.prepareCapturedComposition(input,options);if(prepared.status!=='prepared')fail('E_GATE_PREPARE','actual retained preparation not ready');
    const record=r.readCapturedResolution(deployment,prepared.resolution),helper=p.resolveCapturedHelper({executionBinding:prepared.executionBinding,helper:KEY});
    for(const binding of [prepared.executionBinding,helper.executionBinding]){
      const loaded=p.loadCapturedDispatch({deployment:binding.deployment,resolution:binding.resolution,action:{kind:'inspect'}});
      const requirements=p.applicableRequirements('pi',[...loaded.capabilities.values()]);
      if(loaded.record.dispatch.runtimePackages.length||requirements.length)fail('E_REQUIRED_RUNTIME_PACKAGE','selected plugin/bridge/runtime requirement cannot be dropped for zero-plugin gate');
      put(join(root,binding===prepared.executionBinding?'primary-retained.json':'helper-retained.json'),{executionBinding:binding,requirements,runtimePackages:loaded.record.dispatch.runtimePackages,subject:loaded.record.subject,launch:loaded.record.dispatch.launch});
    }
    const loaded=p.loadCapturedDispatch({deployment,resolution:prepared.resolution,action:{kind:'inspect'}}),cap=loaded.manifests.get('oats.okf')._dir;
    const {initBase}=await import(pathToFileURL(join(cap,'lib/migration.mjs')));
    const {hash:inputHash}=await import(pathToFileURL(join(cap,'lib/io.mjs')));
    const nodes=join(root,'nodes.json');put(nodes,{gate:{path:'gate',owner:'gate-owner'}});
    initBase(record.bindings.knowledge.payload.runtime.bindings,'gate-kb',nodes,undefined,{confirm:true}); // real operator bootstrap, not captured setup/learning.
    result.prepared={source:prepared.executionBinding,helper:helper.executionBinding};save();
    fs.rmSync(repo,{recursive:true});
    for(const [name,text] of [['oats-config.yaml','poisoned current config: not authority\n'],['oats-lock.json','poisoned current lock\n']]){
      const file=join(deployment,name),fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_TRUNC|fs.constants.O_NOFOLLOW,0o600);
      try{fs.writeFileSync(fd,text);}finally{fs.closeSync(fd);}
    }
    const flags=['--deployment',deployment,'--resolution',prepared.resolution.id];
    function observeCompletion(row,launch,helper,label){
      const query=call(outcomeInspectArgs(prepared.executionBinding,row.dispatch,helper));
      put(join(root,label+'-outcome.json'),query); // public bounded nonsecret observation, never private receipt reads
      row.completion=assessNativeOutcome(query,{home:row.home,root,sourceBinding:prepared.executionBinding,dispatch:row.dispatch,launch,helper});save();
    }
    function captureRealTurn(home,nonce,label,completion){
      const captured=call(['capture','--home',home,'--root',env.TURN_RECORD_ROOT,'--quiet'],{native:true}),recalls=[];
      for(const session of captured.sessions||[]){
        const turns=[],pages=[];let after=null;
        for(let page=0;page<40;page++){
          const value=call(['recall','--thread',session.thread,'--until',session.lastTurnId,'--limit','60',...(after?['--after',after]:[]),'--root',env.TURN_RECORD_ROOT,'--json'],{native:true});
          if(!Array.isArray(value.turns)||!value.turns.length)fail('E_REAL_CAPTURE','empty/non-progressing real record page');
          pages.push(value);turns.push(...value.turns);const last=value.turns.at(-1).id;
          if(last===after)fail('E_REAL_CAPTURE','record page did not progress');after=last;
          if(value.remaining===0||after===session.lastTurnId)break;
        }
        if(after!==session.lastTurnId)fail('E_REAL_CAPTURE','bounded record read did not reach captured boundary');
        recalls.push({thread:session.thread,value:{turns},pages});
      }
      const evidence=verifyTurnEvidence(captured,recalls,{home,root,nonce,completion});
      put(join(root,label+'-capture.json'),captured);put(join(root,label+'-turns.json'),recalls);return evidence;
    }
    for(const backend of c.backends){
      const batch={backend:backend.backend,subjects:[]};result.backends.push(batch);
      for(const kind of ['primary']){
        const home=join(homes,backend.backend+'-'+kind),binding=prepared.executionBinding;
        stage(backend.backend+':primary:public-scaffold-hooks');
        const scaffold=call(['spawn','gate-primary','--deployment',binding.deployment,'--resolution',binding.resolution.id,'--home',home,'--no-launch','--json']);
        const metadata=json(join(home,'instance.json'));if(metadata.capabilityMeta?.['oats.okf']?.memory!=='okf-v2')fail('E_GATE_PROFILE','actual OKF hook/profile missing');
        const nonce='real-retained-'+randomUUID();
        const task=`This is a bounded REAL runtime acceptance turn. Do not inspect credentials, native profiles or environment. In one short paragraph state why a retained path alone does not prove the original filesystem object's identity. Keep it as a candidate observation, not accepted knowledge. Include ${nonce} literally in your final assistant answer. Do not launch workers, alter accepted knowledge, or retire yourself.`;
        const request=join(root,backend.backend+'-'+kind+'-request.json');put(request,{schemaVersion:1,backend,task});
        const row={kind,home,incarnationId:scaffold.incarnationId,nonce};batch.subjects.push(row);
        stage(backend.backend+':'+kind+':real-public-native-start');
        const started=call(['session','start',...flags,...(kind==='helper'?['--helper',KEY]:[]),'--home',home,'--request',request,'--json']);
        if(started.incarnationId!==scaffold.incarnationId||started.executionBinding.resolution.id!==binding.resolution.id||(kind==='helper'&&started.sourceExecutionBinding?.resolution.id!==prepared.resolution.id))fail('E_GATE_CUSTODY','actual dispatch differs from retained source/helper incarnation');
        row.dispatch=started;save();
        stage(backend.backend+':'+kind+':await-actual-print-exit');row.exit=await waitForExit(home,started.intent.executionId,budget());
        stage(backend.backend+':primary:public-native-completion');observeCompletion(row,c.primaryLaunch,false,backend.backend+'-primary');
        stage(backend.backend+':'+kind+':real-native-capture-recall');
        row.turn=captureRealTurn(home,nonce,backend.backend+'-primary',row.completion);
        stage(backend.backend+':admitted-automatic-OKF-worker');
        const endpoint=join(root,backend.backend+'-worker-endpoint.json');put(endpoint,{schemaVersion:1,backend});
        const operation=call(['operation','run','knowledge:harvest',...flags,'--home',home,'--arg','native-request='+endpoint,'--arg','worker-mode=launch','--json']);
        const worker=operation.result;
        if(!worker?.run||!absolute(worker.home)||!within(root,worker.home)||!worker.launch?.intent?.executionId||worker.launch.sourceExecutionBinding?.resolution.id!==prepared.resolution.id||worker.launch.executionBinding?.resolution.id!==helper.executionBinding.resolution.id)fail('E_REAL_WORKER','no actual registered SOURCE-worker dispatch receipt');
        const helperMeta=json(join(worker.home,'instance.json'));
        if(helperMeta.capabilityMeta?.['oats.okf']?.memory!=='none'||helperMeta.incarnationId!==worker.launch.incarnationId)fail('E_REAL_WORKER','actual helper recursion/incarnation correspondence failed');
        const workerRow={kind:'automatic-worker',home:worker.home,run:worker.run,dispatch:worker.launch};batch.subjects.push(workerRow);save();
        stage(backend.backend+':automatic-worker:actual-print-exit');workerRow.exit=await waitForExit(worker.home,worker.launch.intent.executionId,budget());
        stage(backend.backend+':automatic-worker:public-native-completion');observeCompletion(workerRow,c.helperLaunch,true,backend.backend+'-automatic-worker');
        stage(backend.backend+':automatic-worker:real-turn-and-completion');workerRow.turn=captureRealTurn(worker.home,worker.run,backend.backend+'-automatic-worker',workerRow.completion);
        const sourceFile=metadata.capabilityMeta['oats.okf'].source,source=json(sourceFile),run=json(join(dirname(sourceFile),'runs',worker.run,'run.json')),status=json(join(dirname(sourceFile),'status.json'));
        if(run.source!==source.id||run.id!==worker.run||run.worker?.home!==worker.home||run.status!=='processed'||!run.judgment||!run.inputs?.length||!run.inputs.every(id=>status.processed.includes(id))||!Object.values(run.receipts||{}).length||!Object.values(run.receipts).every(r=>['accepted','no-change'].includes(r.status)))fail('E_REAL_LEARNING','actual worker judgment/publication receipt did not complete');
        workerRow.learning={actualRun:run.id,processed:true,judgment:run.judgment,receipts:run.receipts,acceptedChange:Object.values(run.receipts).some(r=>r.status==='accepted'),remainingInputs:status.captured.inputs.filter(id=>!status.processed.includes(id)).length};
        if(kind==='primary'){
          stage(backend.backend+':primary:actual-OKF-final-capture-HOOK-not-retirement');
          const old={...process.env};try{
            for(const k of Object.keys(process.env))delete process.env[k];Object.assign(process.env,env);
            const receipt=p.runCapturedLifecycleHooks('retire',{deployment,resolution:prepared.resolution,home,instance:scaffold.instance,agentName:'gate-primary'});
            const sourceFile=metadata.capabilityMeta['oats.okf'].source,status=json(join(dirname(sourceFile),'status.json'));
            if(receipt.meta?.['oats.okf']?.capture?.complete!==true||!status.captured.inputs.length)fail('E_REAL_OKF_CAPTURE','actual OKF durable input capture not complete');
            const inputs=status.captured.inputs.map(id=>{const value=json(join(dirname(sourceFile),'inputs',id+'.json'));if(inputHash(value)!==id)fail('E_REAL_OKF_CAPTURE','durable provider input hash mismatch');return {id,value};});
            if(!inputs.some(x=>x.value.kind==='record'&&JSON.stringify(x.value).includes(nonce)))fail('E_REAL_OKF_CAPTURE','native turn not found in real durable provider inputs');
            row.okf={sourceFile,actualDurableInputs:inputs.map(x=>x.id),finalCaptureHook:receipt,publicRetirement:false};
          }finally{for(const k of Object.keys(process.env))delete process.env[k];Object.assign(process.env,old);}
        }
        save();
      }
    }
    // Only actual correlated public outcomes plus the preceding genuine capture/
    // worker/judgment checks can qualify this scoped cycle. Missing stays partial.
    const missing=completionObservationLimits(result.backends.flatMap(b=>b.subjects));
    result.holds.push(...missing,{scope:'replay/distinct restart/independent curriculum checks/public retirement/recovery/private-provider/interactive/plugin/scheduled/always-on harvesting',status:'not-qualified'});
    result.status=missing.length?'partial-completion-evidence':'passed';result.currentStage=missing.length?'real-worker-learning-observed-host-completion-unqualified':'scoped-native-completion-capture-learning-observed';save();
    return result;
  }catch(e){result.status='failed';result.failure={stage:result.currentStage,code:e.code||'E_GATE',message:'real acceptance stage did not complete; preserve all source/home/history/receipts; no automatic retry'};save();throw e;}
  finally{
    // No cleanup. Source/SDK/account/native histories remain untouched or retained.
    try{result.sourceAfter={framework:gitIdentity(c.frameworkRoot,c.frameworkCommit),provider:gitIdentity(c.providerRoot,c.providerCommit)};result.sourceUnchanged=JSON.stringify(result.sourceAfter)===JSON.stringify(before);}catch{result.sourceUnchanged=false;result.status='failed-source-drift';}
    save();
    for(const key of Object.keys(process.env))delete process.env[key];Object.assign(process.env,inherited);
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{
    const [mode,file,...extra]=process.argv.slice(2);if(extra.length||!['--check-config','--execute-real'].includes(mode)||!absolute(file))fail('E_GATE_USAGE','use --check-config ABS_JSON or PARENT ONLY --execute-real ABS_JSON');
    const config=validateConfig(json(file));
    if(mode==='--check-config')console.log(JSON.stringify({ok:true,kind:'configuration-shape-only',nativeExecution:false}));
    else {const result=await runRealGate(config,{executeReal:true});console.log(JSON.stringify({status:result.status,resultFile:join(config.outputRoot,'result.json'),holds:result.holds}));process.exitCode=gateExitCode(result.status);}
  }catch(e){console.error(JSON.stringify({ok:false,code:e.code||'E_GATE',message:'acceptance refused/failed; inspect retained nonsecret evidence; no automatic retry or credential action'}));process.exitCode=1;}
}
