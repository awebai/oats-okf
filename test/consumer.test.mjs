import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// Opt-in public boundary probe. No private kernel imports, real sessions, host
// timer installation, GitHub credentials, global config or live home is used.
const cli=process.env.OATS_OKF_CONSUMER_CLI;
const root=fileURLToPath(new URL('../',import.meta.url));
function write(p,text) {fs.mkdirSync(dirname(p),{recursive:true});fs.writeFileSync(p,text);}
function json(p,v) {write(p,JSON.stringify(v,null,2)+'\n');}
test('public CLI consumer: targeted hooks, directory worker, retirement and post-source complete dispatch',{skip:!cli},t=>{
  assert.ok(cli.startsWith('/'),'OATS_OKF_CONSUMER_CLI must be absolute');
  const base=fs.realpathSync(fs.mkdtempSync(join(tmpdir(),'okf-consumer-')));
  t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
  const context=join(base,'context'),bin=join(base,'bin'),user=join(base,'user');
  fs.mkdirSync(context);fs.mkdirSync(bin);fs.mkdirSync(user);
  fs.symlinkSync(process.execPath,join(bin,'node'));
  write(join(bin,'pi'),'#!/bin/sh\necho NO_REAL_MODEL_IN_CONSUMER_TEST >&2\nexit 98\n');fs.chmodSync(join(bin,'pi'),0o755);
  // Use only fixture executables: directory custody cannot rely on git/gh.
  const env={HOME:user,PATH:bin,OATS_HOME_DIR:join(base,'host'),LANG:'en_US.UTF-8'};
  const run=(args,cwd=context)=>{
    const r=spawnSync(process.execPath,[cli,...args],{cwd,env,encoding:'utf8',timeout:90000,maxBuffer:16*1024*1024});
    assert.equal(r.status,0,JSON.stringify(args)+'\n'+r.stdout+'\n'+r.stderr);let out;try{out=JSON.parse(r.stdout);}catch{assert.fail(r.stdout);}
    if(args[0]==='retire') return out; // native retirement JSON, not a boundary-v1 envelope
    assert.equal(out.ok,true,JSON.stringify(out));return out.result;
  };
  const cap=join(context,'.agents/capabilities/owned/oats-okf');fs.cpSync(join(root,'oats-package/capabilities/oats-okf'),cap,{recursive:true,verbatimSymlinks:true});
  const bindings=join(base,'bindings.json');json(bindings,{version:1,stateDir:join(base,'state'),bases:{project:{id:'test-base',kind:'directory',path:join(base,'accepted')}}});
  write(join(context,'oats-config.yaml'),`name: okf-consumer\ncapabilities:\n  layers:\n    knowledge:\n      capability: oats.okf\n      from: owned\n      souls:\n        source:\n          enabled: true\n          settings:\n            bindings-file: ${bindings}\n    messaging: none\n    tasks: none\n`);
  const soul=join(context,'agents/source/soul');write(join(soul,'soul.yaml'),'name: source\nwork: directory\nruntime: pi\n');write(join(soul,'AGENTS.md'),'# Source\nDomain expert for observed custody constraints.\n');fs.symlinkSync('AGENTS.md',join(soul,'CLAUDE.md'));
  json(join(soul,'okf.json'),{version:1,owner:'source-owner',owns:['project/expert'],reads:[]});
  const nodes=join(base,'nodes.json');json(nodes,{expert:{path:'expert',owner:'source-owner'}});
  assert.equal(run(['okf','init','--base','project','--nodes',nodes,'--confirm','--soul','source','--json']).status,'accepted');
  const source=run(['spawn','source','--purpose','probe','--repo',context,'--work','directory','--runtime','pi','--no-launch','--json']);
  assert.equal(source.launched,false);assert.equal(fs.lstatSync(join(source.home,'work')).isSymbolicLink(),false);
  const instructions=fs.readFileSync(join(source.home,'AGENTS.md'),'utf8');assert.doesNotMatch(instructions,/run `oats okf harvest`|harvester exists/);
  const marker=JSON.parse(fs.readFileSync(join(source.home,'.okf-source.json'),'utf8'));
  write(join(source.home,'notes','decision.md'),'---\ntype: Decision\ntitle: Explicit custody\ndescription: Why explicit custody was chosen.\n---\n\nHuman accepted explicit custody to avoid silent fallback.\n');
  const retired=run(['retire',source.instance,'--json']);assert.equal(retired.removedDir,true);assert.equal(fs.existsSync(source.home),false);
  const requested=run(['okf','run-source','--source',marker.source,'--manual','--no-launch','--soul','source','--json']);
  assert.equal(requested.status,'ready');const work=join(requested.home,'work');
  assert.equal(fs.existsSync(join(requested.home,'.okf-source.json')),false);
  const input=JSON.parse(fs.readFileSync(join(work,'input.json'),'utf8'));const id=input.inputs[0].id;
  const stage=JSON.parse(fs.readFileSync(join(work,'staging.json'),'utf8')).project.root;
  write(join(stage,'expert','decision.md'),`---\ntype: Decision\ntitle: Explicit custody\ndescription: Why explicit custody was chosen.\n---\n\nHuman accepted explicit custody to avoid silent fallback.\nEvidence: OKF input ${id}.\n`);
  fs.appendFileSync(join(stage,'expert','index.md'),'* [Explicit custody](decision.md) - Why explicit custody was chosen.\n');
  json(join(work,'judgment.json'),{version:1,exclusionsReviewed:true,outcomes:[{input:id,verdict:'promote',reason:'Accepted rationale, not a code description.',concepts:[{base:'project',path:'expert/decision.md'}]}]});
  const completed=run(['okf','complete','--source',marker.source,'--run',requested.run,'--judgment',join(work,'judgment.json'),'--soul','source','--json']);
  assert.equal(completed.receipts.project.status,'accepted');assert.equal(completed.processed,true);
  assert.equal(run(['retire',requested.instance,'--json']).removedDir,true);
  const fresh=run(['spawn','source','--purpose','fresh','--repo',context,'--work','directory','--runtime','pi','--no-launch','--json']);
  assert.match(fs.readFileSync(join(fresh.home,'knowledge/bases/project/expert/decision.md'),'utf8'),/avoid silent fallback/);
  assert.equal(run(['retire',fresh.instance,'--json']).removedDir,true);
  const schedules=run(['schedule','list','--dir',context,'--json']);assert.notEqual(schedules.scheduler.active,true);
});
