import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { targetOnceIdentity } from '../oats-package/capabilities/oats-okf/lib/once-identity.mjs';

const member = repoKey => ({ instance: 'keeper-one', agent: 'keeper', workspace: { soul: { repoKey, id: `${repoKey}#keeper` } } });
const env = id => ({ OATS_SOUL_ID: id, OATS_AGENT: 'keeper', OATS_INSTANCE_HOME: '/unrelated/operator' });
test('package and knowledge capability declare the kernel-enforced identity floor', () => {
  for (const file of ['oats-package/oats-package.json', 'oats-package/capabilities/oats-okf/oats.json']) {
    const manifest = JSON.parse(fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'));
    assert.equal(manifest.compatibility.oats, '>=0.43.3');
  }
});

test('one-shot target identity rejects another repository with the same name and ignores the invoker home', () => {
  const meta = member('example.test/owner/repo');
  assert.equal(targetOnceIdentity(meta, env(meta.workspace.soul.id)), meta.workspace.soul.id);
  assert.throws(() => targetOnceIdentity(meta, env('example.test/other/repo#keeper')), { code: 'E_OWNER' });
  assert.throws(() => targetOnceIdentity(meta, { ...env(meta.workspace.soul.id), OATS_AGENT: 'other' }), { code: 'E_INVOCATION' });
  assert.throws(() => targetOnceIdentity(meta, { OATS_AGENT: 'keeper' }), { code: 'E_INVOCATION' });
  assert.throws(() => targetOnceIdentity({ ...meta, workspace: {} }, env(meta.workspace.soul.id)), { code: 'E_OWNER' });
  assert.throws(() => targetOnceIdentity({ ...meta, workspace: { soul: { ...meta.workspace.soul, repoKey: 'other' } } }, env(meta.workspace.soul.id)), { code: 'E_OWNER' });
});

test('one-shot package identity uses the recorded qualified id and agents-root name', () => {
  const meta = { instance: 'worker-one', agent: 'acme-pkg--keeper', workspace: { soul: { id: 'package:acme.pkg#keeper', name: 'keeper', package: { id: 'acme.pkg' } } } };
  const vars = { OATS_AGENT: meta.agent, OATS_SOUL_ID: meta.workspace.soul.id };
  assert.equal(targetOnceIdentity(meta, vars), vars.OATS_SOUL_ID);
  assert.throws(() => targetOnceIdentity(meta, { ...vars, OATS_SOUL_ID: 'example.test/member#keeper' }), { code: 'E_OWNER' });
  assert.throws(() => targetOnceIdentity(meta, { ...vars, OATS_AGENT: 'keeper' }), { code: 'E_INVOCATION' });
});

test('classic target needs an actual recorded stable directory, not a temporary preview or inferred name', t => {
  const root = fs.mkdtempSync(join(fs.realpathSync(tmpdir()), 'once-identity-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = join(root, 'stable soul'); fs.mkdirSync(dir);
  const meta = { instance: 'keeper-one', agent: 'keeper', soulDir: dir };
  assert.equal(targetOnceIdentity(meta, env(dir)), dir);
  assert.throws(() => targetOnceIdentity({ ...meta, soulDir: undefined }, env(dir)), { code: 'E_OWNER' });
  const preview = join(root, 'oats-preview-soul-123'); fs.mkdirSync(preview);
  assert.throws(() => targetOnceIdentity({ ...meta, soulDir: preview }, env(preview)), { code: 'E_OWNER' });
});
