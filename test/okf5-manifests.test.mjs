import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
// oats.okf 5.6.0 package shape: versions, kernel floor, the slot's settings and
// hooks, the shipped skills (shared copies identical) and both package souls.
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

test('every manifest is version 5.6.0 with the >=0.69.2 kernel floor',()=>{
  assert.equal(readJson(join(ROOT,'package.json')).version,'5.6.0');
  const pkg=readJson(join(PKG,'oats-package.json'));
  assert.equal(pkg.version,'5.6.0');
  assert.deepEqual(pkg.compatibility,{oats:'>=0.69.2'});
  for(const name of CAPS) {
    assert.equal(cap(name).version,'5.6.0',name);
    assert.deepEqual(cap(name).compatibility,{oats:'>=0.69.2'},name);
  }
});

test('oats.okf declares exactly bindings-file, state-dir, git-timeout and consult-max-age',()=>{
  assert.deepEqual(Object.keys(cap('oats-okf').settings).sort(),['bindings-file','consult-max-age','git-timeout','state-dir']);
  assert.equal(cap('oats-okf-harvest').settings,undefined);
});

test('the vendored manifest schema is oats v0.27.1 plus the OATS v0.68.1 upgrade hook, byte for byte',()=>{
  const sha=createHash('sha256').update(fs.readFileSync(join(ROOT,'schemas/capability-manifest.schema.json'))).digest('hex');
  assert.equal(sha,'ada5b3bbb61e6543338f278251902dfcd87fdf2931f9895c15046f7f6df636b9');
});

test('oats.okf hooks are exactly soul-scaffold, a required spawn with no inputs and a non-required upgrade',()=>{
  const hooks=cap('oats-okf').hooks;
  assert.deepEqual(Object.keys(hooks).sort(),['soul-scaffold','spawn','upgrade']);
  // okf #106: never required (a plain command).
  assert.equal(hooks.upgrade,'bin/oats-okf.mjs upgrade');
  assert.equal(hooks['soul-scaffold'],'bin/oats-okf.mjs soul-scaffold');
  assert.deepEqual(hooks.spawn,{command:'bin/oats-okf.mjs spawn',required:true});
});

