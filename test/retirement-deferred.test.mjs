import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { save } from '../oats-package/capabilities/oats-okf/lib/io.mjs';
import { observeDeferredRetirements, deferRetirement, clearDeferredRetirement, retirementWarnings } from '../oats-package/capabilities/oats-okf/lib/retirement-deferred.mjs';
import { inventory } from './helpers/no-effects.mjs';
function fixture(t) {
  const root=fs.realpathSync(fs.mkdtempSync(join(tmpdir(),'okf-retirement-'))),bindings={stateDir:join(root,'state')};
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const source=(agent,home=join(root,agent))=>{const id=randomUUID(),s={version:1,id,agent,home,bindings};s.file=join(bindings.stateDir,'sources',id,'source.json');save(s.file,s);return s;};
  return {root,bindings,source};
}
test('deferred retirement counts and ages are scoped, durable across retries, and read-only', t=>{
  const f=fixture(t),a=f.source('one'),b=f.source('two'),ordinary=f.source('ordinary');
  const first=100000,now=150000;
  deferRetirement(a,{now:first,code:'E_CAPTURE_PENDING'});deferRetirement(a,{now:first+10000,code:'E_CAPTURE_UNCERTAIN',attempt:randomUUID()});
  let observed=observeDeferredRetirements(f.bindings,{now});assert.equal(observed.count,1);assert.equal(observed.sources[0].since,new Date(first).toISOString());assert.equal(observed.oldestAgeSeconds,50);
  deferRetirement(b,{now:first+20000,code:'E_LOCKED'});
  save(join(f.bindings.stateDir,'sources',ordinary.id,'status.json'),{lastCapture:{status:'running',complete:false}});
  const before=inventory(f.root);observed=observeDeferredRetirements(f.bindings,{now});assert.equal(observed.count,2);assert.equal(observed.oldestAgeSeconds,50);assert.deepEqual(inventory(f.root),before);
  assert.equal(observeDeferredRetirements(f.bindings,{soul:'one',now}).count,1);assert.equal(observeDeferredRetirements(f.bindings,{home:b.home,now}).sources[0].id,b.id);
  assert.equal(observeDeferredRetirements(f.bindings,{soul:'missing',now}).count,0);
  save(join(f.bindings.stateDir,'sources',a.id,'status.json'),{retired:true});
  deferRetirement(a,{now,code:'E_LOCKED'});assert.equal(observeDeferredRetirements(f.bindings,{now}).count,1,'a late busy observer cannot recreate an already resolved obligation');clearDeferredRetirement(b);assert.equal(observeDeferredRetirements(f.bindings,{now}).count,0);
});
test('bounded/truncated and corrupt or redirected coverage cannot claim exact zero or leak source data', t=>{
  const f=fixture(t),a=f.source('PRIVATE_NAME'),b=f.source('PRIVATE_OTHER');deferRetirement(a);deferRetirement(b);
  const before=inventory(f.root),limited=observeDeferredRetirements(f.bindings,{maxSources:1});assert.equal(limited.coverage,'truncated');assert.equal(limited.count,null);assert.ok(limited.scannedSources<=1);assert.equal(limited.observedCount,1);assert.deepEqual(inventory(f.root),before);
  const budget=observeDeferredRetirements(f.bindings,{maxBytes:1});assert.equal(budget.count,null);assert.notEqual(budget.coverage,'complete');
  const symlink=join(f.bindings.stateDir,'sources',randomUUID());fs.symlinkSync(join(f.bindings.stateDir,'sources',a.id),symlink);
  const unknown=observeDeferredRetirements(f.bindings);assert.equal(unknown.count,null);assert.equal(unknown.coverage,'unknown');
  const text=JSON.stringify(retirementWarnings(unknown));assert.doesNotMatch(text,/PRIVATE_NAME|PRIVATE_OTHER|\/private|\.json/);assert.match(text,/at least 2/);
  fs.writeFileSync(join(f.bindings.stateDir,'sources',a.id,'retirement-deferred.json'),'{');assert.equal(observeDeferredRetirements(f.bindings).coverage,'unknown');
});
