import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, delimiter } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { initBase } from '../oats-package/capabilities/oats-okf/lib/migration.mjs';
import { loadBindings } from '../oats-package/capabilities/oats-okf/lib/config.mjs';
// oats.okf 5.0.0: the working-soul CLI (oats okf) against a directory base:
// the spawn hook, inspection, consultation, provisioning, and the 4.x harvest
// surfaces that now refuse with the proposal + knowledge-harvester spawn.
const ROOT=fileURLToPath(new URL('../',import.meta.url));
const MANIFEST=join(ROOT,'oats-package/capabilities/oats-okf/oats.json');
const CLI=join(ROOT,'oats-package/capabilities/oats-okf/bin/oats-okf.mjs');
const SPAWN='oats spawn oats.okf/knowledge-harvester --task-file <proposal> --relation unrelated';
const GIT_DIR=(process.env.PATH||'').split(delimiter).find(d=>d && fs.existsSync(join(d,'git')));
const write=(file,text)=>{fs.mkdirSync(dirname(file),{recursive:true});fs.writeFileSync(file,text);};
const json=(file,value)=>write(file,JSON.stringify(value,null,2)+'\n');

/** A deployment with one directory base `project` (nodes expert, peer), a soul
 *  owning project/expert and reading project/peer, and an instance home. */
function fixture(t,{instance={name:'worker-1',kind:'agent'},okf=true}={}) {
  const dir=fs.realpathSync(fs.mkdtempSync(join(tmpdir(),'okf5-working-')));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const f={dir,deployment:join(dir,'deployment'),bindingsFile:join(dir,'deployment','okf-bindings.json'),stateDir:join(dir,'state'),
    base:join(dir,'bases','project'),nodes:join(dir,'nodes.json'),soul:join(dir,'soul'),home:join(dir,'home'),user:join(dir,'user')};
  json(f.nodes,{expert:{path:'expert',owner:'owner-1'},peer:{path:'peer',owner:'owner-2'}});
  json(f.bindingsFile,{version:1,stateDir:f.stateDir,bases:{project:{id:'base-1',kind:'directory',path:f.base}}});
  initBase(loadBindings(f.bindingsFile),'project',f.nodes,undefined,{confirm:true});
  write(join(f.soul,'soul.yaml'),'schemaVersion: 2\nname: worker\nknowledge: oats.okf\n');
  if(okf) json(join(f.soul,'okf.json'),{version:1,owner:'owner-1',owns:['project/expert'],reads:['project/peer']});
  if(instance) json(join(f.home,'instance.json'),instance); else fs.mkdirSync(f.home,{recursive:true});
  fs.mkdirSync(f.user,{recursive:true});
  return f;
}
function env(f,extra={}) {
  return {HOME:f.user,PATH:[dirname(process.execPath),GIT_DIR].filter(Boolean).join(delimiter),OATS_HOME_DIR:join(f.user,'.oats'),
    GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',OATS_SOUL:f.soul,OATS_INSTANCE_HOME:f.home,OATS_HOME:f.home,
    OATS_SETTINGS:JSON.stringify({'bindings-file':f.bindingsFile}),OATS_TEAM_SCOPE:f.deployment,...extra};
}
function run(f,args,{extra={},drop=[],cwd=f.home}={}) {
  const e=env(f,extra);for(const k of drop) delete e[k];
  const r=spawnSync(process.execPath,[CLI,...args],{cwd,env:e,encoding:'utf8',timeout:60000});
  let out=null;try{out=JSON.parse(r.stdout);}catch{}
  return {status:r.status,stdout:r.stdout,stderr:r.stderr,out};
}
const hook=(f,event,opts={})=>run(f,[event],{...opts,extra:{OATS_EVENT:event,...opts.extra}});
/** Every path (and file content) under the given roots, for no-effect checks. */
function snapshot(...roots) {
  const out={};
  const walk=p=>{if(!fs.existsSync(p)) return;const s=fs.lstatSync(p);
    if(s.isDirectory()) {out[p]='dir';for(const n of fs.readdirSync(p)) walk(join(p,n));} else out[p]=fs.readFileSync(p,'utf8');};
  for(const r of roots) walk(r);
  return out;
}

