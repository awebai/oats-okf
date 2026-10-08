import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// A tree snapshot (bytes, links, mtimes): equal before and after means nothing was written.
function inventory(root,out={},key='.') {
  const s=fs.lstatSync(root);out[key]=s.isSymbolicLink()?{link:fs.readlinkSync(root)}:s.isDirectory()?{mtime:s.mtimeMs}:{mtime:s.mtimeMs,bytes:fs.readFileSync(root,'base64')};
  if(s.isDirectory() && !s.isSymbolicLink()) for(const n of fs.readdirSync(root).sort()) inventory(join(root,n),out,`${key}/${n}`);
  return out;
}
// Preloaded into the CLI: any write or child process makes it exit 97.
function noEffectsPreload(root) {
  const file=join(root,'no-effects.mjs');
  fs.writeFileSync(file,`import fs from 'node:fs';import cp from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';
let hit=false;const refuse=()=>{hit=true;throw new Error('unexpected effect');};
for(const n of ['mkdirSync','mkdtempSync','renameSync','rmSync','unlinkSync','writeFileSync','appendFileSync','copyFileSync','linkSync','symlinkSync']) fs[n]=refuse;
const open=fs.openSync;fs.openSync=(p,flags='r',...rest)=>(flags==='r' || flags===fs.constants.O_RDONLY)?open(p,flags,...rest):refuse();
for(const n of ['spawnSync','spawn','execSync','exec','execFileSync','execFile','fork']) cp[n]=refuse;
syncBuiltinESMExports();process.on('exit',()=>{if(hit) process.exitCode=97;});
`);
  return file;
}
// oats.okf 5.0.0: the 4.x harvest settings refuse (E_REMOVED) everywhere, naming
// where they were set; `setup --remove-legacy-settings` is the one exempt command.
const ROOT=fileURLToPath(new URL('../',import.meta.url));
const CLI=join(ROOT,'oats-package/capabilities/oats-okf/bin/oats-okf.mjs');
const {legacySettings,refuseLegacySettings,soulOptOut,LEGACY_KEYS}=await import(new URL('../oats-package/capabilities/oats-okf/lib/legacy-settings.mjs',import.meta.url));
const SECRET='SECRET-VALUE-x';
const HOST={kind:'host',at:'oats-local.yaml#/settings/oats.okf'};
const NEW='agents now propose knowledge and spawn oats.okf/knowledge-harvester at checkpoints';
const KERNEL="the harvester now launches with the kernel's own harness and model selection";
const CLEANUP='oats okf setup --remove-legacy-settings --soul <soul> --json';
const why=k=>k==='harvest'?NEW:KERNEL;
const envFor=(keys,origin=HOST,extra={})=>({OATS_SETTINGS:JSON.stringify({...extra,...Object.fromEntries(keys.map(k=>[k,SECRET]))}),OATS_SETTINGS_ORIGINS:JSON.stringify(Object.fromEntries(keys.filter(()=>origin).map(k=>[`/${k}`,typeof origin==='function'?origin(k):origin])))});
function tmp(t,prefix='okf5-legacy-') {const d=fs.realpathSync(fs.mkdtempSync(join(tmpdir(),prefix)));t.after(()=>fs.rmSync(d,{recursive:true,force:true}));return d;}
function run(args,env={},cwd=tmpdir()) {
  const r=spawnSync(process.execPath,[CLI,...args],{cwd,env:{PATH:process.env.PATH,HOME:cwd,...env},encoding:'utf8',timeout:60000});
  let out=null;try{out=JSON.parse(r.stdout);}catch{}
  assert.doesNotMatch(r.stdout+r.stderr,/SECRET-VALUE/,'a setting value never reaches the output');
  return {status:r.status,stdout:r.stdout,stderr:r.stderr,out};
}
const cleanup=(dep,env,plan=false)=>run(['setup','--remove-legacy-settings',...(plan?['--plan']:[]),'--soul','source','--json'],{OATS_TEAM_SCOPE:dep,...env},dep);
const FULL=`# deployment host config (harvest notes kept)
version: 1
settings:
  oats.aweb:
    team: alpha   # keep
  oats.okf:
    # okf host settings
    bindings-file: /srv/okf/bindings.json
    harvest: ${SECRET}   # old switch
    harvest-runtime: "${SECRET}"
    state-dir: /srv/okf/state
    harvest-model: '${SECRET}'
  oats.jira:
    site: example
other: true
`;
const withoutLegacy=text=>text.split('\n').filter(l=>!/^    harvest(-runtime|-model)?:/.test(l)).join('\n');
function deployment(t,text=FULL) {const d=tmp(t);fs.writeFileSync(join(d,'oats-local.yaml'),text);return d;}

