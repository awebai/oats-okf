import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, delimiter } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { initBase } from '../oats-package/capabilities/oats-okf/lib/migration.mjs';
// oats.okf 5.0.0 consultation of a Git base (a local repository, accepted
// branch main): the host cache, reads at the accepted commit, --fresh, and
// the locator/path refusals.
const ROOT=fileURLToPath(new URL('../',import.meta.url));
const CLI=join(ROOT,'oats-package/capabilities/oats-okf/bin/oats-okf.mjs');
const GIT_DIR=(process.env.PATH||'').split(delimiter).find(d=>d && fs.existsSync(join(d,'git')));
const write=(file,text)=>{fs.mkdirSync(dirname(file),{recursive:true});fs.writeFileSync(file,text);};
const json=(file,value)=>write(file,JSON.stringify(value,null,2)+'\n');
const CONCEPT='---\ntype: concept\ntitle: Decision\ndescription: The decisive concept.\n---\n\n# Decision\n\nWe chose the decisive option. See [peer](../peer/index.md) and [spec](https://example.org/spec).\n';

function fixture(t,{repository}={}) {
  const dir=fs.realpathSync(fs.mkdtempSync(join(tmpdir(),'okf5-consult-')));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const f={dir,repo:join(dir,'repo'),bindingsFile:join(dir,'deployment','okf-bindings.json'),stateDir:join(dir,'state'),
    soul:join(dir,'soul'),home:join(dir,'home'),user:join(dir,'user')};
  f.gitEnv={HOME:f.user,PATH:process.env.PATH,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'};
  f.git=(...args)=>{const r=spawnSync('git',['-C',f.repo,'-c','user.name=t','-c','user.email=t@example.invalid',...args],{env:f.gitEnv,encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
  fs.mkdirSync(f.user,{recursive:true});
  json(join(dir,'nodes.json'),{expert:{path:'expert',owner:'owner-1'},peer:{path:'peer',owner:'owner-2'}});
  const base={id:'base-1',kind:'git',root:'.',acceptedBranch:'main',pr:{repository:'example/knowledge'}};
  // Seed the accepted tree (a remote-looking locator keeps init's overlap check out of the way).
  initBase({stateDir:f.stateDir,bases:{project:{...base,repository:'https://example.invalid/knowledge.git'}}},'project',join(dir,'nodes.json'),f.repo);
  write(join(f.repo,'expert','index.md'),'# expert\n\n* [Decision](decision.md) - the decision.\n');
  write(join(f.repo,'expert','decision.md'),CONCEPT);
  spawnSync('git',['init','-q','-b','main',f.repo],{env:f.gitEnv});
  f.git('add','-A');f.git('commit','-q','-m','accepted base');
  json(f.bindingsFile,{version:1,stateDir:f.stateDir,bases:{project:{...base,repository:repository ?? f.repo}}});
  write(join(f.soul,'soul.yaml'),'schemaVersion: 2\nname: worker\nknowledge: oats.okf\n');
  json(join(f.soul,'okf.json'),{version:1,owner:'owner-1',owns:['project/expert'],reads:['project/peer']});
  json(join(f.home,'instance.json'),{name:'worker-1',kind:'agent'});
  return f;
}
function run(f,args) {
  const env={HOME:f.user,PATH:[dirname(process.execPath),GIT_DIR].filter(Boolean).join(delimiter),GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',
    OATS_SOUL:f.soul,OATS_INSTANCE_HOME:f.home,OATS_SETTINGS:JSON.stringify({'bindings-file':f.bindingsFile})};
  const r=spawnSync(process.execPath,[CLI,...args],{cwd:f.home,env,encoding:'utf8',timeout:60000});
  let out=null;try{out=JSON.parse(r.stdout);}catch{}
  return {status:r.status,stdout:r.stdout,stderr:r.stderr,out};
}

test('git base: bases primes the host cache and reports the accepted commit',t=>{
  const f=fixture(t),head=f.git('rev-parse','HEAD');
  const r=run(f,['bases','--json']);
  assert.equal(r.status,0,r.stdout+r.stderr);
  const [row]=r.out.result.bases;
  assert.equal(row.alias,'project');
  assert.equal(row.kind,'git');
  assert.equal(row.commit,head);
  assert.deepEqual(row.validated,{ok:true});
  assert.deepEqual(row.nodes,['expert','peer']);
  assert.deepEqual([row.owns,row.reads],[['expert'],['peer']]);
  assert.ok(fs.existsSync(join(f.stateDir,'cache','base-1.git')));
  const text=run(f,['bases']);
  assert.ok(text.stdout.includes(`project@${head.slice(0,12)}`),text.stdout);
});

test('git base: cat and ls read the accepted state',t=>{
  const f=fixture(t),head=f.git('rev-parse','HEAD');
  const cat=run(f,['cat','--base','project','/expert/decision.md','--json']);
  assert.equal(cat.status,0,cat.stdout);
  assert.equal(cat.out.result.text,CONCEPT);
  assert.equal(cat.out.result.receipt.commit,head);
  const ls=run(f,['ls','--base','project','/expert','--json']);
  assert.equal(ls.status,0,ls.stdout);
  assert.deepEqual(ls.out.result.entries.map(e=>e.name),['decision.md','index.md','log.md']);
  assert.deepEqual(ls.out.result.entries[0],{name:'decision.md',path:'expert/decision.md',kind:'file',type:'concept',title:'Decision',description:'The decisive concept.'});
});

test('git base: links and search read the accepted state',t=>{
  const f=fixture(t);
  const links=run(f,['links','--base','project','/expert/decision.md','--json']);
  assert.equal(links.status,0,links.stdout);
  assert.deepEqual(links.out.result.links.map(l=>[l.target,l.path ?? null,l.exists ?? null,!!l.external]),[
    ['../peer/index.md','peer/index.md',true,false],['https://example.org/spec',null,null,true]]);
  const search=run(f,['search','decisive option','--json']);
  assert.equal(search.status,0,search.stdout);
  assert.deepEqual(search.out.result.hits.map(h=>[h.base,h.path,h.line]),[['project','expert/decision.md',9]]);
});

test('git base: a new commit on main is seen with --fresh',t=>{
  const f=fixture(t);
  assert.equal(run(f,['bases','--json']).status,0);
  write(join(f.repo,'expert','later.md'),'---\ntype: concept\ntitle: Later\ndescription: Added later.\n---\n\n# Later\n');
  write(join(f.repo,'expert','index.md'),'# expert\n\n* [Decision](decision.md) - the decision.\n* [Later](later.md) - later.\n');
  f.git('add','-A');f.git('commit','-q','-m','later');
  const head=f.git('rev-parse','HEAD');
  const cached=run(f,['cat','--base','project','/expert/later.md','--json']);
  assert.equal(cached.out.error.code,'E_NOT_FOUND','within consult-max-age the cached accepted commit is served');
  const fresh=run(f,['cat','--base','project','/expert/later.md','--fresh','--json']);
  assert.equal(fresh.status,0,fresh.stdout);
  assert.match(fresh.out.result.text,/# Later/);
  assert.equal(fresh.out.result.receipt.commit,head);
});

test('git base: a repository locator embedding a credential is refused without echoing it',t=>{
  const f=fixture(t,{repository:'https://user:s3cret-token@example.invalid/knowledge.git'});
  for(const args of [['bases','--json'],['index']]) {
    const r=run(f,args);
    assert.equal(r.status,1);
    assert.doesNotMatch(r.stdout+r.stderr,/s3cret-token/);
    assert.match(r.stdout+r.stderr,/E_CONFIG/);
    assert.match(r.stdout+r.stderr,/embeds a credential/);
  }
  assert.equal(fs.existsSync(f.stateDir),false);
});

test('git base: a node path escaping the base root is refused',t=>{
  const f=fixture(t);
  for(const path of ['../x.md','/expert/../../x.md']) {
    const r=run(f,['cat','--base','project',path,'--json']);
    assert.equal(r.status,1);
    assert.equal(r.out.error.code,'E_PATH');
    assert.match(r.out.error.message,/escapes the base root/);
  }
});

test('git base: an unknown base alias is refused naming the bound bases',t=>{
  const f=fixture(t);
  const r=run(f,['cat','--base','other','/expert/index.md','--json']);
  assert.equal(r.status,1);
  assert.equal(r.out.error.code,'E_BASE_UNKNOWN');
  assert.match(r.out.error.message,/bound bases: project/);
});