test('--help prints usage and changes nothing',t=>{
  const f=fixture(t),before=snapshot(f.home,f.stateDir,f.soul,f.base);
  const r=run(f,['--help']);
  assert.equal(r.status,0);
  assert.match(r.stdout,/oats okf inspect/);
  assert.ok(r.stdout.includes('oats spawn oats.okf/knowledge-harvester --task-file FILE --relation unrelated'));
  assert.deepEqual(snapshot(f.home,f.stateDir,f.soul,f.base),before);
});

test('spawn hook creates instance knowledge and briefs the proposal + harvester spawn',t=>{
  const f=fixture(t);
  const r=hook(f,'spawn');
  assert.equal(r.status,0,r.stdout+r.stderr);
  assert.equal(r.out.meta,undefined,'no meta: the kernel keeps meta as the receipt of external state');
  assert.ok(r.out.brief.includes(SPAWN),r.out.brief);
  assert.ok(!r.out.brief.includes('--relative-to'));
  assert.match(r.out.brief,/owns: project\/expert; reads: project\/peer/);
  assert.equal(r.out.warning,undefined);
  assert.ok(fs.statSync(join(f.home,'STATE.md')).isFile());
  assert.ok(fs.statSync(join(f.home,'log.md')).isFile());
  assert.ok(fs.statSync(join(f.home,'notes')).isDirectory());
  assert.equal(fs.existsSync(f.stateDir),false,'the spawn keeps no custody state');
});