test('host and soul origins render the exact removal sentence for each legacy key',()=>{
  assert.deepEqual(LEGACY_KEYS,['harvest','harvest-runtime','harvest-model']);
  for(const key of LEGACY_KEYS) {
    const [host]=legacySettings(envFor([key]));
    assert.equal(host.kind,'host');assert.equal(host.message,`settings.oats.okf.${key} from host (oats-local.yaml#/settings/oats.okf) was removed in oats.okf 5.0; ${why(key)}; run ${CLEANUP} from this deployment.`);
    const [soul]=legacySettings(envFor([key],{kind:'soul',at:'soul.yaml#/knowledge'}));
    assert.equal(soul.kind,'soul');
    // A soul `harvest` other than off (here the secret) is refused; off is the soul's opt-out (below).
    assert.equal(soul.message,key==='harvest'
      ?`knowledge.harvest other than off from soul (soul.yaml#/knowledge) was removed in oats.okf 5.0; only the soul's opt-out, knowledge: { harvest: off }, remains; remove the key in the soul's reviewed source (or set it off) and sync/respawn; ${NEW}. Host cleanup cannot change a soul setting.`
      :`knowledge.${key} from soul (soul.yaml#/knowledge) was removed in oats.okf 5.0; remove that key in the soul's reviewed source and sync/respawn; ${why(key)}. Host cleanup cannot remove a soul setting.`);
  }
  assert.equal(legacySettings(envFor(['harvest'])).at(0).message,`settings.oats.okf.harvest from host (oats-local.yaml#/settings/oats.okf) was removed in oats.okf 5.0; agents now propose knowledge and spawn oats.okf/knowledge-harvester at checkpoints; run oats okf setup --remove-legacy-settings --soul <soul> --json from this deployment.`);
});

test('spawn, workspace and unknown origins name the layer and the fix',()=>{
  for(const key of LEGACY_KEYS) {
    assert.equal(legacySettings(envFor([key],{kind:'spawn'}))[0].message,`${key} from spawn was removed in oats.okf 5.0; drop it from the spawn command; ${why(key)}. Host cleanup cannot remove it.`);
    assert.equal(legacySettings(envFor([key],{kind:'workspace',at:'oats-workspace.yaml#/settings'}))[0].message,`${key} from workspace (oats-workspace.yaml#/settings) was removed in oats.okf 5.0; remove it in that layer's reviewed source; ${why(key)}. Host cleanup cannot remove it.`);
    const [unknown]=legacySettings(envFor([key],null));
    assert.equal(unknown.kind,'unknown');
    assert.equal(unknown.message,`${key} from an unknown origin was removed in oats.okf 5.0; ${why(key)}; find where it is set (oats-local.yaml settings.oats.okf, soul.yaml knowledge:, or a --provider oats.okf flag) and remove it (${CLEANUP} removes a host value).`);
  }
});

test('refuseLegacySettings throws E_REMOVED with every key and never the value; no key or unreadable settings pass',()=>{
  const env=envFor(LEGACY_KEYS,k=>k==='harvest'?HOST:{kind:'soul',at:'soul.yaml#/knowledge'},{'bindings-file':'/b.json'});
  assert.throws(()=>refuseLegacySettings(env),e=>e.code==='E_REMOVED' && /settings\.oats\.okf\.harvest from host/.test(e.message) && /knowledge\.harvest-runtime from soul/.test(e.message) && /knowledge\.harvest-model from soul/.test(e.message) && !e.message.includes(SECRET));
  assert.doesNotMatch(JSON.stringify(legacySettings(env)),/SECRET-VALUE/);
  assert.doesNotThrow(()=>refuseLegacySettings({OATS_SETTINGS:JSON.stringify({'bindings-file':'/b.json'})}));
  assert.doesNotThrow(()=>refuseLegacySettings({}));
  assert.deepEqual(legacySettings({OATS_SETTINGS:'{not json'}),[]);
});