test('oats.okf ships consultation, capture, compulsory proposing and theory skills plus its status command',()=>{
  assert.deepEqual(fs.readdirSync(join(PKG,'capabilities','oats-okf','skills')).sort(),['knowledge-theory','okf-consultation','okf-instance-knowledge','okf-propose']);
  assert.equal(cap('oats-okf').commands.status,'bin/oats-okf.mjs status');
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

for (const [name, capability] of [['knowledge-harvester', 'oats.okf-harvest'], ['knowledge-maintainer', 'oats.okf-maintenance']]) {
  test(`the ${name} soul keeps no knowledge and defaults to background`,()=>{
    const soul=fs.readFileSync(join(PKG,'souls',name,'soul.yaml'),'utf8');
    assert.match(soul,/^knowledge: none$/m);
    assert.match(soul,/^background: true(?:\s+#.*)?$/m);
    assert.ok(soul.includes(`  ${capability}: { from: here }`));
  });
}

// oats.okf 5.0.2 (#64): personal data is excluded by ONE sentence, the same
// wherever an agent is told what to leave out. An instruction, never a check.
const PERSONAL_DATA='Never include personal data about people outside the team (clients, correspondents, any other third party): a name, a contact detail, or anything else that identifies a person, including detail derived from correspondence. Keep the lesson and leave the person out. Naming the author of a published source you cite is fine.';
const NAMES='That covers the names you choose as well: a note\'s file name, a task ref and an instance\'s name are published as provenance when knowledge is harvested.';
// Markdown quoting, emphasis and line wrapping removed, so a sentence matches across lines.
const prose=p=>fs.readFileSync(join(ROOT,p),'utf8').replace(/^> ?/gm,'').replace(/\*\*/g,'').replace(/\s+/g,' ');
const count=(text,s)=>text.split(s).length-1;
const CAPDIR='oats-package/capabilities/';

test('okf-trigger-setup hands host timer installation to the operator',()=>{
  const text=fs.readFileSync(join(ROOT,CAPDIR,'oats-okf-maintenance/skills/okf-trigger-setup/SKILL.md'),'utf8');
  const install='oats schedule host install';
  const blocks=[...text.matchAll(/```[a-z]*\n([\s\S]*?)```/g)].filter(block=>block[1].includes(install));
  assert.ok(blocks.length>0,'keep the install command visible for the operator to copy');
  for(const block of blocks) {
    const lines=block[1].split('\n').map(line=>line.replace(/#.*$/,'').trim()).filter(Boolean);
    assert.ok(lines.every(line=>/^oats schedule host install(?:\s+--[\w-]+(?:\s+[\w-]+)?)*$/.test(line)),
      'the operator block contains install lines alone, with no agent commands');
    assert.ok(lines.every(line=>!/--print\b/.test(line)),'no agent-shell preview is offered');
    const before=text.slice(0,block.index).trimEnd().split(/\n[ \t]*\n/).pop().replace(/\s+/g,' ');
    for(const required of [/operator's step/,/never yours/,/their own terminal/,/deployment directory/,/outside every instance home/]) {
      assert.match(before,required,'the immediately preceding paragraph hands installation to the operator');
    }
    assert.match(text.slice(0,block.index),/^oats schedule host status\s*(?:#.*)?$/m,'check status before offering installation');
  }
  const normalized=text.replace(/\*\*/g,'').replace(/\s+/g,' ');
  assert.match(normalized,/If this host has none yet/,'installation is conditional on a missing timer');
  assert.match(normalized,/Do not run it yourself, with or without flags\./);
  assert.match(normalized,/On OATS 0\.52\.0 and later, do not offer its `--print` from your shell as a preview/);
  assert.match(normalized,/After the operator has run it, check the result yourself with `oats schedule host status`/);
  assert.match(normalized,/With no operator at the machine, the timer stays as it is until they run the command: say what is waiting, and do not run it in their place/);
  assert.doesNotMatch(normalized,/Run it for this review trigger only/,'remove the contradictory installation imperative');
});

test('the personal-data exclusion is one sentence, the same at every place an agent is told what to exclude',()=>{
  const places={
    'oats-okf/skills/okf-instance-knowledge/SKILL.md':1,'oats-okf/injects/okf.md':1,'oats-okf/skills/okf-propose/SKILL.md':1,
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

test('the names a working instance chooses are covered: capture skill, inject and proposing skill',()=>{
  for(const file of ['oats-okf/skills/okf-instance-knowledge/SKILL.md','oats-okf/injects/okf.md','oats-okf/skills/okf-propose/SKILL.md']) assert.equal(count(prose(CAPDIR+file),NAMES),1,file);
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

// oats.okf 5.7.0 (awebai/oats-okf#118): a supersession of a human-accepted
// decision is settled at review, never parked for a human.
test('every place that teaches a human-accepted supersession settles it at review and parks nothing',()=>{
  const theory=prose(CAPDIR+'oats-okf/skills/knowledge-theory/SKILL.md'),review=prose(CAPDIR+'oats-okf-maintenance/skills/knowledge-review/SKILL.md');
  for(const [name,text] of [['knowledge-theory',theory],['knowledge-review',review]]) {
    for(const s of ['verified at <link>','source-reported (who, when, where; a relay\'s link too)','is trusted without a check','an agent alone does not overturn a human\'s decision','the new concept names the old one, the old concept says it is superseded and links the new one, and the node log names the supersession'])
      assert.ok(text.toLowerCase().includes(s.toLowerCase()),`${name}: ${s}`);
  }
  // Verified shows the account and the record, never that a human typed it; a relay is the source's report.
  const VERIFIED='Verified proves the record, not that a human typed it: agents may post under their human\'s account.';
  for(const [name,text] of [['knowledge-theory',theory],['knowledge-review',review],['CHANGELOG',prose('CHANGELOG.md')]]) {
    assert.ok(text.includes(VERIFIED),`${name}: what verified proves`);
    assert.match(text,/under the account the citation names, and says? the cited thing/,`${name}: the account the citation names`);
    assert.match(text,/or (?:is )?a relay\)? \(a record that presents itself as an agent reporting the human's words\)/,`${name}: a relay`);
    assert.doesNotMatch(text,/the named human's own account/,`${name}: no claim about whose hands`);
  }
  assert.match(review,/The author login must be the account the citation names\./);
  assert.ok(review.includes('right before merging: stop if settled gh pr merge'),'the merge pre-check stops only if settled');
  assert.doesNotMatch(review,/"verdict": "needs-human"|--add-label okf-needs-human|stop if blocked/);
  // The label survives only as the note that an old one stops nothing.
  const mentions=[];
  (function walk(dir){for(const e of fs.readdirSync(join(ROOT,dir),{withFileTypes:true})) {const p=`${dir}/${e.name}`;if(e.isDirectory()) walk(p);else if(fs.readFileSync(join(ROOT,p),'utf8').includes('okf-needs-human')) mentions.push(p);}})('oats-package');
  assert.deepEqual(mentions.sort(),[CAPDIR+'oats-okf-maintenance/skills/knowledge-review/SKILL.md',CAPDIR+'oats-okf-maintenance/skills/okf-trigger-setup/SKILL.md']);
  for(const p of [CAPDIR+'oats-okf-maintenance/injects/maintainer.md','oats-package/souls/knowledge-maintainer/AGENTS.md']) assert.match(prose(p),/without citing the human's acceptance is closed; check a citation on GitHub before you merge; never park a PR\./,p);
  assert.doesNotMatch(prose('README.md'),/hard stop/);
});

test('the README says what is an instruction and what is enforced, with the opt-out\'s two limits',()=>{
  const readme=prose('README.md');
  for(const s of ['Personal data is excluded by instruction. Nothing guarantees it stays out.','It narrows their judgement and guarantees nothing.',
    'The capture program copies evidence but does not judge its content.','It removes nothing that was pushed.',
    'The soul\'s opt-out and source capture checks are enforced in code.','It is per soul. No instance, note, host or spawn setting opts out.',
    'It covers that soul\'s own proposals. The spawn hook checks the source a proposal names. What an instance of that soul writes to other seats in messages is theirs to capture and propose.']) assert.ok(readme.includes(s),s);
});
