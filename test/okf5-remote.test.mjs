import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import { spawnSync } from 'node:child_process';
import { verifyRemote } from '../oats-package/capabilities/oats-okf/lib/stores.mjs';
import { isolatedGit } from './fixtures/isolated-git.mjs';
// The frozen-remote guard (#76): the binding's repository is resolved by this
// host's global Git config, exactly as the clone's origin is, and a clone-local
// redirect of fetch or push is refused with E_OWNER.
const PREFIX='worker changed frozen Git publication remote or effective push destination';

/** A binding repository (bare, addressed by file:// URL, or by its absolute
 *  `path`), a second bare repository `mirror`, and a .gitconfig that is the
 *  only global config of every Git call, okf's included, with no system
 *  config; `host` writes that global config before okf's clone is made. */
function fixture(t,host=()=>{},{path=false}={}) {
  const dir=fs.realpathSync(fs.mkdtempSync(join(tmpdir(),'okf5-remote-')));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const home=join(dir,'home'),xdg=join(dir,'xdg'),gitconfig=join(dir,'gitconfig');
  fs.mkdirSync(home);fs.writeFileSync(gitconfig,'');
  const saved={HOME:process.env.HOME,XDG_CONFIG_HOME:process.env.XDG_CONFIG_HOME,TMPDIR:process.env.TMPDIR,PATH:process.env.PATH};
  t.after(()=>{for(const [k,v] of Object.entries(saved)) if(v===undefined) delete process.env[k]; else process.env[k]=v;});
  process.env.HOME=home;process.env.XDG_CONFIG_HOME=xdg;process.env.TMPDIR=join(dir,'tmp');fs.mkdirSync(process.env.TMPDIR);
  process.env.PATH=[isolatedGit(dir,gitconfig),process.env.PATH].join(delimiter);
  const env={HOME:home,XDG_CONFIG_HOME:xdg,PATH:process.env.PATH};
  const git=(cwd,...args)=>{const r=spawnSync('git',['-C',cwd,...args],{env,encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
  const f={dir,gitconfig,tmp:process.env.TMPDIR,canonical:join(dir,'canonical.git'),mirror:join(dir,'mirror.git'),clone:join(dir,'clone')};
  const repository=path?f.canonical:`file://${f.canonical}`;
  Object.assign(f,{repository,mirrorUrl:`file://${f.mirror}`,base:{repository},
    global:(...args)=>git(dir,'config','--global',...args),local:(...args)=>git(f.clone,'config',...args),
    getUrl:(...args)=>git(f.clone,'remote','get-url',...args,'origin'),bare:path=>git(dir,'init','-q','--bare',path)});
  for(const bare of [f.canonical,f.mirror]) f.bare(bare);
  host(f);
  git(dir,'clone','-q','--',f.repository,f.clone);
  return f;
}
function refused(f,side,leaked) {
  assert.throws(()=>verifyRemote(f.base,f.clone),e=>{
    assert.equal(e.code,'E_OWNER');
    // The prefix itself says "push destination": the side is in the detail.
    assert.ok(e.message.startsWith(`${PREFIX}: ${side} `),e.message);
    if(leaked) assert.ok(!e.message.includes(leaked),e.message);
    return true;
  });
}

test('a global insteadOf rewriting the binding repository for fetch and push passes',t=>{
  const f=fixture(t,f=>f.global(`url.${f.mirrorUrl}.insteadOf`,f.repository));
  assert.equal(f.getUrl(),f.mirrorUrl);
  assert.equal(f.getUrl('--push'),f.mirrorUrl);
  verifyRemote(f.base,f.clone);
});

test('a global pushInsteadOf rewriting only the push destination passes',t=>{
  const f=fixture(t,f=>f.global(`url.${f.mirrorUrl}.pushInsteadOf`,f.repository));
  assert.equal(f.getUrl(),f.repository);
  assert.equal(f.getUrl('--push'),f.mirrorUrl);
  verifyRemote(f.base,f.clone);
});

test('no rewrites at all passes',t=>{
  const f=fixture(t);
  verifyRemote(f.base,f.clone);
});

test('a worker that changes remote.origin.url is refused',t=>{
  const f=fixture(t);
  f.local('remote.origin.url',f.mirrorUrl);
  refused(f,'fetch');
});

test('a worker that changes remote.origin.url to the globally rewritten target is still refused',t=>{
  const f=fixture(t,f=>f.global(`url.${f.mirrorUrl}.insteadOf`,f.repository));
  f.local('remote.origin.url',f.mirrorUrl);
  refused(f,'fetch');
});

test('a worker that adds remote.origin.pushurl is refused',t=>{
  const f=fixture(t);
  f.local('remote.origin.pushurl',f.mirrorUrl);
  refused(f,'push');
});

test('a worker that adds a pushurl equal to the binding repository is refused',t=>{
  const f=fixture(t);
  f.local('remote.origin.pushurl',f.repository);
  refused(f,'push');
});

test('a worker that adds a repository-local insteadOf redirecting the binding repository is refused',t=>{
  const f=fixture(t);
  f.local(`url.${f.mirrorUrl}.insteadOf`,f.repository);
  refused(f,'fetch');
});

test('a worker that adds a repository-local pushInsteadOf is refused',t=>{
  const f=fixture(t);
  f.local(`url.${f.mirrorUrl}.pushInsteadOf`,f.repository);
  refused(f,'push');
});

test('a worker that adds a repository-local insteadOf overriding the host rewrite is refused',t=>{
  // The host rewrites a prefix of the repository; the longest match wins, so
  // a local rule on the whole repository replaces the host's rewrite.
  const f=fixture(t,f=>{f.bare(join(f.dir,'hosted','canonical.git'));f.global(`url.file://${f.dir}/hosted/.insteadOf`,`file://${f.dir}/`);});
  assert.equal(f.getUrl(),`file://${f.dir}/hosted/canonical.git`);
  verifyRemote(f.base,f.clone);
  f.local(`url.${f.mirrorUrl}.insteadOf`,f.repository);
  refused(f,'fetch');
});

test('a second origin url is refused',t=>{
  const f=fixture(t);
  f.local('--add','remote.origin.url',f.mirrorUrl);
  refused(f,'fetch');
});

test('the refusal redacts a credential in either URL',t=>{
  const f=fixture(t);
  f.local('remote.origin.url','https://user:s3cret@evil.invalid/knowledge.git');
  refused(f,'fetch','s3cret');
});

test('the host resolution leaves no scratch behind, passing or refused',t=>{
  const f=fixture(t,f=>f.global(`url.${f.mirrorUrl}.insteadOf`,f.repository));
  verifyRemote(f.base,f.clone);
  assert.deepEqual(fs.readdirSync(f.tmp),[]);
  f.local(`url.file://${f.dir}/elsewhere.git.pushInsteadOf`,f.repository);
  refused(f,'push');
  assert.deepEqual(fs.readdirSync(f.tmp),[]);
});

test('a worker that prefixes the origin url with a space is refused, though Git reads another repository',t=>{
  const f=fixture(t,undefined,{path:true});
  // A leading space makes the URL a relative path, inside the worker's clone.
  const changed=' '+f.repository;
  f.bare(join(f.clone,changed));
  f.local('remote.origin.url',changed);
  refused(f,'fetch');
});

test('a worker that adds a repository-local insteadOf to the binding repository with a leading space is refused',t=>{
  const f=fixture(t,undefined,{path:true});
  f.local(`url. ${f.repository}.insteadOf`,f.repository);
  refused(f,'fetch');
});

test('a worker that adds a repository-local insteadOf to the binding repository with a trailing space is refused',t=>{
  const f=fixture(t);
  f.local(`url.${f.repository} .insteadOf`,f.repository);
  refused(f,'fetch');
});

test('a worker that adds a repository-local pushInsteadOf to the binding repository with a leading space is refused',t=>{
  const f=fixture(t,undefined,{path:true});
  f.local(`url. ${f.repository}.pushInsteadOf`,f.repository);
  refused(f,'push');
});

test('okf\'s Git reads the fixture\'s global config and never a system one',t=>{
  const f=fixture(t,f=>f.global(`url.${f.mirrorUrl}.insteadOf`,f.repository));
  const system=join(f.dir,'system-gitconfig');
  fs.writeFileSync(system,`[url "file://${f.dir}/system.git"]\n\tinsteadOf = ${f.repository}\n`);
  // The environment okf's Git gets: no GIT_* variable survives okf's cleaning.
  const r=spawnSync('git',['config','--show-scope','--show-origin','--get-regexp','^url\\.'],
    {cwd:f.clone,env:{PATH:process.env.PATH,HOME:process.env.HOME,GIT_CONFIG_SYSTEM:system},encoding:'utf8'});
  assert.equal(r.status,0,r.stderr);
  assert.equal(r.stdout.trim(),`global\tfile:${f.gitconfig}\turl.${f.mirrorUrl}.insteadof ${f.repository}`);
});