test('--plan lists the removed key paths and writes nothing',t=>{
  const dep=deployment(t),before=inventory(dep);
  const r=cleanup(dep,envFor(LEGACY_KEYS),true);
  assert.equal(r.status,0,r.stdout+r.stderr);
  assert.deepEqual(r.out.result,{file:join(dep,'oats-local.yaml'),removed:['settings.oats.okf.harvest','settings.oats.okf.harvest-runtime','settings.oats.okf.harvest-model'],plan:true,written:false});
  assert.deepEqual(inventory(dep),before);
});

test('the legacy guard does not block the cleanup: real CLI removes exactly the three keys while they are still forwarded',t=>{
  const dep=deployment(t),file=join(dep,'oats-local.yaml');
  const r=cleanup(dep,envFor(LEGACY_KEYS));
  assert.equal(r.status,0,r.stdout+r.stderr);assert.equal(r.out.ok,true);
  assert.deepEqual(r.out.result.removed,['settings.oats.okf.harvest','settings.oats.okf.harvest-runtime','settings.oats.okf.harvest-model']);assert.equal(r.out.result.written,true);
  assert.equal(fs.readFileSync(file,'utf8'),withoutLegacy(FULL),'comments, other providers and other oats.okf keys keep every byte');
  assert.deepEqual(fs.readdirSync(dep),['oats-local.yaml'],'no temp file is left behind');
  // the kernel no longer forwards it: a second run is a no-op
  const before=inventory(dep),again=cleanup(dep,{OATS_SETTINGS:JSON.stringify({'bindings-file':'/srv/okf/bindings.json'})});
  assert.equal(again.status,0,again.stdout);assert.deepEqual(again.out.result,{file,removed:[],written:false});assert.deepEqual(inventory(dep),before);
});

test('an emptied oats.okf map stays a map ({}) and a rerun is a no-op',t=>{
  const dep=deployment(t,'settings:\n  oats.okf:\n    harvest: on\n    harvest-model: m\nworkspace: x\n'),file=join(dep,'oats-local.yaml');
  const r=cleanup(dep,envFor(['harvest','harvest-model']));
  assert.equal(r.status,0,r.stdout);assert.equal(fs.readFileSync(file,'utf8'),'settings:\n  oats.okf: {}\nworkspace: x\n');
  const before=inventory(dep),again=cleanup(dep,{OATS_SETTINGS:'{}'});
  assert.equal(again.status,0,again.stdout);assert.deepEqual(again.out.result.removed,[]);assert.equal(again.out.result.written,false);assert.deepEqual(inventory(dep),before);
});

test('an oats.okf map nested under another settings key is never edited: refused before writing, with or without a forwarded key',t=>{
  const text='settings:\n  other:\n    oats.okf:\n      harvest: off\n  oats.aweb:\n    value: keep\n';
  for(const [name,env,preview] of [['no forwarded key',{OATS_SETTINGS:'{}'},false],['plan',{OATS_SETTINGS:'{}'},true],['host harvest',envFor(['harvest']),false]]) {
    const dep=deployment(t,text),before=inventory(dep);
    const r=cleanup(dep,env,preview);
    assert.equal(r.status,1,`${name}: ${r.stdout}`);assert.equal(r.out.error.code,'E_UNSUPPORTED',name);
    assert.match(r.out.error.message,/oats\.okf appears nested under another settings key.*nothing was written/);
    assert.deepEqual(inventory(dep),before,`${name}: the other key's nested map keeps every byte`);
  }
});

