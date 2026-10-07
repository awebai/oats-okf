import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { atomic } from '../oats-package/capabilities/oats-okf/lib/io.mjs';
import { editLocalYaml } from '../oats-package/capabilities/oats-okf/lib/harvest-status.mjs';
import { choicePath, readHarvestChoice, projectHarvestState, harvestStateWarning, persistHarvestChoice } from '../oats-package/capabilities/oats-okf/lib/harvest-choice.mjs';

const deferred = { value: 'deferred', owner: 'operator', nextAction: 'Qualify, then explicitly enable', recordedAt: '2026-10-06T00:00:00.000Z' };
const policy = state => ({ state, reason: { code: `policy-${state}`, message: `Observed ${state}` } });
function fixture(t) {
  const dir = fs.mkdtempSync(join(fs.realpathSync(tmpdir()), 'okf-choice-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'oats-local.yaml');
  fs.writeFileSync(file, 'schemaVersion: 2\nsettings:\n  oats.okf:\n    harvest: off\n', { mode: 0o600 });
  return { dir, file, choose: (value, extra = {}) => persistHarvestChoice({ file, value, edit: editLocalYaml, ...extra }) };
}

test('harvest choice projection never makes a record into consent or clears a hold', () => {
  assert.equal(projectHarvestState({ policy: policy('off') }).choice, undefined, 'unrecorded is not an invented choice');
  assert.equal(projectHarvestState({ policy: policy('off'), choice: deferred }).state, 'deferred');
  const on = projectHarvestState({ policy: policy('on'), choice: deferred });
  assert.equal(on.state, 'on'); assert.equal(on.problems[0].code, 'choice-policy-mismatch');
  const blocked = projectHarvestState({ policy: policy('on'), choice: deferred, blocker: { code: 'no-launch', message: 'Explicit recovery required' } });
  assert.equal(blocked.state, 'blocked'); assert.equal(blocked.reason.code, 'no-launch');
  assert.equal(projectHarvestState({ policy: policy('unknown'), choice: deferred }).state, 'unknown');
  assert.equal(projectHarvestState({ policy: { state: 'off', reason: { code: 'soul-opt-out', message: 'Soul opts out' } }, choice: deferred }).state, 'off');
  const warning = harvestStateWarning(projectHarvestState({ policy: policy('off'), choice: deferred }));
  assert.deepEqual(Object.keys(warning), ['code', 'message']);
  assert.equal(warning.code, 'harvest-state:deferred'); assert.match(warning.message, /Owner: operator.*Qualify/);
});

test('explicit choice works before bindings, remains private, and reads do not write', t => {
  const f = fixture(t);
  assert.deepEqual(readHarvestChoice(f.file), { problems: [] });
  const before = fs.readdirSync(f.dir);
  assert.deepEqual(readHarvestChoice(f.file), { problems: [] });
  assert.deepEqual(fs.readdirSync(f.dir), before);
  const result = f.choose('deferred', { owner: deferred.owner, nextAction: deferred.nextAction });
  assert.equal(result.written, true); assert.equal(result.choiceRecorded, true); assert.equal(result.harvest, 'off');
  assert.equal(fs.statSync(choicePath(f.file)).mode & 0o077, 0);
  const bytes = fs.readFileSync(choicePath(f.file)), time = fs.statSync(choicePath(f.file)).mtimeMs;
  const read = readHarvestChoice(f.file); assert.equal(read.choice.value, 'deferred'); assert.deepEqual(read.problems, []);
  assert.deepEqual(fs.readFileSync(choicePath(f.file)), bytes); assert.equal(fs.statSync(choicePath(f.file)).mtimeMs, time);
  f.choose('on'); assert.match(fs.readFileSync(f.file, 'utf8'), /harvest: on/); assert.equal(readHarvestChoice(f.file).choice.value, 'on');
  f.choose('off'); assert.equal(readHarvestChoice(f.file).choice.value, 'off');
});

test('choice input and unsafe storage fail before the setting is changed', t => {
  const f = fixture(t), before = fs.readFileSync(f.file);
  for (const extra of [{}, { owner: 'operator', nextAction: '' }, { owner: 'operator\nother', nextAction: 'Later' }]) {
    assert.throws(() => f.choose('deferred', extra), error => error.code === 'E_USAGE' && error.result.written === false);
  }
  assert.deepEqual(fs.readFileSync(f.file), before);
  const other = join(f.dir, 'other'); fs.writeFileSync(other, 'private'); fs.symlinkSync(other, choicePath(f.file));
  assert.equal(readHarvestChoice(f.file).problems[0].code, 'choice-unreadable');
  assert.throws(() => f.choose('on'), error => error.code === 'E_HARVEST_CHOICE' && error.result.written === false);
  assert.deepEqual(fs.readFileSync(f.file), before); assert.equal(fs.readFileSync(other, 'utf8'), 'private');
});

test('failed final choice write reports the setting effect and leaves incomplete observation, not success', t => {
  const f = fixture(t); let choices = 0;
  const write = (path, bytes) => {
    if (path === choicePath(f.file) && ++choices === 2) throw Object.assign(Error('fixture'), { code: 'EACCES' });
    atomic(path, bytes);
  };
  assert.throws(() => f.choose('on', { write }), error => {
    assert.equal(error.code, 'E_HARVEST_CHOICE'); assert.deepEqual(error.result, { written: true, choiceRecorded: false });
    assert.match(error.message, /setting was written.*No rollback/); return true;
  });
  assert.match(fs.readFileSync(f.file, 'utf8'), /harvest: on/);
  const pending = readHarvestChoice(f.file); assert.equal(pending.choice, undefined); assert.equal(pending.problems[0].code, 'choice-write-incomplete');
  assert.equal(projectHarvestState({ policy: policy('on'), ...pending }).state, 'on', 'an incomplete record cannot hide actual ON');
  assert.equal(f.choose('off').choiceRecorded, true, 'only a new explicit setup finishes a choice');
});

test('a same-value setting failure before rename does not claim it wrote the setting', t => {
  const f = fixture(t);
  const write = (path, bytes) => { if (path === f.file) throw Object.assign(Error('fixture'), { code: 'EACCES' }); atomic(path, bytes); };
  assert.throws(() => f.choose('off', { write }), error => error.result.written === false && error.result.choiceRecorded === false);
  assert.equal(readHarvestChoice(f.file).problems[0].code, 'choice-write-incomplete');
});
