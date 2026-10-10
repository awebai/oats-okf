import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// oats.okf 5.0.1 package shape: versions, kernel floor, the slot's settings and
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

test('every manifest is version 5.0.1 with the >=0.29.0 kernel floor',()=>{
  assert.equal(readJson(join(ROOT,'package.json')).version,'5.0.1');
  const pkg=readJson(join(PKG,'oats-package.json'));
  assert.equal(pkg.version,'5.0.1');
  assert.deepEqual(pkg.compatibility,{oats:'>=0.29.0'});
  for(const name of CAPS) {
    assert.equal(cap(name).version,'5.0.1',name);
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