test('an emptied oats.okf map with an inline comment becomes {} before the comment, and reads back as an empty map',t=>{
  const dep=deployment(t,'settings:\n  oats.okf: # keep comment (old harvest switch)\n    harvest: off\nworkspace: x\n'),file=join(dep,'oats-local.yaml');
  const r=cleanup(dep,envFor(['harvest']));
  assert.equal(r.status,0,r.stdout);assert.deepEqual(r.out.result.removed,['settings.oats.okf.harvest']);assert.equal(r.out.result.written,true);
  assert.equal(fs.readFileSync(file,'utf8'),'settings:\n  oats.okf: {} # keep comment (old harvest switch)\nworkspace: x\n','{} is the value, not part of the comment (never a null map)');
  // Read back by the same reader (the comment names harvest, so the full reader runs): an empty map, nothing to remove.
  const before=inventory(dep),again=cleanup(dep,{OATS_SETTINGS:'{}'});
  assert.equal(again.status,0,again.stdout);assert.deepEqual(again.out.result,{file,removed:[],written:false});assert.deepEqual(inventory(dep),before);
});

test('a 4.x manifest default (origin manifest-default) is no legacy setting: ignored by the guard, and the cleanup removes only the host key',t=>{
  const DEFAULT=k=>({kind:'manifest-default',at:`oats.json#/settings/${k}/default`});
  assert.deepEqual(legacySettings(envFor(['harvest','harvest-runtime'],DEFAULT)),[]);
  assert.doesNotThrow(()=>refuseLegacySettings(envFor(['harvest','harvest-runtime'],DEFAULT)));
  assert.equal(soulOptOut({OATS_SETTINGS:JSON.stringify({harvest:'off'}),OATS_SETTINGS_ORIGINS:JSON.stringify({'/harvest':DEFAULT('harvest')})}),false,'a default off is no opt-out');
  // The host key still needs the cleanup; the defaulted harvest-runtime, absent from the file, is not "missed".
  const dep=deployment(t,'settings:\n  oats.okf:\n    bindings-file: /b.json\n    harvest: on\n'),file=join(dep,'oats-local.yaml');
  const r=cleanup(dep,envFor(['harvest','harvest-runtime'],k=>k==='harvest'?HOST:DEFAULT(k)));
  assert.equal(r.status,0,r.stdout+r.stderr);assert.deepEqual(r.out.result,{file,removed:['settings.oats.okf.harvest'],written:true});
  assert.equal(fs.readFileSync(file,'utf8'),'settings:\n  oats.okf:\n    bindings-file: /b.json\n');
});

test('the cleanup keeps the deployment file\'s own permissions (0644, 0600); other atomic writes stay private (0600)',async t=>{
  for(const mode of [0o644,0o600]) {
    const dep=deployment(t),file=join(dep,'oats-local.yaml');fs.chmodSync(file,mode);
    const r=cleanup(dep,envFor(LEGACY_KEYS));
    assert.equal(r.status,0,r.stdout+r.stderr);assert.equal(r.out.result.written,true);
    assert.equal(fs.statSync(file).mode&0o777,mode,`mode ${mode.toString(8)} kept`);
  }
  const {atomic}=await import(new URL('../oats-package/capabilities/oats-okf/lib/io.mjs',import.meta.url));
  const dir=tmp(t),other=join(dir,'state.json');
  atomic(other,'{}\n');assert.equal(fs.statSync(other).mode&0o777,0o600,'the default stays 0600');
});