test('a soul that opts out (knowledge: { harvest: off }) keeps consultation and working memory but gets no proposal instruction',t=>{
  const f=fixture(t);
  const r=hook(f,'spawn',{extra:{OATS_SETTINGS:JSON.stringify({'bindings-file':f.bindingsFile,harvest:'off'}),OATS_SETTINGS_ORIGINS:JSON.stringify({'/harvest':{kind:'soul',at:'soul.yaml#/knowledge'}})}});
  assert.equal(r.status,0,r.stdout+r.stderr);
  assert.equal(r.out.meta,undefined,'no meta: the kernel keeps meta as the receipt of external state');
  assert.match(r.out.brief,/oats okf index/);assert.match(r.out.brief,/okf-consultation and okf-instance-knowledge/);
  assert.match(r.out.brief,/never propose knowledge or spawn a knowledge harvester/);
  assert.doesNotMatch(r.out.brief,/oats spawn|--task-file|proposals\//);
  assert.ok(fs.statSync(join(f.home,'STATE.md')).isFile());assert.ok(fs.statSync(join(f.home,'notes')).isDirectory());
  // Its commands work as well.
  const idx=run(f,['index','--json'],{extra:{OATS_SETTINGS:JSON.stringify({'bindings-file':f.bindingsFile,harvest:'off'}),OATS_SETTINGS_ORIGINS:JSON.stringify({'/harvest':{kind:'soul',at:'soul.yaml#/knowledge'}})}});
  assert.equal(idx.status,0,idx.stdout+idx.stderr);
});

test('the shared inject and skills carry no harvest direction (only the spawn brief does)',()=>{
  const cap=join(ROOT,'oats-package/capabilities/oats-okf');
  for(const file of ['injects/okf.md','skills/okf-consultation/SKILL.md','skills/okf-instance-knowledge/SKILL.md','skills/knowledge-theory/SKILL.md']) {
    const text=fs.readFileSync(join(cap,file),'utf8');
    assert.doesNotMatch(text,/oats spawn|--task-file|--relation/,file);
    if(file!=='skills/knowledge-theory/SKILL.md') assert.doesNotMatch(text,/knowledge-harvester/,file);
  }
});

test('spawn hook keeps existing working memory',t=>{
  const f=fixture(t);
  write(join(f.home,'STATE.md'),'# mine\n');
  assert.equal(hook(f,'spawn').status,0);
  assert.equal(fs.readFileSync(join(f.home,'STATE.md'),'utf8'),'# mine\n');
});

test('spawn hook skips a capability (service) home',t=>{
  const f=fixture(t,{instance:{name:'svc',kind:'capability'}});
  const r=hook(f,'spawn');
  assert.equal(r.status,0);
  assert.equal(r.out.meta,undefined,'no meta: the kernel keeps meta as the receipt of external state');
  assert.equal(fs.existsSync(join(f.home,'STATE.md')),false);
  assert.equal(fs.existsSync(join(f.home,'notes')),false);
});

test('spawn hook fails with E_CONFIG when the soul has no okf.json',t=>{
  const f=fixture(t,{okf:false});
  const r=hook(f,'spawn');
  assert.equal(r.status,1);
  assert.deepEqual(Object.keys(r.out),['warning'],'a refusal reports no meta: nothing to undo');
  assert.match(r.out.warning,/^oats-okf E_CONFIG: soul has no okf\.json/);
  assert.equal(fs.existsSync(join(f.home,'STATE.md')),false);
});

test('spawn hook fails without OATS_SOUL',t=>{
  const f=fixture(t);
  const r=hook(f,'spawn',{drop:['OATS_SOUL']});
  assert.equal(r.status,1);
  assert.deepEqual(Object.keys(r.out),['warning'],'a refusal reports no meta: nothing to undo');
  assert.match(r.out.warning,/^oats-okf E_OATS_SOUL_MISSING: /);
  assert.equal(fs.existsSync(join(f.home,'STATE.md')),false);
});

test('soul-scaffold hook answers without creating knowledge',t=>{
  const f=fixture(t),before=snapshot(f.soul);
  const r=hook(f,'soul-scaffold');
  assert.equal(r.status,0);
  assert.deepEqual(r.out.meta,{scaffolded:false});
  assert.match(r.out.brief,/no knowledge was created in this soul/);
  assert.deepEqual(snapshot(f.soul),before);
});

test('inspect returns the declaration, bases and working-memory documents',t=>{
  const f=fixture(t);
  write(join(f.home,'STATE.md'),'# state\n');write(join(f.home,'log.md'),'# log\n');
  write(join(f.home,'notes','a.md'),'note a\n');write(join(f.home,'notes','sub','b.md'),'note b\n');write(join(f.home,'notes','skip.txt'),'not markdown\n');
  const r=run(f,['inspect','--json']);
  assert.equal(r.status,0,r.stdout);
  const x=r.out.result;
  assert.deepEqual(x.owns,['project/expert']);
  assert.deepEqual(x.reads,['project/peer']);
  assert.deepEqual(x.bases,{project:{id:'base-1',kind:'directory',path:f.base}});
  assert.deepEqual(x.documents.map(d=>[d.label,d.text]),[
    ['Working state (STATE.md)','# state\n'],['Log (log.md)','# log\n'],['Pending note: a.md','note a\n'],['Pending note: sub/b.md','note b\n']]);
  assert.match(x.summary,/owns project\/expert; 4 working-memory documents/);
});

test('index and cat consult the accepted base through the home (text and --json)',t=>{
  const f=fixture(t);
  const index=run(f,['index']);
  assert.equal(index.status,0,index.stderr);
  assert.match(index.stdout,/## project\/expert \(owns\)\n\n# expert\n/);
  assert.match(index.stdout,/## project\/peer \(reads\)\n\n# peer\n/);
  assert.match(index.stdout,/— project@dir:[0-9a-f]{12}/);
  const indexJson=run(f,['index','--json']);
  assert.deepEqual(indexJson.out.result.indexes.map(x=>[x.base,x.node,x.relation,x.path]),[['project','expert','owns','expert/index.md'],['project','peer','reads','peer/index.md']]);
  const cat=run(f,['cat','--base','project','/expert/index.md']);
  assert.equal(cat.status,0,cat.stderr);
  assert.match(cat.stdout,/^# expert\n— project@dir:/);
  const catJson=run(f,['cat','--base','project','/expert/index.md','--json']);
  assert.equal(catJson.out.ok,true);
  assert.equal(catJson.out.result.path,'expert/index.md');
  assert.equal(catJson.out.result.text,'# expert\n');
  assert.equal(catJson.out.result.receipt.kind,'directory');
});

test('init refuses an existing directory base and stages a new one with --output',t=>{
  const f=fixture(t);
  const existing=run(f,['init','--base','project','--nodes',f.nodes,'--confirm','--json']);
  assert.equal(existing.status,1);
  assert.equal(existing.out.error.code,'E_BASE');
  const stage=join(f.dir,'staged');
  const staged=run(f,['init','--base','project','--nodes',f.nodes,'--output',stage,'--json']);
  assert.equal(staged.status,0,staged.stdout);
  assert.deepEqual([staged.out.result.status,staged.out.result.path],['staged',stage]);
  assert.ok(fs.existsSync(join(stage,'okf-base.json')));
});

test('migrate --legacy, --deliver and --cutover move a legacy soul bundle into a directory base',t=>{
  const f=fixture(t),legacy=join(f.soul,'knowledge');
  write(join(legacy,'index.md'),'# Expert\n\n* [Concept](concept.md) - the concept.\n');
  write(join(legacy,'concept.md'),'---\ntype: concept\ntitle: Concept\ndescription: A migrated concept.\n---\n\n# Concept\n');
  const staged=run(f,['migrate','--legacy',legacy,'--base','project','--node','expert','--output',join(f.dir,'mstage'),'--json']);
  assert.equal(staged.status,0,staged.stdout);
  assert.equal(staged.out.result.status,'staged');
  const record=staged.out.result.migration;
  const delivered=run(f,['migrate','--deliver',record,'--json']);
  assert.equal(delivered.status,0,delivered.stdout);
  assert.equal(delivered.out.result.status,'accepted');
  assert.match(fs.readFileSync(join(f.base,'expert','concept.md'),'utf8'),/# Concept/);
  const cut=run(f,['migrate','--cutover',record,'--soul-dir',f.soul,'--json']);
  assert.equal(cut.status,0,cut.stdout);
  assert.equal(cut.out.result.status,'complete');
  assert.equal(fs.existsSync(legacy),false);
  const decl=JSON.parse(fs.readFileSync(join(f.soul,'okf.json'),'utf8'));
  assert.deepEqual(decl.owns,['project/expert']);
  assert.ok(decl.reads.includes('project/expert'));
});

test('an unknown command answers an E_USAGE envelope',t=>{
  const f=fixture(t);
  const r=run(f,['frobnicate','--json']);
  assert.equal(r.status,1);
  assert.equal(r.out.schemaVersion,1);
  assert.equal(r.out.ok,false);
  assert.equal(r.out.error.code,'E_USAGE');
  assert.match(r.out.error.message,/unknown command frobnicate/);
});

const REMOVED=[
  ['harvest',['harvest','--json']],
  ['run-source',['run-source','--json']],
  ['complete',['complete','--json']],
  ['retry',['retry','--json']],
  ['harvest-status',['harvest-status','--json']],
  ['setup --harvest on',['setup','--harvest','on','--soul','worker','--json']],
  ['setup --enable',['setup','--enable','--soul','worker','--json']],
  ['migrate --source-home',['migrate','--source-home','/somewhere','--json']],
  ['index --source',['index','--source','/somewhere','--json']],
];
for(const [name,args] of REMOVED) test(`removed surface refuses with E_REMOVED: ${name}`,t=>{
  const f=fixture(t),before=snapshot(f.home,f.stateDir);
  const r=run(f,args);
  assert.equal(r.status,1,r.stdout);
  assert.equal(r.out.ok,false);
  assert.equal(r.out.error.code,'E_REMOVED',r.out.error.message);
  assert.match(r.out.error.message,/was removed in oats\.okf 5\.0/);
  assert.ok(r.out.error.message.includes('writes a short proposal'));
  assert.ok(r.out.error.message.includes(SPAWN));
  assert.deepEqual(snapshot(f.home,f.stateDir),before);
});

test('removed surface refuses with E_REMOVED: OATS_INVOCATION_CONTEXT_FILE set',t=>{
  const f=fixture(t),before=snapshot(f.home,f.stateDir);
  const r=run(f,['inspect','--json'],{extra:{OATS_INVOCATION_CONTEXT_FILE:join(f.dir,'context.json')}});
  assert.equal(r.status,1);
  assert.equal(r.out.error.code,'E_REMOVED');
  assert.match(r.out.error.message,/OATS_INVOCATION_CONTEXT_FILE/);
  assert.ok(r.out.error.message.includes(SPAWN));
  assert.deepEqual(snapshot(f.home,f.stateDir),before);
});

test('the harvest operation still points at the harvest command, which refuses',t=>{
  const manifest=JSON.parse(fs.readFileSync(MANIFEST,'utf8'));
  assert.equal(manifest.operations.harvest.command,'harvest');
  const [bin,...args]=manifest.commands[manifest.operations.harvest.command].split(' ');
  assert.equal(join(dirname(MANIFEST),bin),CLI);
  const f=fixture(t);
  const r=run(f,[...args,'--json']);
  assert.equal(r.status,1);
  assert.equal(r.out.error.code,'E_REMOVED');
  assert.ok(r.out.error.message.includes(SPAWN));
});
