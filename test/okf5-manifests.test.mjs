import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// oats.okf 5.0.3 package shape: versions, kernel floor, the slot's settings and
// hooks, the shipped skills (shared copies identical) and the harvester soul.
const ROOT=fileURLToPath(new URL('../',import.meta.url));
const PKG=join(ROOT,'oats-package');
const CAPS=['oats-okf','oats-okf-harvest','oats-okf-maintenance'];
const readJson=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const cap=name=>readJson(join(PKG,'capabilities',name,'oats.json'));
/** relative path → bytes, for every file under dir. */
function files(dir,prefix='') {
  const out={};
  for(const e of fs.readdirSync(dir,{withFileTypes:true})) {
    const p=join(dir,e.name),rel=prefix+e.name;
    if(e.isDirectory()) Object.assign(out,files(p,rel+'/')); else out[rel]=fs.readFileSync(p).toString('base64');
  }
  return out;
}

test('validate-manifests passes',()=>{
  const r=spawnSync(process.execPath,[join(ROOT,'scripts','validate-manifests.mjs')],{cwd:ROOT,encoding:'utf8',timeout:60000});
  assert.equal(r.status,0,r.stdout+r.stderr);
});

test('every manifest is version 5.0.3 with the >=0.29.0 kernel floor',()=>{
  assert.equal(readJson(join(ROOT,'package.json')).version,'5.0.3');
  const pkg=readJson(join(PKG,'oats-package.json'));
  assert.equal(pkg.version,'5.0.3');
  assert.deepEqual(pkg.compatibility,{oats:'>=0.29.0'});
  for(const name of CAPS) {
    assert.equal(cap(name).version,'5.0.3',name);
    assert.deepEqual(cap(name).compatibility,{oats:'>=0.29.0'},name);
  }
});

test('oats.okf declares exactly bindings-file, state-dir, git-timeout and consult-max-age',()=>{
  assert.deepEqual(Object.keys(cap('oats-okf').settings).sort(),['bindings-file','consult-max-age','git-timeout','state-dir']);
  assert.equal(cap('oats-okf-harvest').settings,undefined);
});

test('oats.okf hooks are exactly soul-scaffold and a required spawn with no inputs',()=>{
  const hooks=cap('oats-okf').hooks;
  assert.deepEqual(Object.keys(hooks).sort(),['soul-scaffold','spawn']);
  assert.equal(hooks['soul-scaffold'],'bin/oats-okf.mjs soul-scaffold');
  assert.deepEqual(hooks.spawn,{command:'bin/oats-okf.mjs spawn',required:true});
});

test('oats.okf ships okf-consultation, okf-instance-knowledge and knowledge-theory',()=>{
  assert.deepEqual(fs.readdirSync(join(PKG,'capabilities','oats-okf','skills')).sort(),['knowledge-theory','okf-consultation','okf-instance-knowledge']);
});

test('the three knowledge-theory copies are byte-identical',()=>{
  const [first,...rest]=CAPS.map(name=>files(join(PKG,'capabilities',name,'skills','knowledge-theory')));
  assert.ok(Object.keys(first).length);
  for(const copy of rest) assert.deepEqual(copy,first);
});

test('the two okf-authoring copies are byte-identical',()=>{
  const [a,b]=['oats-okf-harvest','oats-okf-maintenance'].map(name=>files(join(PKG,'capabilities',name,'skills','okf-authoring')));
  assert.ok(Object.keys(a).length);
  assert.deepEqual(b,a);
});

test('the knowledge-harvester soul keeps no knowledge',()=>{
  const soul=fs.readFileSync(join(PKG,'souls','knowledge-harvester','soul.yaml'),'utf8');
  assert.match(soul,/^knowledge: none$/m);
  assert.match(soul,/^ {2}oats\.okf-harvest: \{ from: here \}$/m);
});

