import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
// oats.okf 5.0.0: harvest PRs carry a version 2 provenance block (no run or
// input ids); 4.x version 1 PRs stay reviewable. PR metadata is data, never run.
const {parseProvenance}=await import(new URL('../oats-package/capabilities/oats-okf-maintenance/lib/provenance.mjs',import.meta.url));
const {reviewContext,notifyHarvester}=await import(new URL('../oats-package/capabilities/oats-okf-maintenance/bin/okf-maintenance.mjs',import.meta.url));
const HEX='0123456789abcdef'.repeat(4),URL_='https://github.com/acme/kb/pull/7';
const block=v=>`Harvested claims.\n\n\`\`\`okf-harvest\n${JSON.stringify(v,null,2)}\n\`\`\`\n`;
const source={soul:'source',owner:'owner-1',instance:'source-1',ownedNodes:['kb/expert','kb/peer'],readNodes:['kb/peer'],bases:[{alias:'kb',id:'kb-1',kind:'git',root:'.',repository:'acme/kb'}]};
const V2={version:2,source,evidence:[{note:'notes/decisions/a.md',sha256:HEX},{note:'notes/b.md'}],tasks:{provider:'oats.jira',refs:['ABC-1']},harvester:{instance:'harvester-1',alias:'harv'}};
const V1={version:1,run:'7c9e6679-7425-40de-944b-e07fc1f90ae7',input:[HEX,'f'.repeat(64)],source:{soul:'source',soulId:'agents/source/soul',owner:'owner-1',instance:'source-1',ownedNodes:['kb/expert'],readNodes:[],bases:[{alias:'kb',id:'kb-1',kind:'git',root:'.'}]},tasks:{provider:null,refs:[]},harvester:{instance:'okf-harvest-source-1-20250101',alias:null}};
const problems=v=>parseProvenance(block(v)).problems;
const pr=(body,extra={})=>({number:7,url:URL_,state:'OPEN',isDraft:false,headRefName:'okf-harvest/source-1-20260101-1200',headRefOid:'a'.repeat(40),baseRefName:'main',labels:[{name:'okf-harvest'}],body,...extra});
const view=(p)=>(ref)=>{assert.equal(ref.url,URL_);return p;};

test('a realistic 4.x version 1 block still parses',()=>{
  const r=parseProvenance(block(V1));assert.equal(r.valid,true,r.problems.join('; '));assert.deepEqual(r.value,V1);
});

test('a version 2 block parses; version 3 is refused',()=>{
  const r=parseProvenance(block(V2));assert.equal(r.valid,true,r.problems.join('; '));assert.deepEqual(r.value,V2);
  assert.deepEqual(problems({...V2,evidence:[]}),[]);
  assert.deepEqual(parseProvenance(block({...V2,version:3})),{valid:false,problems:['version must be 1 or 2'],value:null});
});

test('version 2 refuses run/input keys, a missing owner, unknown keys and bad evidence',()=>{
  assert.match(problems({...V2,run:V1.run}).join(),/unknown key "run"/);
  assert.match(problems({...V2,input:V1.input}).join(),/unknown key "input"/);
  assert.match(problems({...V2,extra:1}).join(),/provenance: unknown key "extra"/);
  assert.match(problems({...V2,source:{...source,soulId:'x'}}).join(),/source: unknown key "soulId"/);
  assert.match(problems({...V2,harvester:{...V2.harvester,home:'/h'}}).join(),/harvester: unknown key "home"/);
  const {owner,...noOwner}=source;
  assert.match(problems({...V2,source:noOwner}).join(),/source\.owner must be/);
  assert.match(problems({...V2,source:{...source,owner:null}}).join(),/source\.owner must be/);
  for(const note of ['notes/../secret.md','notes/./a.md','./notes/a.md','notes//a.md','/notes/a.md','/home/u/notes/a.md','notes/a.txt','notes/a','STATE.md','log.md','other/a.md','notes/sub/../../x.md'])
    assert.match(problems({...V2,evidence:[{note}]}).join(),/evidence must be/,note);
  for(const sha256 of ['A'.repeat(64),'0'.repeat(63),'g'.repeat(64),'',HEX+'0']) assert.match(problems({...V2,evidence:[{note:'notes/a.md',sha256}]}).join(),/evidence must be/,sha256);
  assert.match(problems({...V2,evidence:[{note:'notes/a.md',path:'x'}]}).join(),/evidence must be/);
  assert.match(problems({...V2,evidence:'notes/a.md'}).join(),/evidence must be/);
  assert.match(problems({...V2,evidence:Array.from({length:101},(_,i)=>({note:`notes/n${i}.md`}))}).join(),/evidence must be/);
  assert.deepEqual(problems({...V2,evidence:Array.from({length:100},(_,i)=>({note:`notes/n${i}.md`}))}),[]);
});

