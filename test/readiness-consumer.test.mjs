// Opt-in rehearsal against the published CLI, with isolated package/workspace
// Git remotes and deployment state. No kernel imports or model sessions.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cli=process.env.OATS_OKF_READINESS_CLI;
const root=fileURLToPath(new URL('../',import.meta.url));
const wire='oats-package/capabilities/oats-okf/lib/binding-wire.mjs';
const write=(file,text)=>{fs.mkdirSync(dirname(file),{recursive:true});fs.writeFileSync(file,text);};
const json=file=>JSON.parse(fs.readFileSync(file,'utf8'));

test('published OATS 0.62: legacy alias readiness, released negative control, and independent checkpoint capture',{skip:!cli},t=>{
  const base=fs.realpathSync(fs.mkdtempSync(join(tmpdir(),'okf-readiness-')));
  t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
  const bin=join(base,'bin'),asked=join(base,'model-start-attempted');fs.mkdirSync(bin);
  fs.symlinkSync(process.execPath,join(bin,'node'));
  fs.symlinkSync(execFileSync('sh',['-c','command -v git'],{encoding:'utf8'}).trim(),join(bin,'git'));
  for(const name of ['pi','claude','codex']) {
    write(join(bin,name),`#!/bin/sh\necho ${name} >> '${asked}'\nexit 98\n`);fs.chmodSync(join(bin,name),0o755);
  }
  const env={HOME:join(base,'user'),PATH:`${bin}:/usr/bin:/bin`,OATS_HOME_DIR:join(base,'host'),GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'};
  fs.mkdirSync(env.HOME);
  const git=(cwd,args)=>execFileSync('git',['-c','user.name=Fixture','-c','user.email=fixture@example.invalid',...args],{cwd,env,encoding:'utf8'}).trim();
  const repo=(dir,remote)=>{
    git(dir,['init','-q','-b','main']);git(dir,['add','-A']);git(dir,['commit','-qm','fixture']);
    execFileSync('git',['clone','-q','--bare',dir,remote],{env});return git(dir,['rev-parse','HEAD']);
  };
  for(const mode of ['released','patched']) {
    const dir=join(base,mode),pkg=join(dir,'pkg'),ws=join(dir,'ws'),dep=join(dir,'deployment'),state=join(dir,'state');
    fs.cpSync(join(root,'oats-package'),join(pkg,'oats-package'),{recursive:true,verbatimSymlinks:true});
    if(mode==='released') write(join(pkg,wire),execFileSync('git',['show',`v4.2.0:${wire}`],{cwd:root,encoding:'utf8'}));
    const packageCommit=repo(pkg,join(dir,'pkg.git'));
    write(join(ws,'oats-workspace.yaml'),`schemaVersion: 2\nname: readiness-fixture\nmembers:\n  - file://${dir}/ws.git\npackages:\n  oats.okf: git:file://${dir}/pkg.git@${packageCommit}\ndefaults:\n  capabilities:\n    oats.core: off\n  knowledge: { oats.okf: { from: package } }\n  messaging: none\n  tasks: none\n`);
    write(join(ws,'oats-membership.yaml'),`schemaVersion: 2\nworkspace: file://${dir}/ws.git\n`);
    write(join(ws,'souls/source/soul.yaml'),'schemaVersion: 2\nname: source\ndescription: Readiness fixture.\nwork: directory\n');
    write(join(ws,'souls/source/AGENTS.md'),'# Source\nDisposable fixture, no model.\n');
    write(join(ws,'souls/source/okf.json'),JSON.stringify({version:1,owner:'source-owner',owns:['project/expert'],reads:[]}));
    repo(ws,join(dir,'ws.git'));
    const bindingsFile=join(dir,'bindings.json');
    write(bindingsFile,JSON.stringify({version:1,stateDir:state,bases:{project:{id:'test-base',kind:'directory',path:join(dir,'accepted')}}}));
    write(join(dir,'nodes.json'),JSON.stringify({expert:{path:'expert',owner:'source-owner'}}));
    write(join(dep,'oats-local.yaml'),`schemaVersion: 2\nworkspace: file://${dir}/ws.git\nsettings:\n  oats.okf:\n    bindings-file: ${bindingsFile}\n    harvest: on\n    harvest-runtime: codex\n`);
    const oats=(args,{cwd=dep,home}={})=>{
      const out=spawnSync(process.execPath,[cli,...args,'--json'],{cwd,env:home?{...env,OATS_INSTANCE_HOME:home,OATS_HOME:home}:env,encoding:'utf8',timeout:120000,maxBuffer:16*1024*1024});
      assert.equal(out.status,0,`${args.join(' ')}\n${out.stdout}\n${out.stderr}`);
      return JSON.parse(out.stdout);
    };
    assert.equal(oats(['version']).version,'0.62.0');
    oats(['sync']);
    oats(['okf','init','--base','project','--nodes',join(dir,'nodes.json'),'--confirm','--soul','source']);
    const spawned=oats(['spawn','source','--name','readiness-seat','--no-launch','--harness','codex']).result;
    const home=spawned.home,meta=json(join(home,'instance.json')),marker=json(join(home,'.okf-source.json'));
    assert.equal(spawned.launched,false);
    assert.equal(meta.providers['oats.okf']['bindings-file'],bindingsFile);
    const installedWire=join(home,'.oats/modules/oats.okf/lib/binding-wire.mjs');
    assert.equal(fs.readFileSync(installedWire,'utf8'),fs.readFileSync(join(pkg,wire),'utf8'),'readiness uses the spawned module, not this worktree');
    const source=json(marker.source);assert.equal(source.bindings.bases.project.id,'test-base');
    const provider=oats(['readiness','--home',home]).result.checks.providers.items.find(row=>row.subject==='oats.okf');
    assert.ok(provider?.result,JSON.stringify(provider));
    assert.equal(provider.result.status,mode==='released'?'needs-configuration':'ready');
    assert.deepEqual(provider.result.problems.map(({code})=>code),mode==='released'?['needs-configuration']:[]);
    assert.deepEqual(provider.result.warnings,[]);
    write(join(home,'notes/decision.md'),'---\ntype: Decision\ntitle: Explicit custody\ndescription: Why custody is explicit.\n---\n\nThe human chose explicit custody.\n');
    const checkpoint=oats(['okf','harvest','--no-launch'],{cwd:home,home}).result;
    assert.equal(checkpoint.status,'started',JSON.stringify(checkpoint));assert.equal(checkpoint.launched,false);
    const status=json(join(dirname(marker.source),'status.json'));
    assert.equal(status.captured.inputs.length,1);assert.equal(status.activeRun,checkpoint.run);
    const run=json(join(dirname(marker.source),'runs',checkpoint.run,'run.json'));
    assert.equal(run.noLaunch,true);assert.equal(run.launch,undefined);
    assert.ok(fs.existsSync(join(run.worker.home,'instance.json')),'real kernel scaffolded the worker');
    t.diagnostic(JSON.stringify({mode,kernel:'0.62.0',provider:provider.result,sourceRegistered:true,captured:status.captured.inputs.length,workerScaffolded:true,launched:false,module:'<home>/.oats/modules/oats.okf',settings:'instance.json providers.oats.okf; host bindings-file'}));
  }
  assert.equal(fs.existsSync(asked),false,'no harness executable was invoked');
});