test('shapes the line reader does not edit refuse E_UNSUPPORTED before writing',t=>{
  const shapes={
    tabs:'settings:\n  oats.okf:\n\tharvest: on\n',
    multidoc:'settings:\n  oats.okf:\n    harvest: on\n---\nsettings: {}\n',
    flow:'settings:\n  oats.okf: { harvest: off }\n',
    block:'settings:\n  oats.okf:\n    harvest: |\n      on\n',
    duplicate:'settings:\n  oats.okf:\n    harvest: on\n    harvest: off\n',
    missing:'settings:\n  oats.okf:\n    bindings-file: /b.json\n# harvest was here\n',
  };
  for(const [name,text] of Object.entries(shapes)) {
    const dep=deployment(t,text),before=inventory(dep);
    const r=cleanup(dep,envFor(['harvest']));
    assert.equal(r.status,1,name);assert.equal(r.out.error.code,'E_UNSUPPORTED',`${name}: ${r.stdout}`);assert.match(r.out.error.message,/nothing was written\. Report it to the deployment's owner/);
    assert.doesNotMatch(r.out.error.message,/by hand/,'never an instruction to hand-edit oats-local.yaml');
    assert.deepEqual(inventory(dep),before,`${name}: bytes unchanged`);
  }
  // host origin present but the key is not in the file at all
  const dep=deployment(t,'settings:\n  oats.okf:\n    bindings-file: /b.json\n'),before=inventory(dep);
  const r=cleanup(dep,envFor(['harvest-runtime']));
  assert.equal(r.status,1);assert.equal(r.out.error.code,'E_UNSUPPORTED');assert.match(r.out.error.message,/host layer sets settings\.oats\.okf\.harvest-runtime/);assert.deepEqual(inventory(dep),before);
});

test('a symlinked, hardlinked or missing oats-local.yaml refuses before writing',t=>{
  const real=tmp(t),target=join(real,'real.yaml');fs.writeFileSync(target,'settings:\n  oats.okf:\n    harvest: on\n');
  const linked=tmp(t);fs.symlinkSync(target,join(linked,'oats-local.yaml'));
  const hard=tmp(t);fs.writeFileSync(join(hard,'oats-local.yaml'),'settings:\n  oats.okf:\n    harvest: on\n');fs.linkSync(join(hard,'oats-local.yaml'),join(hard,'second-name.yaml'));
  const outside=inventory(real);
  for(const dep of [linked,hard]) {
    const before=inventory(dep),r=cleanup(dep,envFor(['harvest']));
    assert.equal(r.status,1);assert.equal(r.out.error.code,'E_UNSUPPORTED',r.stdout);assert.match(r.out.error.message,/single-link regular file/);assert.deepEqual(inventory(dep),before);
  }
  assert.deepEqual(inventory(real),outside,'the symlink target is untouched');
  const empty=tmp(t),r=cleanup(empty,envFor(['harvest']));
  assert.equal(r.status,1);assert.equal(r.out.error.code,'E_CONFIG');assert.deepEqual(fs.readdirSync(empty),[]);
});

test('a missing or relative deployment scope refuses E_DEPLOYMENT_SCOPE',t=>{
  const dep=deployment(t),before=inventory(dep),args=['setup','--remove-legacy-settings','--soul','source','--json'];
  const none=run(args,envFor(['harvest']),dep);
  assert.equal(none.status,1);assert.equal(none.out.error.code,'E_DEPLOYMENT_SCOPE');
  const relative=run(args,{OATS_TEAM_SCOPE:'.',...envFor(['harvest'])},dep);
  assert.equal(relative.status,1);assert.equal(relative.out.error.code,'E_DEPLOYMENT_SCOPE');
  assert.deepEqual(inventory(dep),before);
});

test('a soul-origin key refuses E_REMOVED with the remaining keys while the host file is still cleaned',t=>{
  const dep=deployment(t,'settings:\n  oats.okf:\n    bindings-file: /b.json\n    harvest: on\n'),file=join(dep,'oats-local.yaml');
  const r=cleanup(dep,envFor(['harvest','harvest-model'],k=>k==='harvest'?HOST:{kind:'soul',at:'soul.yaml#/knowledge'}));
  assert.equal(r.status,1);assert.equal(r.out.error.code,'E_REMOVED');assert.match(r.out.error.message,/^knowledge\.harvest-model from soul \(soul\.yaml#\/knowledge\)/);
  assert.deepEqual(r.out.error.result,{file,removed:['settings.oats.okf.harvest'],written:true,remaining:[{key:'harvest-model',kind:'soul',at:'soul.yaml#/knowledge'}]});
  assert.equal(fs.readFileSync(file,'utf8'),'settings:\n  oats.okf:\n    bindings-file: /b.json\n');
});

const SOUL={kind:'soul',at:'soul.yaml#/knowledge'};
const soulOff=(origin=SOUL,extra={})=>({OATS_SETTINGS:JSON.stringify({...extra,harvest:'off'}),OATS_SETTINGS_ORIGINS:JSON.stringify({'/harvest':origin})});
test('the soul opt-out knowledge: { harvest: off } is valid; absent is the default; only the soul layer may set it',()=>{
  assert.deepEqual(legacySettings(soulOff()),[]);assert.doesNotThrow(()=>refuseLegacySettings(soulOff()));assert.equal(soulOptOut(soulOff()),true);
  assert.equal(soulOptOut({OATS_SETTINGS:'{}'}),false,'absent: the normal 5.0 proposal flow');
  // A host or spawn value, even off, is removed: the merged value's origin is the last layer, so a host key masks the soul's.
  for(const origin of [HOST,{kind:'spawn'},{kind:'workspace'},null]) {
    const env=origin?soulOff(origin):{OATS_SETTINGS:JSON.stringify({harvest:'off'})};
    assert.equal(soulOptOut(env),false);assert.throws(()=>refuseLegacySettings(env),{code:'E_REMOVED'});
  }
  // The soul's harvest-runtime / harvest-model stay removed beside its opt-out.
  const both={OATS_SETTINGS:JSON.stringify({harvest:'off','harvest-model':SECRET}),OATS_SETTINGS_ORIGINS:JSON.stringify({'/harvest':SOUL,'/harvest-model':SOUL})};
  assert.deepEqual(legacySettings(both).map(f=>f.key),['harvest-model']);
});

test('a host harvest key over a soul opt-out still needs the host cleanup; the cleanup never touches the soul',t=>{
  const dep=deployment(t,'settings:\n  oats.okf:\n    bindings-file: /b.json\n    harvest: off\n'),file=join(dep,'oats-local.yaml');
  // The kernel reports the host as the origin (it masks the soul's off): every command refuses until the host key is gone.
  assert.throws(()=>refuseLegacySettings(soulOff(HOST)),e=>e.code==='E_REMOVED' && /^settings\.oats\.okf\.harvest from host/.test(e.message));
  const r=cleanup(dep,soulOff(HOST));
  assert.equal(r.status,0,r.stdout);assert.deepEqual(r.out.result,{file,removed:['settings.oats.okf.harvest'],written:true});
  assert.equal(fs.readFileSync(file,'utf8'),'settings:\n  oats.okf:\n    bindings-file: /b.json\n');
  // Then the soul's own off shows through: valid, and nothing left for the cleanup.
  const again=cleanup(dep,soulOff());
  assert.equal(again.status,0,again.stdout);assert.deepEqual(again.out.result,{file,removed:[],written:false});
  assert.equal(run(['--help'],soulOff()).status,0);
});

test('with a host legacy key, inspect/bases/init and the spawn hook refuse E_REMOVED before effects; --help still answers',t=>{
  const root=tmp(t),home=join(root,'home');fs.mkdirSync(home);
  const preload=noEffectsPreload(root),before=inventory(root);
  const env={...envFor(['harvest']),OATS_INSTANCE_HOME:home,NODE_OPTIONS:`--import=${JSON.stringify(preload)}`};
  for(const args of [['inspect','--json'],['bases','--json'],['init','--base','project','--nodes',join(root,'nodes.json'),'--output',join(root,'stage'),'--json']]) {
    const r=run(args,env,home);
    assert.equal(r.status,1,`${args[0]}: no effect was attempted\n${r.stdout}${r.stderr}`);assert.equal(r.out.error.code,'E_REMOVED');assert.match(r.out.error.message,/settings\.oats\.okf\.harvest from host/);
  }
  const hook=run([],{...env,OATS_EVENT:'spawn'},home);
  assert.equal(hook.status,1,hook.stdout+hook.stderr);assert.deepEqual(Object.keys(hook.out),['warning'],'a refusal before effects reports no meta');assert.match(hook.out.warning,/^oats-okf E_REMOVED: settings\.oats\.okf\.harvest from host/);
  for(const f of ['STATE.md','log.md','notes']) assert.equal(fs.existsSync(join(home,f)),false,`spawn wrote no ${f}`);
  assert.deepEqual(inventory(root),before);
  const help=run(['--help'],envFor(['harvest']),home);
  assert.equal(help.status,0);assert.match(help.stdout,/setup --remove-legacy-settings/);
});