test('version 2 publishes no machine path: a base repository is its GitHub owner/repo',()=>{
  const withRepo=repository=>problems({...V2,source:{...source,bases:[{...source.bases[0],repository}]}}).join();
  assert.equal(withRepo('acme/kb'),'');
  for(const repository of ['/tmp/okf/knowledge.git','/home/u/kb.git','./kb','../..','file:///srv/kb.git','https://github.com/acme/kb.git','git@github.com:acme/kb.git','C:\\kb','acme/kb/extra'])
    assert.match(withRepo(repository),/repository must be the GitHub owner\/repo/,repository);
  // A 4.x (v1) block keeps its old shape: its repository string is not re-judged.
  assert.equal(parseProvenance(block({...V1,source:{...V1.source,bases:[{...V1.source.bases[0],repository:'https://github.com/acme/kb.git'}]}})).valid,true);
});

test('review-context for a v2 PR returns its evidence and a reading line naming the notes',()=>{
  const r=reviewContext({pr:URL_},{},{view:view(pr(block(V2)))});
  assert.equal(r.provenance.valid,true);assert.deepEqual(r.evidence,V2.evidence);assert.deepEqual(r.harvester,V2.harvester);
  assert.ok(r.reading.includes(`the claims and their evidence are in the PR body; the harvester relied on: notes/decisions/a.md (sha256 ${HEX.slice(0,12)}), notes/b.md (not read)`),r.reading.join('\n'));
  const old=reviewContext({pr:URL_},{},{view:view(pr(block(V1)))});
  assert.equal(old.provenance.valid,true);assert.equal(old.evidence,null);assert.ok(!old.reading.some(l=>/relied on/.test(l)));
});