// oats.okf 5.0.2 (#64): personal data is excluded by ONE sentence, the same
// wherever an agent is told what to leave out. An instruction, never a check.
const PERSONAL_DATA='Never include personal data about people outside the team (clients, correspondents, any other third party): a name, a contact detail, or anything else that identifies a person, including detail derived from correspondence. Keep the lesson and leave the person out. Naming the author of a published source you cite is fine.';
const NAMES='That covers the names you choose as well: a note\'s file name, a task ref and an instance\'s name are published as provenance when knowledge is harvested.';
// Markdown quoting, emphasis and line wrapping removed, so a sentence matches across lines.
const prose=p=>fs.readFileSync(join(ROOT,p),'utf8').replace(/^> ?/gm,'').replace(/\*\*/g,'').replace(/\s+/g,' ');
const count=(text,s)=>text.split(s).length-1;
const CAPDIR='oats-package/capabilities/';

test('the personal-data exclusion is one sentence, the same at every place an agent is told what to exclude',()=>{
  const places={
    'oats-okf/skills/okf-instance-knowledge/SKILL.md':1,'oats-okf/injects/okf.md':1,'oats-okf/bin/oats-okf.mjs':1,
    // The harvester reads it twice: when it edits, and when it reads its diff.
    'oats-okf-harvest/skills/knowledge-harvest/SKILL.md':2,'oats-okf-maintenance/skills/knowledge-review/SKILL.md':1,
    ...Object.fromEntries(CAPS.map(name=>[`${name}/skills/knowledge-theory/SKILL.md`,1]))
  };
  for(const [file,times] of Object.entries(places)) {
    const text=prose(CAPDIR+file);
    assert.equal(count(text,PERSONAL_DATA),times,file);
    assert.equal(count(text,'personal data about people outside the team'),times,`${file}: no second wording`);
  }
  assert.equal(count(prose('README.md'),PERSONAL_DATA),1,'README quotes the sentence');
});

test('the names a working instance chooses are covered: capture skill, inject and proposal brief',()=>{
  for(const file of ['oats-okf/skills/okf-instance-knowledge/SKILL.md','oats-okf/injects/okf.md','oats-okf/bin/oats-okf.mjs']) assert.equal(count(prose(CAPDIR+file),NAMES),1,file);
});

test('the harvester and the reviewer apply it to what is published, provenance names included',()=>{
  const harvest=prose(CAPDIR+'oats-okf-harvest/skills/knowledge-harvest/SKILL.md');
  for(const s of ['A claim that cannot be stated without the person is dropped, with that reason.','Read the same diff once more for people.',
    'holds for everything you publish, not only the concepts: the commit message, the PR body and the provenance block.',
    'Note file names, task refs and the source instance\'s name are published there as written.',
    'drop the claims that rest on it and leave it out of the PR','If the source instance\'s name carries it, publish nothing and report.']) assert.ok(harvest.includes(s),s);
  const review=prose(CAPDIR+'oats-okf-maintenance/skills/knowledge-review/SKILL.md');
  for(const s of ['the names in the provenance block (note file names, task refs, instance names)',
    'Your review comes after the push: amending or closing keeps personal data out of the accepted base, not out of the pushed branch or the pull request.']) assert.ok(review.includes(s),s);
});

test('the README says what is an instruction and what is enforced, with the opt-out\'s two limits',()=>{
  const readme=prose('README.md');
  for(const s of ['Personal data is excluded by instruction. Nothing guarantees it stays out.','It narrows their judgement and guarantees nothing.',
    'No program reads the content of a harvest.','It removes nothing that was pushed.',
    'The soul\'s opt-out is the one control enforced in code.','It is per soul. No instance, note, host or spawn setting opts out.',
    'It covers that soul\'s own proposals. The spawn hook checks the source a proposal names. What an instance of that soul writes to other seats in messages is theirs to capture and propose.']) assert.ok(readme.includes(s),s);
});