function git(cwd,...args) {return execFileSync('git',args,{cwd,encoding:'utf8',env:{...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',GIT_AUTHOR_NAME:'t',GIT_AUTHOR_EMAIL:'t@example.invalid',GIT_COMMITTER_NAME:'t',GIT_COMMITTER_EMAIL:'t@example.invalid'}});}
function put(dir,files) {for(const [p,text] of Object.entries(files)) {fs.mkdirSync(join(dir,p,'..'),{recursive:true});fs.writeFileSync(join(dir,p),text);}}
function checkout(t) {
  const dir=fs.realpathSync(fs.mkdtempSync(join(tmpdir(),'okf5-review-')));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  git(dir,'init','-q','-b','main');
  put(dir,{'okf-base.json':JSON.stringify({nodes:{expert:{path:'expert',owner:'owner-1'},peer:{path:'peer',owner:'owner-2'}}}),'index.md':'# KB\n','expert/index.md':'# Expert\n','peer/index.md':'# Peer\n'});
  git(dir,'add','-A');git(dir,'commit','-qm','accepted');git(dir,'update-ref','refs/remotes/origin/main','HEAD');
  git(dir,'switch','-qc','okf-harvest/source-1');
  // the PR head claims peer for owner-1; only the accepted okf-base.json counts
  put(dir,{'okf-base.json':JSON.stringify({nodes:{expert:{path:'expert',owner:'owner-1'},peer:{path:'peer',owner:'owner-1'}}}),'expert/new.md':'# New\n','peer/y.md':'# Y\n'});
  git(dir,'add','-A');git(dir,'commit','-qm','okf-harvest: claim');
  return dir;
}

test('review-context --checkout reports owned nodes from the ACCEPTED okf-base.json and flags outside-owned changes',t=>{
  const dir=checkout(t),r=reviewContext({pr:URL_,checkout:dir},{},{view:view(pr(block(V2)))});
  const [b]=r.checkout.bases;
  assert.deepEqual(r.checkout.changed.sort(),['expert/new.md','okf-base.json','peer/y.md']);
  assert.equal(b.owner,'owner-1');assert.deepEqual(b.owned,[{ref:'kb/expert',path:'expert',owner:'owner-1'}]);
  assert.deepEqual(b.claimedNotOwned,['kb/peer']);assert.equal(b.baseMetaChanged,true);
  assert.deepEqual(b.outsideOwned.sort(),['okf-base.json','peer/y.md']);
  assert.deepEqual(b.read,[{ref:'kb/peer',path:'peer',owner:'owner-2'}]);
});

test('notify-harvester: a v2 notice has no harvest-status callback; the v1 notice is unchanged',()=>{
  for(const state of ['question','amend-request','amended','merged','closed']) {
    const n=notifyHarvester({pr:URL_,state},{},{view:view(pr(block(V2)))});
    assert.doesNotMatch(n.body,/harvest-status|retire/,state);assert.equal(n.to,'harv');assert.match(n.send,/^optional/);
  }
  assert.equal(notifyHarvester({pr:URL_,state:'merged'},{},{view:view(pr(block(V2)))}).body,`Your harvest PR ${URL_} is merged. Nothing else is needed.`);
  const v1=notifyHarvester({pr:URL_,state:'merged'},{},{view:view(pr(block(V1)))});
  assert.deepEqual(v1,{to:'okf-harvest-source-1-20250101',instance:'okf-harvest-source-1-20250101',alias:null,subject:`okf: merged ${URL_}`,body:`Your harvest PR ${URL_} is merged. Confirm with oats okf-harvest harvest-status, then retire.`,send:'send this with your messaging capability'});
  assert.equal(notifyHarvester({pr:URL_,state:'closed'},{},{view:view(pr(block(V1)))}).body,`Your harvest PR ${URL_} was closed without merge; see the okf-review comment for the reason. Confirm with oats okf-harvest harvest-status, then retire.`);
});

test('PR metadata strings are data, never executed',t=>{
  // shell-looking text in every PR field must reach no shell: the marker file never appears.
  // A short fixed RELATIVE marker keeps the payload under the 128-character name cap
  // whatever TMPDIR is (macOS's is long); a shell would create it in its cwd: the
  // checkout git runs in, or this process's.
  const dir=checkout(t),MARK='okf5-no-exec',sh=`$(touch ${MARK})\`touch ${MARK}\`;touch ${MARK}`;
  assert.ok(sh.length<=128);
  const shaped={...V2,source:{...source,soul:sh},tasks:{provider:sh,refs:[sh]},harvester:{instance:sh,alias:sh}};
  const p=pr(`${sh}\n${block(shaped)}`,{headRefName:sh,labels:[{name:sh}]});
  const r=reviewContext({pr:URL_,checkout:dir},{},{view:view(p)});
  assert.equal(r.provenance.valid,true);assert.equal(r.harvester.alias,sh);
  assert.equal(notifyHarvester({pr:URL_,state:'question'},{},{view:view(p)}).to,sh);
  assert.throws(()=>reviewContext({pr:URL_,checkout:dir},{},{view:view({...p,baseRefName:sh})}),{code:'E_GIT'});
  for(const where of [dir,process.cwd()]) assert.equal(fs.existsSync(join(where,MARK)),false,where);
});
